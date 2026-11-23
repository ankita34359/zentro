import type { TenantCtx, TenantDb } from "../../db/tenant.js";
import { HttpError, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import type { AuditService } from "../audit/service.js";
import type { AuthStore } from "../auth/repositories/store.js";
import type { AuthContext, AuthService } from "../auth/service.js";
import type { Capabilities } from "../permissions/service.js";
import { scopeContainsMember, type ScopeSet } from "../permissions/resolver.js";
import { cleanDay, cleanText, laterDay, type RelationshipType } from "./common.js";
import { SCOPE_LINE_TYPES } from "./hierarchy.js";
import type { PeopleRepository, PersonRow, ReportingRow } from "./repositories/people.js";

/**
 * Reporting lines, department and team membership, moves and the chart tree (stages 2.6 and 2.7). Every change is one
 * transaction with its audit row. Rows are effective-dated: a change ends the old row and starts a new one, so history is
 * kept. Needs `hierarchy.manage` over the person (and the team or department) for every write.
 */
export class HierarchyService {
  constructor(private readonly o: { store: AuthStore; auth: AuthService; audit: AuditService }) {}

  private ctx(auth: AuthContext, requestId: string): TenantCtx {
    return this.o.auth.tenantCtx(auth, requestId);
  }
  private today = (): string => this.o.auth.iso().slice(0, 10);
  private repos(ctx: TenantCtx): { tdb: TenantDb; people: PeopleRepository } {
    const tdb = this.o.store.tenant(ctx);
    return { tdb, people: this.o.store.people(tdb) };
  }

  /** The person must exist in this organization, still belong, and be inside the caller's `hierarchy.manage` scope; otherwise 404. */
  private manageable(people: PeopleRepository, caps: Capabilities, id: string): PersonRow {
    const p = people.person(id);
    if (!p || !scopeContainsMember(caps.scope("hierarchy.manage"), id)) throw notFound();
    if (p.archived_at !== null || p.status === "left") throw new HttpError(409, "archived", `${p.display_name} no longer belongs to the organization.`);
    return p;
  }
  private teamAllowed(scope: ScopeSet, teamId: string): boolean {
    return scope.all || scope.teams.has(teamId);
  }
  private deptAllowed(scope: ScopeSet, departmentId: string): boolean {
    return scope.all || scope.departments.has(departmentId);
  }

  // ---------- reporting lines ----------

  /** One person's lines, current and past, as subordinate and as manager (only people the caller may see). */
  reporting(auth: AuthContext, requestId: string, caps: Capabilities, membershipId: string): { asSubordinate: ReportingView[]; asManager: ReportingView[] } {
    const ctx = this.ctx(auth, requestId);
    const { people } = this.repos(ctx);
    const scope = caps.scope("org.view");
    const view = caps.scope("people.view");
    const seen = (id: string) => id === auth.membershipId || scopeContainsMember(scope, id) || scopeContainsMember(view, id);
    if (!people.person(membershipId) || !seen(membershipId)) throw notFound();
    const names = new Map(people.people().map((p) => [p.id, p.display_name]));
    const rows = people.reportingRows({ membershipId });
    const toView = (r: ReportingRow): ReportingView => ({ id: r.id, subordinate: { id: r.subordinate_membership_id, name: names.get(r.subordinate_membership_id) ?? "Former member" }, manager: { id: r.manager_membership_id, name: names.get(r.manager_membership_id) ?? "Former member" }, type: r.relationship_type, startDate: r.start_date, endDate: r.end_date, reason: r.reason });
    return {
      asSubordinate: rows.filter((r) => r.subordinate_membership_id === membershipId && seen(r.manager_membership_id)).map(toView),
      asManager: rows.filter((r) => r.manager_membership_id === membershipId && seen(r.subordinate_membership_id)).map(toView),
    };
  }

  addReporting(auth: AuthContext, requestId: string, caps: Capabilities, input: { subordinateId: string; managerId: string; type?: RelationshipType; startDate?: string | null; reason?: string | null }): { id: string; endedPrimary: string | null } {
    const ctx = this.ctx(auth, requestId);
    const { tdb, people } = this.repos(ctx);
    const sub = this.manageable(people, caps, input.subordinateId);
    const mgr = this.manageable(people, caps, input.managerId);
    if (sub.id === mgr.id) throw new HttpError(400, "self_report", "A person cannot report to themselves.");
    const type = input.type ?? "primary";
    const today = this.today();
    const startDate = cleanDay(input.startDate, "The start date") ?? today;
    const reason = cleanText(input.reason, 200, "The reason");
    if (people.openLine(sub.id, mgr.id, type)) throw new HttpError(409, "already_reporting", `${sub.display_name} already has ${mgr.display_name} as a ${type} manager.`);
    if (SCOPE_LINE_TYPES.has(type) && this.wouldCycle(people, sub.id, mgr.id, startDate)) {
      throw new HttpError(409, "would_create_cycle", `${mgr.display_name} already reports, directly or through others, to ${sub.display_name}. That would make a loop.`);
    }
    const currentPrimary = type === "primary" ? people.openPrimary(sub.id) : undefined;
    if (currentPrimary && startDate < currentPrimary.start_date) {
      throw new HttpError(400, "before_current_start", `The new manager cannot start before the current one did (${currentPrimary.start_date}).`);
    }
    const id = newId();
    const now = this.o.auth.iso();
    let endedName: string | null = null;
    this.o.store.transaction(() => {
      if (currentPrimary) {
        people.endReporting(currentPrimary.id, startDate, null);
        endedName = people.person(currentPrimary.manager_membership_id)?.display_name ?? null;
      }
      people.insertReporting({ id, subordinateId: sub.id, managerId: mgr.id, type, startDate, reason, createdBy: ctx.membershipId, now });
      this.o.audit.record(tdb, ctx, {
        action: "reporting.add",
        entityType: "reporting_relationship",
        entityId: id,
        summary: `${sub.display_name} now reports to ${mgr.display_name} (${type}) from ${startDate}${endedName ? `; ${endedName} is no longer the primary manager` : ""}`,
        before: endedName ? { endedManager: endedName } : undefined,
        after: { subordinateId: sub.id, managerId: mgr.id, type, startDate },
      });
    });
    return { id, endedPrimary: endedName };
  }

  /** Ends a line (never deletes it). The end day is the first day it no longer applies. */
  endReporting(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: { endDate?: string | null; reason?: string | null }): { id: string } {
    const ctx = this.ctx(auth, requestId);
    const { tdb, people } = this.repos(ctx);
    const row = people.reportingRow(id);
    if (!row || !scopeContainsMember(caps.scope("hierarchy.manage"), row.subordinate_membership_id)) throw notFound();
    if (row.end_date !== null) throw new HttpError(409, "already_ended", "This reporting line has already ended.");
    const endDate = laterDay(cleanDay(input.endDate, "The end date") ?? this.today(), row.start_date);
    const reason = cleanText(input.reason, 200, "The reason");
    const sub = people.person(row.subordinate_membership_id);
    const mgr = people.person(row.manager_membership_id);
    this.o.store.transaction(() => {
      people.endReporting(id, endDate, reason);
      this.o.audit.record(tdb, ctx, { action: "reporting.end", entityType: "reporting_relationship", entityId: id, summary: `${sub?.display_name ?? "A person"} no longer reports to ${mgr?.display_name ?? "a manager"} (${row.relationship_type}) from ${endDate}`, before: { type: row.relationship_type, startDate: row.start_date }, after: { endDate } });
    });
    return { id };
  }

  /** Would `subordinate -> manager` close a loop? Walks up from the manager over the lines that still apply on or after the start day. */
  private wouldCycle(people: PeopleRepository, subId: string, mgrId: string, startDate: string): boolean {
    const up = new Map<string, string[]>();
    for (const r of people.reportingRows()) {
      if (!SCOPE_LINE_TYPES.has(r.relationship_type)) continue;
      if (r.end_date !== null && r.end_date <= startDate) continue; // already over by then
      up.set(r.subordinate_membership_id, [...(up.get(r.subordinate_membership_id) ?? []), r.manager_membership_id]);
    }
    const seen = new Set<string>();
    const stack = [mgrId];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === subId) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      stack.push(...(up.get(cur) ?? []));
    }
    return false;
  }

  // ---------- team and department membership ----------

  addTeamMember(auth: AuthContext, requestId: string, caps: Capabilities, teamId: string, input: { membershipId: string; type?: string; allocationPct?: number; startDate?: string | null }): { id: string } {
    const ctx = this.ctx(auth, requestId);
    const { tdb, people } = this.repos(ctx);
    const structure = this.o.store.structure(tdb);
    const team = structure.team(teamId);
    if (!team || !this.teamAllowed(caps.scope("hierarchy.manage"), teamId)) throw notFound();
    if (team.archived_at) throw new HttpError(409, "archived", "This team is archived. Restore it first.");
    const person = this.manageable(people, caps, input.membershipId);
    const type = input.type ?? "member";
    const startDate = cleanDay(input.startDate, "The start date") ?? this.today();
    if (people.openTeamRow(teamId, person.id)) throw new HttpError(409, "already_member", `${person.display_name} is already in ${team.name}.`);
    const id = newId();
    const now = this.o.auth.iso();
    this.o.store.transaction(() => {
      if (type === "lead") this.demoteTeamLead(people, teamId, startDate, ctx, now);
      people.insertTeamRow({ id, teamId, membershipId: person.id, type, allocationPct: input.allocationPct ?? 100, startDate, createdBy: ctx.membershipId, now });
      this.ensureDepartment(people, team.department_id, person.id, startDate, ctx, now);
      this.o.audit.record(tdb, ctx, { action: "team_member.add", entityType: "team_membership", entityId: id, summary: `${person.display_name} joined the team "${team.name}" as ${type.replace("_", " ")} from ${startDate}`, after: { teamId, membershipId: person.id, type, startDate } });
    });
    return { id };
  }

  changeTeamMember(auth: AuthContext, requestId: string, caps: Capabilities, teamId: string, rowId: string, input: { type?: string; allocationPct?: number; endDate?: string | null; effectiveDate?: string | null }): { id: string } {
    const ctx = this.ctx(auth, requestId);
    const { tdb, people } = this.repos(ctx);
    const structure = this.o.store.structure(tdb);
    const team = structure.team(teamId);
    const row = people.teamRow(rowId);
    if (!team || !row || row.team_id !== teamId || !this.teamAllowed(caps.scope("hierarchy.manage"), teamId) || !scopeContainsMember(caps.scope("hierarchy.manage"), row.membership_id)) throw notFound();
    if (row.end_date !== null) throw new HttpError(409, "already_ended", "This membership has already ended.");
    const person = people.person(row.membership_id);
    const now = this.o.auth.iso();
    const id = newId();
    this.o.store.transaction(() => {
      if (input.endDate !== undefined && input.endDate !== null) {
        const end = laterDay(cleanDay(input.endDate, "The end date")!, row.start_date);
        people.endTeamRow(rowId, end);
        this.o.audit.record(tdb, ctx, { action: "team_member.end", entityType: "team_membership", entityId: rowId, summary: `${person?.display_name ?? "A person"} left the team "${team.name}" from ${end}`, before: { type: row.membership_type, startDate: row.start_date }, after: { endDate: end } });
        return;
      }
      if (input.type !== undefined && input.type !== row.membership_type) {
        const eff = laterDay(cleanDay(input.effectiveDate, "The effective date") ?? this.today(), row.start_date);
        if (input.type === "lead") this.demoteTeamLead(people, teamId, eff, ctx, now);
        people.endTeamRow(rowId, eff);
        people.insertTeamRow({ id, teamId, membershipId: row.membership_id, type: input.type, allocationPct: input.allocationPct ?? row.allocation_pct, startDate: eff, createdBy: ctx.membershipId, now });
        this.o.audit.record(tdb, ctx, { action: "team_member.change", entityType: "team_membership", entityId: id, summary: `${person?.display_name ?? "A person"} is now ${input.type.replace("_", " ")} of the team "${team.name}" from ${eff}`, before: { type: row.membership_type }, after: { type: input.type, startDate: eff } });
        return;
      }
      if (input.allocationPct !== undefined && input.allocationPct !== row.allocation_pct) {
        people.setTeamAllocation(rowId, input.allocationPct);
        this.o.audit.record(tdb, ctx, { action: "team_member.change", entityType: "team_membership", entityId: rowId, summary: `Changed the time ${person?.display_name ?? "a person"} gives the team "${team.name}" to ${input.allocationPct}%`, before: { allocationPct: row.allocation_pct }, after: { allocationPct: input.allocationPct } });
      }
    });
    return { id: rowId };
  }

  addDepartmentMember(auth: AuthContext, requestId: string, caps: Capabilities, departmentId: string, input: { membershipId: string; type?: string; startDate?: string | null }): { id: string } {
    const ctx = this.ctx(auth, requestId);
    const { tdb, people } = this.repos(ctx);
    const dept = this.o.store.structure(tdb).department(departmentId);
    if (!dept || !this.deptAllowed(caps.scope("hierarchy.manage"), departmentId)) throw notFound();
    if (dept.archived_at) throw new HttpError(409, "archived", "This department is archived. Restore it first.");
    const person = this.manageable(people, caps, input.membershipId);
    const type = input.type ?? "member";
    const startDate = cleanDay(input.startDate, "The start date") ?? this.today();
    if (people.openDeptRow(departmentId, person.id)) throw new HttpError(409, "already_member", `${person.display_name} is already in ${dept.name}.`);
    const id = newId();
    const now = this.o.auth.iso();
    this.o.store.transaction(() => {
      if (type === "head") this.demoteDeptHead(people, departmentId, startDate, ctx, now);
      people.insertDeptRow({ id, departmentId, membershipId: person.id, type, startDate, createdBy: ctx.membershipId, now });
      this.o.audit.record(tdb, ctx, { action: "department_member.add", entityType: "department_membership", entityId: id, summary: `${person.display_name} joined the department "${dept.name}" as ${type} from ${startDate}`, after: { departmentId, membershipId: person.id, type, startDate } });
    });
    return { id };
  }

  changeDepartmentMember(auth: AuthContext, requestId: string, caps: Capabilities, departmentId: string, rowId: string, input: { type?: string; endDate?: string | null; effectiveDate?: string | null }): { id: string } {
    const ctx = this.ctx(auth, requestId);
    const { tdb, people } = this.repos(ctx);
    const dept = this.o.store.structure(tdb).department(departmentId);
    const row = people.deptRow(rowId);
    if (!dept || !row || row.department_id !== departmentId || !this.deptAllowed(caps.scope("hierarchy.manage"), departmentId) || !scopeContainsMember(caps.scope("hierarchy.manage"), row.membership_id)) throw notFound();
    if (row.end_date !== null) throw new HttpError(409, "already_ended", "This membership has already ended.");
    const person = people.person(row.membership_id);
    const now = this.o.auth.iso();
    const id = newId();
    this.o.store.transaction(() => {
      if (input.endDate !== undefined && input.endDate !== null) {
        const end = laterDay(cleanDay(input.endDate, "The end date")!, row.start_date);
        people.endDeptRow(rowId, end);
        this.o.audit.record(tdb, ctx, { action: "department_member.end", entityType: "department_membership", entityId: rowId, summary: `${person?.display_name ?? "A person"} left the department "${dept.name}" from ${end}`, before: { type: row.membership_type, startDate: row.start_date }, after: { endDate: end } });
        return;
      }
      if (input.type !== undefined && input.type !== row.membership_type) {
        const eff = laterDay(cleanDay(input.effectiveDate, "The effective date") ?? this.today(), row.start_date);
        if (input.type === "head") this.demoteDeptHead(people, departmentId, eff, ctx, now);
        people.endDeptRow(rowId, eff);
        people.insertDeptRow({ id, departmentId, membershipId: row.membership_id, type: input.type, startDate: eff, createdBy: ctx.membershipId, now });
        this.o.audit.record(tdb, ctx, { action: "department_member.change", entityType: "department_membership", entityId: id, summary: `${person?.display_name ?? "A person"} is now ${input.type} of the department "${dept.name}" from ${eff}`, before: { type: row.membership_type }, after: { type: input.type, startDate: eff } });
      }
    });
    return { id: rowId };
  }

  /** A new lead replaces the old one: the old lead stays in the team as a member from the same day (history kept). */
  private demoteTeamLead(people: PeopleRepository, teamId: string, from: string, ctx: TenantCtx, now: string): void {
    for (const r of people.teamRows({ teamId }).filter((x) => x.end_date === null && x.membership_type === "lead")) {
      const eff = laterDay(from, r.start_date);
      people.endTeamRow(r.id, eff);
      people.insertTeamRow({ id: newId(), teamId, membershipId: r.membership_id, type: "member", allocationPct: r.allocation_pct, startDate: eff, createdBy: ctx.membershipId, now });
    }
  }
  private demoteDeptHead(people: PeopleRepository, departmentId: string, from: string, ctx: TenantCtx, now: string): void {
    for (const r of people.deptRows({ departmentId }).filter((x) => x.end_date === null && x.membership_type === "head")) {
      const eff = laterDay(from, r.start_date);
      people.endDeptRow(r.id, eff);
      people.insertDeptRow({ id: newId(), departmentId, membershipId: r.membership_id, type: "member", startDate: eff, createdBy: ctx.membershipId, now });
    }
  }
  /** Everyone in a team is in its department: add the department membership when it is missing. */
  private ensureDepartment(people: PeopleRepository, departmentId: string, membershipId: string, from: string, ctx: TenantCtx, now: string): void {
    if (!people.openDeptRow(departmentId, membershipId)) people.insertDeptRow({ id: newId(), departmentId, membershipId, type: "member", startDate: from, createdBy: ctx.membershipId, now });
  }

  // ---------- moving a person ----------

  /**
   * Moves a person to a team and/or department on a day, in one transaction: their open team and department rows end on
   * that day and the new ones start. Their reporting lines are not touched (a change of manager is its own action).
   */
  move(auth: AuthContext, requestId: string, caps: Capabilities, input: { membershipId: string; effectiveDate?: string | null; toTeamId?: string | null; toDepartmentId?: string | null; reason?: string | null }): { moved: true } {
    const ctx = this.ctx(auth, requestId);
    const { tdb, people } = this.repos(ctx);
    const structure = this.o.store.structure(tdb);
    const person = this.manageable(people, caps, input.membershipId);
    const scope = caps.scope("hierarchy.manage");
    const team = input.toTeamId ? structure.team(input.toTeamId) : undefined;
    if (input.toTeamId && (!team || !this.teamAllowed(scope, input.toTeamId))) throw notFound();
    if (team?.archived_at) throw new HttpError(409, "archived", "That team is archived.");
    const deptId = team?.department_id ?? input.toDepartmentId ?? null;
    if (!deptId) throw new HttpError(400, "validation_failed", "Request did not pass validation", [{ path: "toTeamId", message: "Choose a team or a department to move to" }]);
    if (input.toDepartmentId && team && team.department_id !== input.toDepartmentId) throw new HttpError(400, "wrong_department", "That team is not in that department.");
    const dept = structure.department(deptId);
    if (!dept || !this.deptAllowed(scope, deptId)) throw notFound();
    if (dept.archived_at) throw new HttpError(409, "archived", "That department is archived.");
    const eff = cleanDay(input.effectiveDate, "The effective date") ?? this.today();
    const reason = cleanText(input.reason, 200, "The reason");
    const openTeams = people.teamRows({ membershipId: person.id }).filter((r) => r.end_date === null);
    const openDepts = people.deptRows({ membershipId: person.id }).filter((r) => r.end_date === null);
    const sameTeam = team ? openTeams.length === 1 && openTeams[0]!.team_id === team.id : openTeams.length === 0;
    const sameDept = openDepts.length === 1 && openDepts[0]!.department_id === deptId;
    if (sameTeam && sameDept) throw new HttpError(409, "no_change", `${person.display_name} is already there.`);
    const now = this.o.auth.iso();
    const names = (rows: { team_id?: string; department_id?: string }[]) => rows.map((r) => (r.team_id ? structure.team(r.team_id)?.name : structure.department(r.department_id!)?.name) ?? "").filter(Boolean);
    this.o.store.transaction(() => {
      for (const r of openTeams) people.endTeamRow(r.id, laterDay(eff, r.start_date));
      for (const r of openDepts) people.endDeptRow(r.id, laterDay(eff, r.start_date));
      people.insertDeptRow({ id: newId(), departmentId: deptId, membershipId: person.id, type: "member", startDate: eff, createdBy: ctx.membershipId, now });
      if (team) people.insertTeamRow({ id: newId(), teamId: team.id, membershipId: person.id, type: "member", allocationPct: 100, startDate: eff, createdBy: ctx.membershipId, now });
      this.o.audit.record(tdb, ctx, {
        action: "person.move",
        entityType: "membership",
        entityId: person.id,
        summary: `Moved ${person.display_name} to ${team ? `the team "${team.name}" in ` : ""}the department "${dept.name}" from ${eff}${reason ? ` (${reason})` : ""}`,
        before: { teams: names(openTeams), departments: names(openDepts) },
        after: { teamId: team?.id ?? null, departmentId: deptId, effectiveDate: eff },
      });
    });
    return { moved: true };
  }
}

export interface ReportingView {
  id: string;
  subordinate: { id: string; name: string };
  manager: { id: string; name: string };
  type: string;
  startDate: string;
  endDate: string | null;
  reason: string | null;
}
