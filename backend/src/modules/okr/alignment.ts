import type { TenantCtx } from "../../db/tenant.js";
import { HttpError, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import type { AuditService } from "../audit/service.js";
import type { AuthStore } from "../auth/repositories/store.js";
import type { AuthContext, AuthService } from "../auth/service.js";
import type { Capabilities } from "../permissions/service.js";
import { todayIn } from "../tasks/dates.js";
import type { ObjectiveSummary, OkrService } from "./service.js";

/** Higher in the company = smaller number. A parent must sit strictly above its child. */
const RANK: Readonly<Record<string, number>> = { company: 0, department: 1, team: 2, individual: 3 };

export interface LinkedObjective { id: string; title: string; level: string; lifecycle: string; health: string | null; attainmentPct: number | null; dataState: string; owner: { id: string; name: string } | null }
export interface AlignmentView {
  parent: { relationshipId: string; weight: number; objective: LinkedObjective | null; hidden: boolean } | null;
  children: { relationshipId: string; weight: number; objective: LinkedObjective }[];
  hiddenChildren: number;
  assignments: { id: string; kind: "person" | "team" | "department"; id2: string; name: string; role: string; startDate: string }[];
  can: { assign: boolean };
}
export interface TreeNode extends LinkedObjective {
  /** Weight of this objective among its siblings under the same parent, and its share of the parent: weight share × attainment. */
  weight: number | null;
  contributionPct: number | null;
  unaligned: boolean;
  hiddenChildren: number;
  children: TreeNode[];
}
export interface GapItem { id: string; title: string; level: string; reason: string }
export interface GapsReport { unaligned: GapItem[]; notBrokenDown: GapItem[]; unmeasurable: GapItem[]; noData: GapItem[]; behindPace: GapItem[]; overdue: GapItem[] }

const link = (s: ObjectiveSummary): LinkedObjective => ({ id: s.id, title: s.title, level: s.level, lifecycle: s.lifecycle, health: s.health, attainmentPct: s.attainmentPct, dataState: s.dataState, owner: s.owner });

/**
 * Alignment between objectives (stage 3.2): who contributes to whom, who else works on an objective, the contribution tree and
 * the gaps report. A child has at most one active parent and a parent sits at a higher level, so the graph cannot loop (the
 * walk below checks anyway). Everything is filtered to what the caller may see; an objective they cannot see is never named.
 */
export class AlignmentService {
  constructor(private readonly o: { store: AuthStore; auth: AuthService; audit: AuditService; okr: OkrService }) {}

  private ctx(auth: AuthContext, requestId: string): TenantCtx {
    return this.o.auth.tenantCtx(auth, requestId);
  }
  private now = (): string => this.o.auth.iso();

  alignment(auth: AuthContext, requestId: string, caps: Capabilities, id: string): AlignmentView {
    const ctx = this.ctx(auth, requestId);
    const me = this.o.okr.access(ctx, caps, id);
    if (!me) throw notFound();
    const tdb = this.o.store.tenant(ctx);
    const repo = this.o.store.okr(tdb);
    const visible = new Map(this.o.okr.allVisible(ctx, caps).map((v) => [v.summary.id, v.summary]));
    const rels = repo.relationships();
    const up = rels.find((r) => r.child_objective_id === id);
    const down = rels.filter((r) => r.parent_objective_id === id);
    const names = new Map(this.o.store.people(tdb).people().map((p) => [p.id, p.display_name]));
    const teams = new Map(this.o.store.structure(tdb).teams().map((t) => [t.id, t.name]));
    const depts = new Map(this.o.store.structure(tdb).departments().map((d) => [d.id, d.name]));
    const children = down.filter((r) => visible.has(r.child_objective_id)).map((r) => ({ relationshipId: r.id, weight: r.contribution_weight, objective: link(visible.get(r.child_objective_id)!) }));
    return {
      parent: up ? { relationshipId: up.id, weight: up.contribution_weight, objective: visible.has(up.parent_objective_id) ? link(visible.get(up.parent_objective_id)!) : null, hidden: !visible.has(up.parent_objective_id) } : null,
      children,
      hiddenChildren: down.length - children.length,
      assignments: repo.assignments().filter((a) => a.objective_id === id).map((a) => (a.assignee_membership_id ? { id: a.id, kind: "person" as const, id2: a.assignee_membership_id, name: names.get(a.assignee_membership_id) ?? "Former member", role: a.role, startDate: a.start_date } : a.assignee_team_id ? { id: a.id, kind: "team" as const, id2: a.assignee_team_id, name: teams.get(a.assignee_team_id) ?? "Team", role: a.role, startDate: a.start_date } : { id: a.id, kind: "department" as const, id2: a.assignee_department_id!, name: depts.get(a.assignee_department_id!) ?? "Department", role: a.role, startDate: a.start_date })),
      can: { assign: me.canAssign },
    };
  }

  /** Makes `parentId` the parent of this objective (replacing an earlier parent). */
  setParent(auth: AuthContext, requestId: string, caps: Capabilities, childId: string, input: { parentId: string; weight?: number }): AlignmentView {
    const ctx = this.ctx(auth, requestId);
    const child = this.o.okr.access(ctx, caps, childId);
    const parent = this.o.okr.access(ctx, caps, input.parentId);
    if (!child || !parent) throw notFound();
    if (!child.canAssign) throw new HttpError(403, "permission_denied", "You cannot change how this objective is aligned.");
    if (childId === input.parentId) throw new HttpError(400, "self_link", "An objective cannot contribute to itself.");
    if (child.row.lifecycle === "cancelled" || parent.row.lifecycle === "cancelled") throw new HttpError(409, "objective_closed", "A cancelled objective cannot be aligned.");
    if ((RANK[parent.row.level] ?? 9) >= (RANK[child.row.level] ?? 0)) throw new HttpError(400, "wrong_level", `A ${child.row.level} objective can only contribute to one at a higher level (${Object.keys(RANK).filter((k) => RANK[k]! < (RANK[child.row.level] ?? 0)).join(", ") || "none"}).`);
    const weight = input.weight ?? 1;
    if (!Number.isFinite(weight) || weight <= 0 || weight > 100) throw new HttpError(400, "invalid_number", "The contribution weight is more than 0 and at most 100.");
    const tdb = this.o.store.tenant(ctx);
    const repo = this.o.store.okr(tdb);
    const rels = repo.relationships();
    if (this.reaches(rels, childId, input.parentId)) throw new HttpError(409, "alignment_loop", "That would make the objectives contribute to each other in a loop.");
    const existing = rels.find((r) => r.child_objective_id === childId);
    if (existing && existing.parent_objective_id === input.parentId && existing.contribution_weight === weight) return this.alignment(auth, requestId, caps, childId);
    const now = this.now();
    this.o.store.transaction(() => {
      if (existing) repo.endRelationship(existing.id, now);
      repo.insertRelationship({ id: newId(), parentId: input.parentId, childId, weight, by: ctx.membershipId, now });
      this.o.audit.record(tdb, ctx, { action: "objective.align", entityType: "objective", entityId: childId, summary: `Aligned the objective "${child.row.title}" to "${parent.row.title}" (weight ${weight})${existing ? " replacing its earlier parent" : ""}`, before: existing ? { parentId: existing.parent_objective_id } : null, after: { parentId: input.parentId, weight } });
    });
    return this.alignment(auth, requestId, caps, childId);
  }

  clearParent(auth: AuthContext, requestId: string, caps: Capabilities, childId: string): AlignmentView {
    const ctx = this.ctx(auth, requestId);
    const child = this.o.okr.access(ctx, caps, childId);
    if (!child) throw notFound();
    if (!child.canAssign) throw new HttpError(403, "permission_denied", "You cannot change how this objective is aligned.");
    const tdb = this.o.store.tenant(ctx);
    const repo = this.o.store.okr(tdb);
    const existing = repo.relationships().find((r) => r.child_objective_id === childId);
    if (!existing) throw notFound();
    this.o.store.transaction(() => {
      repo.endRelationship(existing.id, this.now());
      this.o.audit.record(tdb, ctx, { action: "objective.unalign", entityType: "objective", entityId: childId, summary: `Took the objective "${child.row.title}" out of its alignment`, before: { parentId: existing.parent_objective_id } });
    });
    return this.alignment(auth, requestId, caps, childId);
  }

  private reaches(rels: { parent_objective_id: string; child_objective_id: string }[], from: string, target: string): boolean {
    // walking UP from `target`: if `from` is an ancestor of `target`, making `target` the parent of `from` would loop
    const parentOf = new Map(rels.map((r) => [r.child_objective_id, r.parent_objective_id]));
    for (let cur: string | undefined = target, n = 0; cur && n < 50; cur = parentOf.get(cur), n++) if (cur === from) return true;
    return false;
  }

  assign(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: { assigneeId?: string; teamId?: string; departmentId?: string; role?: string }): AlignmentView {
    const ctx = this.ctx(auth, requestId);
    const target = this.o.okr.access(ctx, caps, id);
    if (!target) throw notFound();
    if (!target.canAssign) throw new HttpError(403, "permission_denied", "You cannot assign people to this objective.");
    if (target.row.lifecycle === "completed" || target.row.lifecycle === "cancelled") throw new HttpError(409, "objective_closed", "This objective is finished or cancelled. Reopen it first.");
    const given = [input.assigneeId, input.teamId, input.departmentId].filter(Boolean).length;
    if (given !== 1) throw new HttpError(400, "validation_failed", "Request did not pass validation", [{ path: "assigneeId", message: "Give one person, team or department" }]);
    const role = input.role ?? "contributor";
    if (role !== "contributor" && role !== "reviewer") throw new HttpError(400, "invalid_role", "A role is contributor or reviewer.");
    const tdb = this.o.store.tenant(ctx);
    const repo = this.o.store.okr(tdb);
    const scope = caps.scope("okr.assign");
    let label = "";
    if (input.assigneeId) {
      const p = this.o.store.people(tdb).person(input.assigneeId);
      if (!p) throw notFound();
      if (p.archived_at !== null || p.status === "left") throw new HttpError(409, "archived", `${p.display_name} no longer belongs to the organization.`);
      if (!(scope.all || scope.members.has(p.id) || p.id === ctx.membershipId)) throw new HttpError(403, "outside_scope", "You can assign people in your scope.");
      label = p.display_name;
    } else if (input.teamId) {
      const t = this.o.store.structure(tdb).team(input.teamId);
      if (!t) throw notFound();
      if (t.archived_at) throw new HttpError(409, "archived", "That team is archived.");
      if (!(scope.all || scope.teams.has(t.id))) throw new HttpError(403, "outside_scope", "You can assign teams in your scope.");
      label = t.name;
    } else {
      const d = this.o.store.structure(tdb).department(input.departmentId!);
      if (!d) throw notFound();
      if (d.archived_at) throw new HttpError(409, "archived", "That department is archived.");
      if (!(scope.all || scope.departments.has(d.id))) throw new HttpError(403, "outside_scope", "You can assign departments in your scope.");
      label = d.name;
    }
    const dupe = repo.assignments().some((a) => a.objective_id === id && a.role === role && (input.assigneeId ? a.assignee_membership_id === input.assigneeId : input.teamId ? a.assignee_team_id === input.teamId : a.assignee_department_id === input.departmentId));
    if (dupe) throw new HttpError(409, "already_assigned", "That is already assigned to this objective.");
    const now = this.now();
    this.o.store.transaction(() => {
      repo.insertAssignment({ id: newId(), objectiveId: id, membershipId: input.assigneeId ?? null, teamId: input.teamId ?? null, departmentId: input.departmentId ?? null, role, startDate: now.slice(0, 10), by: ctx.membershipId, now });
      this.o.audit.record(tdb, ctx, { action: "objective.assign", entityType: "objective", entityId: id, summary: `Added ${label} as ${role} on the objective "${target.row.title}"`, after: { assignee: input.assigneeId ?? input.teamId ?? input.departmentId, role } });
    });
    return this.alignment(auth, requestId, caps, id);
  }

  unassign(auth: AuthContext, requestId: string, caps: Capabilities, id: string, assignmentId: string): AlignmentView {
    const ctx = this.ctx(auth, requestId);
    const target = this.o.okr.access(ctx, caps, id);
    const tdb = this.o.store.tenant(ctx);
    const repo = this.o.store.okr(tdb);
    const a = repo.assignment(assignmentId);
    if (!target || !a || a.objective_id !== id) throw notFound();
    if (!target.canAssign) throw new HttpError(403, "permission_denied", "You cannot change who works on this objective.");
    if (a.end_date) throw new HttpError(409, "already_ended", "That assignment has already ended.");
    this.o.store.transaction(() => {
      repo.endAssignment(assignmentId, this.now().slice(0, 10));
      this.o.audit.record(tdb, ctx, { action: "objective.unassign", entityType: "objective", entityId: id, summary: `Took someone off the objective "${target.row.title}"`, before: { role: a.role } });
    });
    return this.alignment(auth, requestId, caps, id);
  }

  // ---------- the contribution tree ----------

  tree(auth: AuthContext, requestId: string, caps: Capabilities, q: { rootId?: string; includeClosed?: boolean }): { roots: TreeNode[]; total: number } {
    const ctx = this.ctx(auth, requestId);
    const tdb = this.o.store.tenant(ctx);
    const rels = this.o.store.okr(tdb).relationships();
    const all = this.o.okr.allVisible(ctx, caps).filter((v) => q.includeClosed || (v.row.lifecycle !== "cancelled" && v.row.lifecycle !== "completed"));
    const byId = new Map(all.map((v) => [v.summary.id, v.summary]));
    const kids = new Map<string, { id: string; weight: number }[]>();
    const parentOf = new Map<string, string>();
    for (const r of rels) {
      parentOf.set(r.child_objective_id, r.parent_objective_id);
      kids.set(r.parent_objective_id, [...(kids.get(r.parent_objective_id) ?? []), { id: r.child_objective_id, weight: r.contribution_weight }]);
    }
    const totalKids = new Map([...kids].map(([k, v]) => [k, v.length]));
    const build = (id: string, weight: number | null, siblingTotal: number, depth: number): TreeNode => {
      const s = byId.get(id)!;
      const own = (kids.get(id) ?? []).filter((c) => byId.has(c.id));
      const sum = own.reduce((n, c) => n + c.weight, 0);
      const share = weight !== null && siblingTotal > 0 ? weight / siblingTotal : null;
      return {
        ...link(s),
        weight,
        contributionPct: share !== null && s.attainmentPct !== null ? Math.round(share * s.attainmentPct) : null,
        unaligned: s.level !== "company" && !parentOf.has(id),
        hiddenChildren: (totalKids.get(id) ?? 0) - own.length,
        children: depth >= 6 ? [] : own.map((c) => build(c.id, c.weight, sum, depth + 1)),
      };
    };
    const rootIds = q.rootId ? (byId.has(q.rootId) ? [q.rootId] : []) : all.filter((v) => !parentOf.has(v.summary.id) || !byId.has(parentOf.get(v.summary.id)!)).map((v) => v.summary.id);
    if (q.rootId && !byId.has(q.rootId)) throw notFound();
    const order = (a: string, b: string): number => (RANK[byId.get(a)!.level] ?? 9) - (RANK[byId.get(b)!.level] ?? 9) || byId.get(a)!.title.localeCompare(byId.get(b)!.title);
    return { roots: rootIds.sort(order).map((id) => build(id, null, 0, 0)), total: all.length };
  }

  // ---------- the gaps report ----------

  gaps(auth: AuthContext, requestId: string, caps: Capabilities): GapsReport {
    const ctx = this.ctx(auth, requestId);
    const tdb = this.o.store.tenant(ctx);
    const repo = this.o.store.okr(tdb);
    const rels = repo.relationships();
    const parentOf = new Set(rels.map((r) => r.child_objective_id));
    const hasChild = new Set(rels.map((r) => r.parent_objective_id));
    const krCount = new Map<string, number>();
    for (const k of repo.keyResults()) krCount.set(k.objective_id, (krCount.get(k.objective_id) ?? 0) + 1);
    const org = this.o.store.orgs.findById(ctx.organizationId);
    const today = todayIn(org?.timezone ?? "UTC", new Date(this.now()));
    const out: GapsReport = { unaligned: [], notBrokenDown: [], unmeasurable: [], noData: [], behindPace: [], overdue: [] };
    for (const { row, summary: s } of this.o.okr.allVisible(ctx, caps)) {
      if (row.lifecycle === "cancelled" || row.lifecycle === "completed") continue;
      const item = (reason: string): GapItem => ({ id: s.id, title: s.title, level: s.level, reason });
      if (row.level !== "company" && !parentOf.has(s.id)) out.unaligned.push(item("It does not contribute to any higher objective."));
      if ((row.level === "company" || row.level === "department") && row.lifecycle === "active" && !hasChild.has(s.id)) out.notBrokenDown.push(item(row.level === "company" ? "No department objective contributes to it yet." : "No team objective contributes to it yet."));
      if (row.lifecycle === "active" && (krCount.get(s.id) ?? 0) === 0) out.unmeasurable.push(item("It has no key results, so its progress cannot be measured."));
      if (s.health === "no_data") out.noData.push(item(s.healthReason));
      if (s.health === "at_risk" || s.health === "delayed") out.behindPace.push(item(s.healthReason));
      if (row.lifecycle === "active" && row.end_date < today) out.overdue.push(item(`The end date (${row.end_date}) has passed.`));
    }
    return out;
  }
}
