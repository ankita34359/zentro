import type { TenantCtx } from "../../db/tenant.js";
import { HttpError, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import type { AuditService } from "../audit/service.js";
import type { AuthStore } from "../auth/repositories/store.js";
import type { AuthContext, AuthService } from "../auth/service.js";
import type { Capabilities } from "../permissions/service.js";
import { scopeContainsMember } from "../permissions/resolver.js";
import { SCOPE_LINE_TYPES } from "./hierarchy.js";
import { cleanDay, cleanPersonName, cleanText, EMPLOYMENT_TYPES } from "./common.js";
import type { PersonRow } from "./repositories/people.js";

const MAX_LIMIT = 500;

export interface Ref { id: string; name: string }
export interface PersonSummary {
  id: string;
  displayName: string;
  status: string;
  hasLogin: boolean;
  archived: boolean;
  isDemo: boolean;
  designation: Ref | null;
  departments: (Ref & { type: string })[];
  teams: (Ref & { type: string })[];
  managers: (Ref & { type: string })[];
  /** Only when the caller may see sensitive details of this person. */
  email: string | null;
}
export interface PersonProfile extends PersonSummary {
  roleFamily: Ref | null;
  departmentRows: { rowId: string; department: Ref; type: string; startDate: string; endDate: string | null }[];
  teamRows: { rowId: string; team: Ref; departmentId: string; type: string; allocationPct: number; startDate: string; endDate: string | null }[];
  managerRows: { rowId: string; manager: Ref; type: string; startDate: string; endDate: string | null; reason: string | null }[];
  directReports: (Ref & { type: string })[];
  /** Employment details. Null unless the caller holds `people.view_sensitive` for this person (or manages them). */
  employment: { employeeCode: string | null; employmentType: string | null; startDate: string | null; endDate: string | null } | null;
  can: { edit: boolean; manageHierarchy: boolean; archive: boolean; restore: boolean };
}
export interface HistoryEntry { id: string; label: string; detail: string | null; startDate: string; endDate: string | null }
export interface PersonHistory {
  designations: HistoryEntry[];
  departments: HistoryEntry[];
  teams: HistoryEntry[];
  managers: HistoryEntry[];
  reports: HistoryEntry[];
}

export interface CreatePersonInput {
  name: string;
  workEmail?: string | null;
  employeeCode?: string | null;
  employmentType?: string | null;
  startDate?: string | null;
  designationId?: string | null;
  departmentId?: string | null;
  teamId?: string | null;
  managerId?: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * People (stage 2.6): the directory of everyone in the organization, with or without a login. Every change is one
 * transaction that also writes its audit row. Placements and reporting lines are effective-dated and never deleted
 * (see `HierarchyService`); this service owns the person themselves, their designation history and archiving.
 */
export class PeopleService {
  constructor(private readonly o: { store: AuthStore; auth: AuthService; audit: AuditService }) {}

  private ctx(auth: AuthContext, requestId: string): TenantCtx {
    return this.o.auth.tenantCtx(auth, requestId);
  }
  private today = (): string => this.o.auth.iso().slice(0, 10);

  // ---------- reading ----------

  /** The directory the caller may see (`people.view`, and always themselves), newest filters first applied in memory: an organization has a few hundred people. */
  list(
    auth: AuthContext,
    requestId: string,
    caps: Capabilities,
    q: { search?: string; departmentId?: string; teamId?: string; designationId?: string; status?: string; includeArchived?: boolean; limit?: number; offset?: number },
  ): { people: PersonSummary[]; total: number; limit: number; offset: number } {
    const ctx = this.ctx(auth, requestId);
    const tdb = this.o.store.tenant(ctx);
    const view = caps.scope("people.view");
    const detail = caps.scope("people.view_sensitive");
    const manage = caps.scope("people.manage");
    const ref = this.refs(ctx);
    const today = this.today();
    const rows = this.o.store.people(tdb).people().filter((p) => (p.id === auth.membershipId || scopeContainsMember(view, p.id)) && (q.includeArchived ? true : p.archived_at === null));
    const places = this.placements(ctx, today, ref);
    const needle = q.search?.trim().toLowerCase();
    const filtered = rows.filter((p) => {
      const pl = places.get(p.id);
      if (q.status && p.status !== q.status) return false;
      if (q.designationId && p.designation_id !== q.designationId) return false;
      if (q.departmentId && !pl?.departments.some((d) => d.id === q.departmentId)) return false;
      if (q.teamId && !pl?.teams.some((t) => t.id === q.teamId)) return false;
      if (needle) {
        const hay = [p.display_name, ref.designation(p.designation_id)?.name, ...(pl?.departments.map((d) => d.name) ?? []), ...(pl?.teams.map((t) => t.name) ?? [])].join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const limit = Math.min(Math.max(q.limit ?? 200, 1), MAX_LIMIT);
    const offset = Math.max(q.offset ?? 0, 0);
    const people = filtered.slice(offset, offset + limit).map((p) => this.summary(p, places.get(p.id), ref, p.id === auth.membershipId || scopeContainsMember(detail, p.id) || scopeContainsMember(manage, p.id)));
    return { people, total: filtered.length, limit, offset };
  }

  profile(auth: AuthContext, requestId: string, caps: Capabilities, id: string): PersonProfile {
    const ctx = this.ctx(auth, requestId);
    const tdb = this.o.store.tenant(ctx);
    const repo = this.o.store.people(tdb);
    const p = repo.person(id);
    if (!p || !this.canView(auth, caps, id)) throw notFound(); // missing, another organization's, or outside your scope: the same answer
    const ref = this.refs(ctx);
    const today = this.today();
    const places = this.placements(ctx, today, ref).get(id);
    const sensitive = id === auth.membershipId || scopeContainsMember(caps.scope("people.view_sensitive"), id) || scopeContainsMember(caps.scope("people.manage"), id);
    const des = ref.designation(p.designation_id);
    const fam = des ? ref.familyOf(p.designation_id) : null;
    const names = ref.people;
    const person = (pid: string): Ref => ({ id: pid, name: names.get(pid) ?? "Former member" });
    const reporting = repo.reportingRows({ membershipId: id });
    const active = (r: { start_date: string; end_date: string | null }) => r.start_date <= today && (r.end_date === null || today < r.end_date);
    const manage = scopeContainsMember(caps.scope("people.manage"), id);
    return {
      ...this.summary(p, places, ref, sensitive),
      roleFamily: fam,
      departmentRows: repo.deptRows({ membershipId: id }).filter((r) => r.end_date === null || today < r.end_date).map((r) => ({ rowId: r.id, department: ref.department(r.department_id), type: r.membership_type, startDate: r.start_date, endDate: r.end_date })),
      teamRows: repo.teamRows({ membershipId: id }).filter((r) => r.end_date === null || today < r.end_date).map((r) => ({ rowId: r.id, team: ref.team(r.team_id), departmentId: ref.teamDepartment(r.team_id), type: r.membership_type, allocationPct: r.allocation_pct, startDate: r.start_date, endDate: r.end_date })),
      managerRows: reporting.filter((r) => r.subordinate_membership_id === id && (r.end_date === null || today < r.end_date)).map((r) => ({ rowId: r.id, manager: person(r.manager_membership_id), type: r.relationship_type, startDate: r.start_date, endDate: r.end_date, reason: r.reason })),
      directReports: reporting.filter((r) => r.manager_membership_id === id && active(r) && this.canView(auth, caps, r.subordinate_membership_id)).map((r) => ({ ...person(r.subordinate_membership_id), type: r.relationship_type })),
      employment: sensitive ? { employeeCode: p.employee_code, employmentType: p.employment_type, startDate: p.start_date, endDate: p.end_date } : null,
      can: {
        edit: manage && p.archived_at === null,
        manageHierarchy: scopeContainsMember(caps.scope("hierarchy.manage"), id) && p.archived_at === null,
        archive: manage && p.user_id === null && p.status === "active" && p.archived_at === null,
        restore: manage && p.user_id === null && p.archived_at !== null,
      },
    };
  }

  history(auth: AuthContext, requestId: string, caps: Capabilities, id: string): PersonHistory {
    const ctx = this.ctx(auth, requestId);
    const repo = this.o.store.people(this.o.store.tenant(ctx));
    if (!repo.person(id) || !this.canView(auth, caps, id)) throw notFound();
    const ref = this.refs(ctx);
    const name = (pid: string) => ref.people.get(pid) ?? "Former member";
    // newest first; on the same start day the row still open comes first
    const rev = <T extends { startDate: string; endDate: string | null }>(xs: T[]): T[] => xs.sort((a, b) => b.startDate.localeCompare(a.startDate) || (a.endDate === null ? -1 : b.endDate === null ? 1 : b.endDate.localeCompare(a.endDate)));
    const reporting = repo.reportingRows({ membershipId: id });
    return {
      designations: rev(repo.designationRows(id).map((r) => ({ id: r.id, label: ref.designation(r.designation_id)?.name ?? "Designation", detail: r.reason, startDate: r.start_date, endDate: r.end_date }))),
      departments: rev(repo.deptRows({ membershipId: id }).map((r) => ({ id: r.id, label: ref.department(r.department_id).name, detail: r.membership_type, startDate: r.start_date, endDate: r.end_date }))),
      teams: rev(repo.teamRows({ membershipId: id }).map((r) => ({ id: r.id, label: ref.team(r.team_id).name, detail: r.membership_type, startDate: r.start_date, endDate: r.end_date }))),
      managers: rev(reporting.filter((r) => r.subordinate_membership_id === id).map((r) => ({ id: r.id, label: name(r.manager_membership_id), detail: r.reason ? `${r.relationship_type}: ${r.reason}` : r.relationship_type, startDate: r.start_date, endDate: r.end_date }))),
      reports: rev(reporting.filter((r) => r.manager_membership_id === id && this.canView(auth, caps, r.subordinate_membership_id)).map((r) => ({ id: r.id, label: name(r.subordinate_membership_id), detail: r.relationship_type, startDate: r.start_date, endDate: r.end_date }))),
    };
  }

  // ---------- writing ----------

  create(auth: AuthContext, requestId: string, caps: Capabilities, input: CreatePersonInput): { id: string } {
    const ctx = this.ctx(auth, requestId);
    const tdb = this.o.store.tenant(ctx);
    const repo = this.o.store.people(tdb);
    const structure = this.o.store.structure(tdb);
    const manage = caps.scope("people.manage");
    const name = cleanPersonName(input.name);
    const managerId = input.managerId ?? null;
    // A manager (scope: their reports) can only add people under themselves or their reports; wider scopes add anywhere.
    const placedInScope = (input.teamId && manage.teams.has(input.teamId)) || (input.departmentId && manage.departments.has(input.departmentId));
    if (!manage.all && !placedInScope && !(managerId && scopeContainsMember(manage, managerId))) {
      throw new HttpError(403, "outside_scope", "You can add people under someone in your reports, or into a team or department you manage. Choose a manager or a place that is yours.");
    }
    const workEmail = this.cleanEmail(input.workEmail);
    const employeeCode = cleanText(input.employeeCode, 40, "The employee code");
    if (employeeCode && repo.employeeCodeTaken(employeeCode, null)) throw new HttpError(409, "employee_code_taken", "Another person already has that employee code.");
    const employmentType = this.cleanEmployment(input.employmentType);
    const startDate = cleanDay(input.startDate, "The start date");
    const today = this.today();
    const placeFrom = startDate && startDate > today ? startDate : today;

    const designation = input.designationId ? structure.designation(input.designationId) : undefined;
    if (input.designationId && (!designation || designation.archived_at)) throw designation ? new HttpError(409, "archived", "That designation is archived.") : notFound();
    const department = input.departmentId ? structure.department(input.departmentId) : undefined;
    if (input.departmentId && (!department || department.archived_at)) throw department ? new HttpError(409, "archived", "That department is archived.") : notFound();
    const team = input.teamId ? structure.team(input.teamId) : undefined;
    if (input.teamId && (!team || team.archived_at)) throw team ? new HttpError(409, "archived", "That team is archived.") : notFound();
    const manager = managerId ? repo.person(managerId) : undefined;
    if (managerId && (!manager || !this.isLive(manager))) throw notFound();
    if (team && department && team.department_id !== department.id) throw new HttpError(400, "wrong_department", "That team is not in that department.");

    const id = newId();
    const now = this.o.auth.iso();
    this.o.store.transaction(() => {
      repo.insertPerson({ id, displayName: name, workEmail, employeeCode, employmentType, startDate, now });
      if (designation) {
        repo.setDesignationCache(id, designation.id, now);
        repo.insertDesignation({ id: newId(), membershipId: id, designationId: designation.id, startDate: startDate && startDate < today ? startDate : today, reason: "Added with the person", createdBy: ctx.membershipId, now });
      }
      const deptId = team?.department_id ?? department?.id;
      if (deptId) repo.insertDeptRow({ id: newId(), departmentId: deptId, membershipId: id, type: "member", startDate: placeFrom, createdBy: ctx.membershipId, now });
      if (team) repo.insertTeamRow({ id: newId(), teamId: team.id, membershipId: id, type: "member", allocationPct: 100, startDate: placeFrom, createdBy: ctx.membershipId, now });
      if (manager) repo.insertReporting({ id: newId(), subordinateId: id, managerId: manager.id, type: "primary", startDate: placeFrom, reason: null, createdBy: ctx.membershipId, now });
      this.o.audit.record(tdb, ctx, {
        action: "person.create",
        entityType: "membership",
        entityId: id,
        summary: `Added ${name} to the organization${designation ? ` as ${designation.name}` : ""}${manager ? `, reporting to ${manager.display_name}` : ""}`,
        after: { name, designationId: designation?.id ?? null, departmentId: deptId ?? null, teamId: team?.id ?? null, managerId: manager?.id ?? null },
      });
    });
    return { id };
  }

  update(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: { name?: string; workEmail?: string | null; employeeCode?: string | null; employmentType?: string | null; startDate?: string | null; endDate?: string | null }): { id: string } {
    const ctx = this.ctx(auth, requestId);
    const tdb = this.o.store.tenant(ctx);
    const repo = this.o.store.people(tdb);
    const cur = repo.person(id);
    if (!cur || !scopeContainsMember(caps.scope("people.manage"), id)) throw notFound();
    if (cur.archived_at) throw new HttpError(409, "archived", "This person is archived. Restore them before changing their details.");
    const name = input.name !== undefined ? cleanPersonName(input.name) : cur.display_name;
    // A person with a login keeps the name they chose themselves; the directory name of a person without one is edited here.
    if (cur.user_id !== null && name !== cur.display_name) throw new HttpError(409, "has_login", "This person signed up with their own name. They change it themselves.");
    const workEmail = input.workEmail !== undefined ? this.cleanEmail(input.workEmail) : cur.work_email;
    const employeeCode = input.employeeCode !== undefined ? cleanText(input.employeeCode, 40, "The employee code") : cur.employee_code;
    if (employeeCode && employeeCode !== cur.employee_code && repo.employeeCodeTaken(employeeCode, id)) throw new HttpError(409, "employee_code_taken", "Another person already has that employee code.");
    const employmentType = input.employmentType !== undefined ? this.cleanEmployment(input.employmentType) : cur.employment_type;
    const startDate = input.startDate !== undefined ? cleanDay(input.startDate, "The start date") : cur.start_date;
    const endDate = input.endDate !== undefined ? cleanDay(input.endDate, "The end date") : cur.end_date;
    if (startDate && endDate && endDate < startDate) throw new HttpError(400, "invalid_date", "The end date cannot be before the start date.");
    const next = { name, workEmail, employeeCode, employmentType, startDate, endDate };
    const prev = { name: cur.display_name, workEmail: cur.work_email, employeeCode: cur.employee_code, employmentType: cur.employment_type, startDate: cur.start_date, endDate: cur.end_date };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== prev[k]);
    if (changed.length === 0) return { id };
    this.o.store.transaction(() => {
      repo.updatePerson({ id, displayName: name, workEmail, employeeCode, employmentType, startDate, endDate, now: this.o.auth.iso() });
      // Details are recorded by field name only (no email or code in the log).
      this.o.audit.record(tdb, ctx, { action: "person.update", entityType: "membership", entityId: id, summary: `Changed the details of ${name} (${changed.join(", ")})`, before: { fields: changed }, after: { fields: changed } });
    });
    return { id };
  }

  /** A new designation row; the old one ends on the new one's start day. */
  setDesignation(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: { designationId: string; startDate?: string | null; reason?: string | null }): { id: string } {
    const ctx = this.ctx(auth, requestId);
    const tdb = this.o.store.tenant(ctx);
    const repo = this.o.store.people(tdb);
    const person = repo.person(id);
    if (!person || !scopeContainsMember(caps.scope("people.manage"), id)) throw notFound();
    if (person.archived_at) throw new HttpError(409, "archived", "This person is archived.");
    const designation = this.o.store.structure(tdb).designation(input.designationId);
    if (!designation) throw notFound();
    if (designation.archived_at) throw new HttpError(409, "archived", "That designation is archived.");
    const today = this.today();
    const startDate = cleanDay(input.startDate, "The start date") ?? today;
    if (startDate > today) throw new HttpError(400, "future_date", "A designation change takes effect today or on an earlier date. It cannot be scheduled for the future.");
    const open = repo.openDesignation(id);
    if (open && open.designation_id === designation.id) throw new HttpError(409, "no_change", "This person already holds that designation.");
    if (open && startDate < open.start_date) throw new HttpError(400, "before_current_start", `The new designation cannot start before the current one did (${open.start_date}).`);
    const reason = cleanText(input.reason, 200, "The reason");
    const now = this.o.auth.iso();
    const before = open ? this.o.store.structure(tdb).designation(open.designation_id)?.name ?? null : null;
    this.o.store.transaction(() => {
      if (open) repo.endDesignation(open.id, startDate);
      repo.insertDesignation({ id: newId(), membershipId: id, designationId: designation.id, startDate, reason, createdBy: ctx.membershipId, now });
      repo.setDesignationCache(id, designation.id, now);
      this.o.audit.record(tdb, ctx, { action: "person.designation", entityType: "membership", entityId: id, summary: `Changed the designation of ${person.display_name}${before ? ` from ${before}` : ""} to ${designation.name}, from ${startDate}`, before: { designation: before }, after: { designation: designation.name, startDate } });
    });
    return { id };
  }

  /** A person without a login leaves the directory. Their placements and reporting lines end today; nothing is deleted. */
  archive(auth: AuthContext, requestId: string, caps: Capabilities, id: string): void {
    const ctx = this.ctx(auth, requestId);
    const tdb = this.o.store.tenant(ctx);
    const repo = this.o.store.people(tdb);
    const person = repo.person(id);
    if (!person || !scopeContainsMember(caps.scope("people.manage"), id)) throw notFound();
    if (person.archived_at) throw new HttpError(409, "already_archived", "This person is already archived.");
    if (person.id === ctx.membershipId) throw new HttpError(409, "use_delete_account", "To leave the organization yourself, use Delete my account.");
    if (person.user_id !== null) throw new HttpError(409, "has_login", "This person has a login. Use Remove from organization on the Users page.");
    if (person.status !== "active") throw new HttpError(409, "invited", "This person has a pending invitation. Revoke the invitation on the Users page instead.");
    const today = this.today();
    const reports = repo.reportingRows({ membershipId: id, asOf: today }).filter((r) => r.manager_membership_id === id && SCOPE_LINE_TYPES.has(r.relationship_type));
    if (reports.length > 0) {
      throw new HttpError(409, "has_reports", `${reports.length} ${reports.length === 1 ? "person reports" : "people report"} to ${person.display_name}. Give them another manager first.`, { reports: reports.length });
    }
    this.o.store.transaction(() => {
      const ended = repo.endEverythingFor(id, today);
      repo.setArchived(id, this.o.auth.iso(), "left", this.o.auth.iso());
      this.o.audit.record(tdb, ctx, { action: "person.archive", entityType: "membership", entityId: id, summary: `Archived ${person.display_name}; ${ended} ${ended === 1 ? "placement or reporting line" : "placements and reporting lines"} ended`, after: { ended } });
    });
  }

  restore(auth: AuthContext, requestId: string, caps: Capabilities, id: string): { id: string } {
    const ctx = this.ctx(auth, requestId);
    const tdb = this.o.store.tenant(ctx);
    const repo = this.o.store.people(tdb);
    const person = repo.person(id);
    if (!person || !scopeContainsMember(caps.scope("people.manage"), id)) throw notFound();
    if (!person.archived_at || person.user_id !== null) throw new HttpError(409, "not_archived", "This person is not archived.");
    this.o.store.transaction(() => {
      repo.setArchived(id, null, "active", this.o.auth.iso());
      this.o.audit.record(tdb, ctx, { action: "person.restore", entityType: "membership", entityId: id, summary: `Restored ${person.display_name}` });
    });
    return { id };
  }

  // ---------- helpers ----------

  /** The caller may always see themselves; others only inside their `people.view` scope. */
  canView(auth: AuthContext, caps: Capabilities, id: string): boolean {
    return id === auth.membershipId || scopeContainsMember(caps.scope("people.view"), id);
  }
  isLive = (p: PersonRow): boolean => p.archived_at === null && p.status !== "left";

  private cleanEmail(raw: string | null | undefined): string | null {
    const e = cleanText(raw ?? null, 200, "The email address");
    if (e !== null && !EMAIL.test(e)) throw new HttpError(400, "invalid_email", "That does not look like an email address.");
    return e;
  }
  private cleanEmployment(raw: string | null | undefined): string | null {
    if (raw === undefined || raw === null || raw === "") return null;
    if (!(EMPLOYMENT_TYPES as readonly string[]).includes(raw)) throw new HttpError(400, "invalid_employment_type", `Employment type is one of: ${EMPLOYMENT_TYPES.join(", ")}.`);
    return raw;
  }

  /** Names for the ids in this organization's structure and people. */
  refs(ctx: TenantCtx) {
    const tdb = this.o.store.tenant(ctx);
    const s = this.o.store.structure(tdb);
    const deptRows = new Map(s.departments().map((d) => [d.id, d]));
    const teamRows = new Map(s.teams().map((t) => [t.id, t]));
    const desRows = new Map(s.designations().map((d) => [d.id, d]));
    const famRows = new Map(s.roleFamilies().map((f) => [f.id, f]));
    const people = new Map(this.o.store.people(tdb).people().map((p) => [p.id, p.display_name]));
    return {
      people,
      department: (id: string): Ref => ({ id, name: deptRows.get(id)?.name ?? "Department" }),
      team: (id: string): Ref => ({ id, name: teamRows.get(id)?.name ?? "Team" }),
      teamDepartment: (id: string): string => teamRows.get(id)?.department_id ?? "",
      designation: (id: string | null): Ref | null => (id && desRows.has(id) ? { id, name: desRows.get(id)!.name } : null),
      familyOf: (designationId: string | null): Ref | null => {
        const fid = designationId ? desRows.get(designationId)?.role_family_id : null;
        return fid && famRows.has(fid) ? { id: fid, name: famRows.get(fid)!.name } : null;
      },
    };
  }

  /** Each person's current departments, teams and managers (as of today). */
  placements(ctx: TenantCtx, asOf: string, ref: ReturnType<PeopleService["refs"]>): Map<string, { departments: (Ref & { type: string })[]; teams: (Ref & { type: string })[]; managers: (Ref & { type: string })[] }> {
    const repo = this.o.store.people(this.o.store.tenant(ctx));
    const out = new Map<string, { departments: (Ref & { type: string })[]; teams: (Ref & { type: string })[]; managers: (Ref & { type: string })[] }>();
    const at = (id: string) => {
      let v = out.get(id);
      if (!v) out.set(id, (v = { departments: [], teams: [], managers: [] }));
      return v;
    };
    for (const r of repo.deptRows({ asOf })) at(r.membership_id).departments.push({ ...ref.department(r.department_id), type: r.membership_type });
    for (const r of repo.teamRows({ asOf })) at(r.membership_id).teams.push({ ...ref.team(r.team_id), type: r.membership_type });
    for (const r of repo.reportingRows({ asOf })) at(r.subordinate_membership_id).managers.push({ id: r.manager_membership_id, name: ref.people.get(r.manager_membership_id) ?? "Former member", type: r.relationship_type });
    return out;
  }

  private summary(p: PersonRow, pl: { departments: (Ref & { type: string })[]; teams: (Ref & { type: string })[]; managers: (Ref & { type: string })[] } | undefined, ref: ReturnType<PeopleService["refs"]>, sensitive: boolean): PersonSummary {
    return {
      id: p.id,
      displayName: p.display_name,
      status: p.status,
      hasLogin: p.user_id !== null,
      archived: p.archived_at !== null,
      isDemo: p.is_demo === 1,
      designation: ref.designation(p.designation_id),
      departments: pl?.departments ?? [],
      teams: pl?.teams ?? [],
      managers: pl?.managers ?? [],
      email: sensitive ? p.work_email : null,
    };
  }
}

/** Used by the hierarchy service too: the caller must hold `hierarchy.manage` over this person. */
export const mustManage = (caps: Capabilities, key: string, id: string): void => {
  if (!scopeContainsMember(caps.scope(key), id)) throw notFound();
};
