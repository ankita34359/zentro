import type { TenantCtx } from "../../db/tenant.js";
import { HttpError, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import type { AuditService } from "../audit/service.js";
import type { AuthStore } from "../auth/repositories/store.js";
import type { AuthContext, AuthService } from "../auth/service.js";
import type { ScopeSet } from "../permissions/resolver.js";
import type { Capabilities } from "../permissions/service.js";
import { todayIn } from "../tasks/dates.js";
import type { KpiAssignmentRow, KpiRow, ThresholdRow } from "./repositories/kpi.js";

export const CATEGORIES = ["delivery", "quality", "impact", "financial", "growth", "people", "health"] as const;
export const VALUE_TYPES = ["number", "percentage", "currency", "count"] as const;
export const DIRECTIONS = ["higher_is_better", "lower_is_better", "target_range"] as const;
export const FREQUENCIES = ["daily", "weekly", "monthly", "quarterly", "annual"] as const;
export const AGGREGATIONS = ["sum", "avg", "last", "min", "max"] as const;
export const LEVELS = ["excellent", "warning", "critical"] as const;
export const COMPARATORS = ["lt", "lte", "gt", "gte"] as const;
export const BASES = ["absolute", "percent_of_target"] as const;

export interface KpiView {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  unit: string | null;
  valueType: string;
  direction: string;
  frequency: string;
  aggregation: string;
  defaultTarget: number | null;
  defaultTargetMax: number | null;
  archived: boolean;
  isDemo: boolean;
  /** Active assignments the caller may see. */
  assignmentCount: number;
}
export interface SubjectRef { kind: "person" | "team" | "department" | "designation" | "role_family"; id: string; name: string }
export interface AssignmentView {
  id: string;
  subject: SubjectRef;
  targetValue: number;
  targetMax: number | null;
  weight: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
  /** How many people this assignment covers today (a team, department, designation or role family covers its current members). */
  appliesTo: number;
}
export interface ThresholdView { id: string; level: string; comparator: string; basis: string; value: number; notify: boolean }
export interface KpiDetail extends KpiView {
  assignments: AssignmentView[];
  thresholds: ThresholdView[];
  can: { configure: boolean; assign: boolean; record: boolean };
}
export interface KpiInput {
  key?: string;
  name: string;
  description?: string;
  category?: string;
  unit?: string | null;
  valueType?: string;
  direction?: string;
  frequency?: string;
  aggregation?: string;
  defaultTarget?: number | null;
  defaultTargetMax?: number | null;
}
export interface AssignmentInput {
  assigneeId?: string;
  teamId?: string;
  departmentId?: string;
  designationId?: string;
  roleFamilyId?: string;
  targetValue?: number;
  targetMax?: number | null;
  weight?: number;
  effectiveFrom?: string;
  effectiveTo?: string | null;
}

const isDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const oneOf = <T extends string>(v: string, list: readonly T[], what: string): T => {
  if (!(list as readonly string[]).includes(v)) throw new HttpError(400, "invalid_value", `${what} is one of: ${list.join(", ")}.`);
  return v as T;
};
const num = (v: number, what: string): number => {
  if (!Number.isFinite(v) || Math.abs(v) > 1e12) throw new HttpError(400, "invalid_number", `${what} must be a number.`);
  return v;
};
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/**
 * KPI definitions, assignments and thresholds (stage 3.3). A KPI is a named, repeatedly measured indicator ("Qualified leads
 * per month"). Its definition is shared; what a person sees of its ASSIGNMENTS (who has which target) follows their scope:
 * people, teams and departments inside their `kpi.view` scope, anything assigned to them, and the designation or role family
 * they hold. Configuring KPIs and thresholds needs `kpi.configure` over everyone; assigning a person, team or department needs
 * `kpi.assign` over them, and assigning a whole designation or role family needs it over everyone.
 */
export class KpiService {
  constructor(private readonly o: { store: AuthStore; auth: AuthService; audit: AuditService }) {}

  private ctx(auth: AuthContext, requestId: string): TenantCtx {
    return this.o.auth.tenantCtx(auth, requestId);
  }
  private now = (): string => this.o.auth.iso();

  private world(ctx: TenantCtx) {
    const tdb = this.o.store.tenant(ctx);
    const kpi = this.o.store.kpi(tdb);
    const org = this.o.store.orgs.findById(ctx.organizationId);
    const today = todayIn(org?.timezone ?? "UTC", new Date(this.now()));
    const people = this.o.store.people(tdb);
    const structure = this.o.store.structure(tdb);
    const live = people.people().filter((p) => p.archived_at === null && p.status !== "left");
    const names = new Map(people.people().map((p) => [p.id, p.display_name]));
    const teams = new Map(structure.teams().map((t) => [t.id, t]));
    const depts = new Map(structure.departments().map((d) => [d.id, d]));
    const designations = new Map(structure.designations().map((d) => [d.id, d]));
    const families = new Map(structure.roleFamilies().map((f) => [f.id, f]));
    const me = people.person(ctx.membershipId);
    const myDesignation = me?.designation_id ?? null;
    const myFamily = myDesignation ? designations.get(myDesignation)?.role_family_id ?? null : null;
    const teamMembers = new Map<string, Set<string>>();
    for (const r of people.teamRows({ asOf: today })) teamMembers.set(r.team_id, new Set([...(teamMembers.get(r.team_id) ?? []), r.membership_id]));
    const deptMembers = new Map<string, Set<string>>();
    for (const r of people.deptRows({ asOf: today })) deptMembers.set(r.department_id, new Set([...(deptMembers.get(r.department_id) ?? []), r.membership_id]));
    const liveIds = new Set(live.map((p) => p.id));
    return { tdb, kpi, today, people, structure, live, liveIds, names, teams, depts, designations, families, myDesignation, myFamily, teamMembers, deptMembers, myTeams: new Set([...teamMembers].filter(([, m]) => m.has(ctx.membershipId)).map(([t]) => t)), myDepts: new Set([...deptMembers].filter(([, m]) => m.has(ctx.membershipId)).map(([d]) => d)) };
  }
  private subjectOf(w: ReturnType<KpiService["world"]>, a: KpiAssignmentRow): SubjectRef {
    if (a.membership_id) return { kind: "person", id: a.membership_id, name: w.names.get(a.membership_id) ?? "Former member" };
    if (a.team_id) return { kind: "team", id: a.team_id, name: w.teams.get(a.team_id)?.name ?? "Team" };
    if (a.department_id) return { kind: "department", id: a.department_id, name: w.depts.get(a.department_id)?.name ?? "Department" };
    if (a.designation_id) return { kind: "designation", id: a.designation_id, name: w.designations.get(a.designation_id)?.name ?? "Designation" };
    return { kind: "role_family", id: a.role_family_id!, name: w.families.get(a.role_family_id!)?.name ?? "Role family" };
  }
  /** The people an assignment covers today. */
  holders(w: ReturnType<KpiService["world"]>, a: KpiAssignmentRow): string[] {
    if (a.membership_id) return w.liveIds.has(a.membership_id) ? [a.membership_id] : [];
    if (a.team_id) return [...(w.teamMembers.get(a.team_id) ?? [])].filter((m) => w.liveIds.has(m));
    if (a.department_id) return [...(w.deptMembers.get(a.department_id) ?? [])].filter((m) => w.liveIds.has(m));
    if (a.designation_id) return w.live.filter((p) => p.designation_id === a.designation_id).map((p) => p.id);
    const fam = a.role_family_id;
    return w.live.filter((p) => p.designation_id && w.designations.get(p.designation_id)?.role_family_id === fam).map((p) => p.id);
  }

  // ---------- who may see which assignment ----------

  private seesAssignment(w: ReturnType<KpiService["world"]>, scope: ScopeSet, me: string, a: KpiAssignmentRow): boolean {
    if (scope.all) return true;
    if (a.membership_id) return a.membership_id === me || scope.members.has(a.membership_id);
    if (a.team_id) return scope.teams.has(a.team_id) || w.myTeams.has(a.team_id);
    if (a.department_id) return scope.departments.has(a.department_id) || w.myDepts.has(a.department_id);
    if (a.designation_id) return a.designation_id === w.myDesignation;
    return a.role_family_id === w.myFamily;
  }
  private requireView(caps: Capabilities): ScopeSet {
    const s = caps.scope("kpi.view");
    if (!caps.has("kpi.view")) throw new HttpError(403, "permission_denied", "Not allowed");
    return s;
  }
  private requireConfigure(caps: Capabilities): void {
    if (!caps.scope("kpi.configure").all) throw new HttpError(403, "permission_denied", "You cannot configure KPIs.");
  }

  // ---------- views ----------

  private view(w: ReturnType<KpiService["world"]>, k: KpiRow, visibleAssignments: KpiAssignmentRow[]): KpiView {
    return {
      id: k.id, key: k.key, name: k.name, description: k.description, category: k.category, unit: k.unit, valueType: k.value_type, direction: k.direction, frequency: k.frequency, aggregation: k.aggregation,
      defaultTarget: k.default_target, defaultTargetMax: k.default_target_max, archived: k.archived_at !== null, isDemo: k.is_demo === 1,
      assignmentCount: visibleAssignments.filter((a) => a.kpi_id === k.id && (a.effective_to === null || a.effective_to >= w.today)).length,
    };
  }
  private assignmentView(w: ReturnType<KpiService["world"]>, a: KpiAssignmentRow): AssignmentView {
    const active = a.effective_from <= w.today && (a.effective_to === null || a.effective_to >= w.today);
    return { id: a.id, subject: this.subjectOf(w, a), targetValue: a.target_value, targetMax: a.target_max, weight: a.weight, effectiveFrom: a.effective_from, effectiveTo: a.effective_to, active, appliesTo: active ? this.holders(w, a).length : 0 };
  }

  list(auth: AuthContext, requestId: string, caps: Capabilities, q: { category?: string; frequency?: string; search?: string; includeArchived?: boolean; assignedToMe?: boolean }): KpiView[] {
    const scope = this.requireView(caps);
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const visible = w.kpi.assignments().filter((a) => this.seesAssignment(w, scope, ctx.membershipId, a));
    const needle = q.search?.trim().toLowerCase();
    const mine = new Set(w.kpi.assignments().filter((a) => this.holders(w, a).includes(ctx.membershipId)).map((a) => a.kpi_id));
    return w.kpi
      .kpis(q.includeArchived === true && caps.scope("kpi.configure").all)
      .filter((k) => (!q.category || k.category === q.category) && (!q.frequency || k.frequency === q.frequency) && (!needle || k.name.toLowerCase().includes(needle) || k.key.includes(needle)) && (!q.assignedToMe || mine.has(k.id)))
      .map((k) => this.view(w, k, visible));
  }

  detail(auth: AuthContext, requestId: string, caps: Capabilities, id: string): KpiDetail {
    const scope = this.requireView(caps);
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const k = w.kpi.kpi(id);
    if (!k || (k.archived_at && !caps.scope("kpi.configure").all)) throw notFound();
    return this.toDetail(w, caps, scope, ctx.membershipId, k);
  }
  private toDetail(w: ReturnType<KpiService["world"]>, caps: Capabilities, scope: ScopeSet, me: string, k: KpiRow): KpiDetail {
    const asg = w.kpi.assignments().filter((a) => a.kpi_id === k.id && this.seesAssignment(w, scope, me, a));
    return {
      ...this.view(w, k, asg),
      assignments: asg.map((a) => this.assignmentView(w, a)),
      thresholds: w.kpi.thresholds(k.id).map((t): ThresholdView => ({ id: t.id, level: t.level, comparator: t.comparator, basis: t.basis, value: t.value, notify: t.notify === 1 })),
      can: { configure: caps.scope("kpi.configure").all, assign: caps.has("kpi.assign"), record: caps.has("kpi.record") },
    };
  }

  // ---------- definitions ----------

  private clean(input: KpiInput, base?: KpiRow) {
    const name = (input.name ?? base?.name ?? "").replace(/\s+/g, " ").trim();
    // eslint-disable-next-line no-control-regex
    if (name.length < 1 || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new HttpError(400, "invalid_title", "A KPI name is 1 to 80 characters.");
    const description = (input.description ?? base?.description ?? "").trim();
    if (description.length > 1000) throw new HttpError(400, "invalid_text", "The description is at most 1000 characters.");
    const unit = input.unit === undefined ? base?.unit ?? null : (input.unit ?? "").trim() || null;
    if (unit && unit.length > 20) throw new HttpError(400, "invalid_text", "The unit is at most 20 characters.");
    const direction = oneOf(input.direction ?? base?.direction ?? "higher_is_better", DIRECTIONS, "A direction");
    const defaultTarget = input.defaultTarget === undefined ? base?.default_target ?? null : input.defaultTarget === null ? null : num(input.defaultTarget, "The default target");
    const defaultTargetMax = input.defaultTargetMax === undefined ? base?.default_target_max ?? null : input.defaultTargetMax === null ? null : num(input.defaultTargetMax, "The upper end of the range");
    if (direction === "target_range") {
      if (defaultTarget !== null && defaultTargetMax === null) throw new HttpError(400, "range_needs_max", "A KPI that should stay inside a range needs the upper end as well.");
      if (defaultTarget !== null && defaultTargetMax !== null && defaultTargetMax <= defaultTarget) throw new HttpError(400, "invalid_range", "The upper end of the range must be above the lower end.");
    }
    return {
      name, description, unit, direction,
      category: oneOf(input.category ?? base?.category ?? "delivery", CATEGORIES, "A category"),
      valueType: oneOf(input.valueType ?? base?.value_type ?? "number", VALUE_TYPES, "A value type"),
      frequency: oneOf(input.frequency ?? base?.frequency ?? "monthly", FREQUENCIES, "A frequency"),
      aggregation: oneOf(input.aggregation ?? base?.aggregation ?? "sum", AGGREGATIONS, "An aggregation"),
      defaultTarget, defaultTargetMax: direction === "target_range" ? defaultTargetMax : null,
    };
  }

  create(auth: AuthContext, requestId: string, caps: Capabilities, input: KpiInput): KpiDetail {
    this.requireConfigure(caps);
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const c = this.clean(input);
    const key = slug(input.key ?? c.name);
    if (!key) throw new HttpError(400, "invalid_key", "A KPI key is made of letters, digits and dashes.");
    if (w.kpi.keyTaken(key)) throw new HttpError(409, "key_taken", `Another KPI already uses the key "${key}". Choose a different name.`);
    const id = newId();
    this.o.store.transaction(() => {
      w.kpi.insertKpi({ id, key, ...c, createdBy: ctx.membershipId, now: this.now() });
      this.o.audit.record(w.tdb, ctx, { action: "kpi.create", entityType: "kpi", entityId: id, summary: `Created the KPI "${c.name}" (${c.frequency}, ${c.direction.replace(/_/g, " ")})`, after: { key, category: c.category, frequency: c.frequency, direction: c.direction, aggregation: c.aggregation } });
    });
    return this.detail(auth, requestId, caps, id);
  }

  update(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: Partial<KpiInput>): KpiDetail {
    this.requireConfigure(caps);
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const k = w.kpi.kpi(id);
    if (!k) throw notFound();
    if (k.archived_at) throw new HttpError(409, "archived", "This KPI is archived.");
    const c = this.clean({ name: input.name ?? k.name, ...input }, k);
    const changed = (Object.entries({ name: [k.name, c.name], description: [k.description, c.description], category: [k.category, c.category], unit: [k.unit, c.unit], valueType: [k.value_type, c.valueType], direction: [k.direction, c.direction], frequency: [k.frequency, c.frequency], aggregation: [k.aggregation, c.aggregation], defaultTarget: [k.default_target, c.defaultTarget], defaultTargetMax: [k.default_target_max, c.defaultTargetMax] }) as [string, [unknown, unknown]][]).filter(([, [a, b]]) => a !== b).map(([f]) => f);
    if (changed.length === 0) return this.detail(auth, requestId, caps, id);
    this.o.store.transaction(() => {
      w.kpi.updateKpi({ id, ...c, now: this.now() });
      this.o.audit.record(w.tdb, ctx, { action: "kpi.update", entityType: "kpi", entityId: id, summary: `Changed the KPI "${c.name}" (${changed.join(", ")})`, before: { fields: changed }, after: { fields: changed } });
    });
    return this.detail(auth, requestId, caps, id);
  }

  archive(auth: AuthContext, requestId: string, caps: Capabilities, id: string): void {
    this.requireConfigure(caps);
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const k = w.kpi.kpi(id);
    if (!k) throw notFound();
    if (k.archived_at) throw new HttpError(409, "already_archived", "This KPI is already archived.");
    const open = w.kpi.assignments().filter((a) => a.kpi_id === id && (a.effective_to === null || a.effective_to >= w.today)).length;
    if (open > 0) throw new HttpError(409, "has_active_assignments", `${open} ${open === 1 ? "assignment is" : "assignments are"} still active. End ${open === 1 ? "it" : "them"} first.`, { assignments: open });
    this.o.store.transaction(() => {
      w.kpi.setArchived(id, this.now(), this.now());
      this.o.audit.record(w.tdb, ctx, { action: "kpi.archive", entityType: "kpi", entityId: id, summary: `Archived the KPI "${k.name}"` });
    });
  }

  // ---------- assignments ----------

  assign(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: AssignmentInput): KpiDetail {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const k = w.kpi.kpi(id);
    const scope = this.requireView(caps);
    if (!k || k.archived_at) throw notFound();
    const assignScope = caps.scope("kpi.assign");
    if (!caps.has("kpi.assign")) throw new HttpError(403, "permission_denied", "You cannot assign KPIs.");
    const given = [input.assigneeId, input.teamId, input.departmentId, input.designationId, input.roleFamilyId].filter(Boolean).length;
    if (given !== 1) throw new HttpError(400, "validation_failed", "Request did not pass validation", [{ path: "assigneeId", message: "Give one person, team, department, designation or role family" }]);
    let subject: { membershipId: string | null; teamId: string | null; departmentId: string | null; designationId: string | null; roleFamilyId: string | null } = { membershipId: null, teamId: null, departmentId: null, designationId: null, roleFamilyId: null };
    let label = "";
    if (input.assigneeId) {
      const p = w.people.person(input.assigneeId);
      if (!p) throw notFound();
      if (p.archived_at !== null || p.status === "left") throw new HttpError(409, "archived", `${p.display_name} no longer belongs to the organization.`);
      if (!(assignScope.all || assignScope.members.has(p.id))) throw new HttpError(403, "outside_scope", "You can assign KPIs to people in your scope.");
      subject.membershipId = p.id;
      label = p.display_name;
    } else if (input.teamId) {
      const t = w.teams.get(input.teamId);
      if (!t) throw notFound();
      if (t.archived_at) throw new HttpError(409, "archived", "That team is archived.");
      if (!(assignScope.all || assignScope.teams.has(t.id))) throw new HttpError(403, "outside_scope", "You can assign KPIs to teams in your scope.");
      subject.teamId = t.id;
      label = t.name;
    } else if (input.departmentId) {
      const d = w.depts.get(input.departmentId);
      if (!d) throw notFound();
      if (d.archived_at) throw new HttpError(409, "archived", "That department is archived.");
      if (!(assignScope.all || assignScope.departments.has(d.id))) throw new HttpError(403, "outside_scope", "You can assign KPIs to departments in your scope.");
      subject.departmentId = d.id;
      label = d.name;
    } else {
      // a designation or a role family reaches people across the organization: it needs the permission over everyone
      if (!assignScope.all) throw new HttpError(403, "outside_scope", "Assigning a KPI to a whole designation or role family needs permission over everyone.");
      if (input.designationId) {
        const d = w.designations.get(input.designationId);
        if (!d) throw notFound();
        if (d.archived_at) throw new HttpError(409, "archived", "That designation is archived.");
        subject.designationId = d.id;
        label = d.name;
      } else {
        const f = w.families.get(input.roleFamilyId!);
        if (!f) throw notFound();
        if (f.archived_at) throw new HttpError(409, "archived", "That role family is archived.");
        subject.roleFamilyId = f.id;
        label = f.name;
      }
    }
    const targetValue = input.targetValue ?? k.default_target;
    if (targetValue === null || targetValue === undefined) throw new HttpError(400, "target_required", "Give the target for this assignment (the KPI has no default target).");
    num(targetValue, "The target");
    let targetMax: number | null = null;
    if (k.direction === "target_range") {
      targetMax = input.targetMax ?? k.default_target_max;
      if (targetMax === null || targetMax === undefined) throw new HttpError(400, "range_needs_max", "A range needs both ends.");
      if (num(targetMax, "The upper end") <= targetValue) throw new HttpError(400, "invalid_range", "The upper end of the range must be above the lower end.");
    } else if (k.direction === "higher_is_better" || k.direction === "lower_is_better") {
      if (targetValue <= 0 && k.direction === "higher_is_better") throw new HttpError(400, "invalid_target", "A target to reach must be more than 0.");
    }
    const weight = num(input.weight ?? 1, "The weight");
    if (weight <= 0 || weight > 100) throw new HttpError(400, "invalid_number", "The weight is more than 0 and at most 100.");
    const from = input.effectiveFrom ?? w.today;
    if (!isDay(from)) throw new HttpError(400, "invalid_date", "Dates must be real dates written YYYY-MM-DD.");
    const to = input.effectiveTo ?? null;
    if (to !== null && (!isDay(to) || to < from)) throw new HttpError(400, "invalid_date", "The end date must be a real date, not before the start.");
    // the same subject cannot hold the same KPI twice at the same time
    const sameSubject = (a: KpiAssignmentRow): boolean => a.kpi_id === id && a.membership_id === subject.membershipId && a.team_id === subject.teamId && a.department_id === subject.departmentId && a.designation_id === subject.designationId && a.role_family_id === subject.roleFamilyId;
    const overlap = w.kpi.assignments().some((a) => sameSubject(a) && a.effective_from <= (to ?? "9999-12-31") && (a.effective_to ?? "9999-12-31") >= from);
    if (overlap) throw new HttpError(409, "already_assigned", `${label} already has this KPI for those dates. End the earlier assignment, or change its target.`);
    const aid = newId();
    this.o.store.transaction(() => {
      w.kpi.insertAssignment({ id: aid, kpiId: id, ...subject, targetValue, targetMax, weight, effectiveFrom: from, effectiveTo: to, by: ctx.membershipId, now: this.now() });
      this.o.audit.record(w.tdb, ctx, { action: "kpi.assign", entityType: "kpi", entityId: id, summary: `Assigned the KPI "${k.name}" to ${label} (target ${targetValue}${targetMax !== null ? ` to ${targetMax}` : ""})`, after: { subject: label, targetValue, targetMax, weight, effectiveFrom: from, effectiveTo: to } });
    });
    return this.toDetail(this.world(ctx), caps, scope, ctx.membershipId, k);
  }

  /** Changes the target, weight or end date of an assignment, or ends it (`effectiveTo`). Nothing is deleted. */
  updateAssignment(auth: AuthContext, requestId: string, caps: Capabilities, id: string, aid: string, input: { targetValue?: number; targetMax?: number | null; weight?: number; effectiveTo?: string | null }): KpiDetail {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const scope = this.requireView(caps);
    const k = w.kpi.kpi(id);
    const a = w.kpi.assignment(aid);
    if (!k || !a || a.kpi_id !== id || !this.seesAssignment(w, scope, ctx.membershipId, a)) throw notFound();
    if (!this.mayChange(w, caps, a)) throw new HttpError(403, "permission_denied", "You cannot change this assignment.");
    const next = {
      targetValue: input.targetValue === undefined ? a.target_value : num(input.targetValue, "The target"),
      targetMax: input.targetMax === undefined ? a.target_max : input.targetMax === null ? null : num(input.targetMax, "The upper end"),
      weight: input.weight === undefined ? a.weight : num(input.weight, "The weight"),
      effectiveTo: input.effectiveTo === undefined ? a.effective_to : input.effectiveTo,
    };
    if (next.weight <= 0 || next.weight > 100) throw new HttpError(400, "invalid_number", "The weight is more than 0 and at most 100.");
    if (k.direction === "target_range" && (next.targetMax === null || next.targetMax <= next.targetValue)) throw new HttpError(400, "invalid_range", "The upper end of the range must be above the lower end.");
    if (next.effectiveTo !== null && (!isDay(next.effectiveTo) || next.effectiveTo < a.effective_from)) throw new HttpError(400, "invalid_date", "The end date must be a real date, not before the start.");
    if (a.effective_to !== null && a.effective_to < w.today) throw new HttpError(409, "already_ended", "That assignment has already ended.");
    const label = this.subjectOf(w, a).name;
    this.o.store.transaction(() => {
      w.kpi.updateAssignment({ id: aid, ...next });
      this.o.audit.record(w.tdb, ctx, { action: input.effectiveTo !== undefined && Object.keys(input).length === 1 ? "kpi.assignment_end" : "kpi.assignment_update", entityType: "kpi", entityId: id, summary: `Changed the assignment of "${k.name}" for ${label}`, before: { targetValue: a.target_value, targetMax: a.target_max, weight: a.weight, effectiveTo: a.effective_to }, after: next });
    });
    return this.toDetail(this.world(ctx), caps, scope, ctx.membershipId, k);
  }

  endAssignment(auth: AuthContext, requestId: string, caps: Capabilities, id: string, aid: string): KpiDetail {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    return this.updateAssignment(auth, requestId, caps, id, aid, { effectiveTo: w.today });
  }

  private mayChange(w: ReturnType<KpiService["world"]>, caps: Capabilities, a: KpiAssignmentRow): boolean {
    const s = caps.scope("kpi.assign");
    if (!caps.has("kpi.assign")) return false;
    if (s.all) return true;
    if (a.membership_id) return s.members.has(a.membership_id);
    if (a.team_id) return s.teams.has(a.team_id);
    if (a.department_id) return s.departments.has(a.department_id);
    return false;
  }

  // ---------- thresholds ----------

  thresholds(auth: AuthContext, requestId: string, caps: Capabilities, id: string): ThresholdView[] {
    this.requireView(caps);
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const k = w.kpi.kpi(id);
    if (!k || (k.archived_at && !caps.scope("kpi.configure").all)) throw notFound();
    return w.kpi.thresholds(id).map((t): ThresholdView => ({ id: t.id, level: t.level, comparator: t.comparator, basis: t.basis, value: t.value, notify: t.notify === 1 }));
  }

  /** Replaces the KPI's thresholds with this list (the earlier list is kept in the audit entry). At most one per level. */
  setThresholds(auth: AuthContext, requestId: string, caps: Capabilities, id: string, list: { level: string; comparator: string; basis?: string; value: number; notify?: boolean }[]): KpiDetail {
    this.requireConfigure(caps);
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const k = w.kpi.kpi(id);
    if (!k) throw notFound();
    if (k.archived_at) throw new HttpError(409, "archived", "This KPI is archived.");
    const seen = new Set<string>();
    const clean = list.map((t) => {
      const level = oneOf(t.level, LEVELS, "A level");
      if (seen.has(level)) throw new HttpError(400, "duplicate_level", `There is more than one ${level} threshold. Keep one for each level.`);
      seen.add(level);
      const basis = oneOf(t.basis ?? "absolute", BASES, "A basis");
      const value = num(t.value, "A threshold value");
      if (basis === "percent_of_target" && value < 0) throw new HttpError(400, "invalid_number", "A percentage of the target cannot be negative.");
      return { level, comparator: oneOf(t.comparator, COMPARATORS, "A comparator"), basis, value, notify: t.notify === false ? 0 : 1 };
    });
    const before = w.kpi.thresholds(id).map((t) => ({ level: t.level, comparator: t.comparator, basis: t.basis, value: t.value }));
    const now = this.now();
    this.o.store.transaction(() => {
      w.kpi.deleteThresholds(id);
      for (const t of clean) w.kpi.insertThreshold({ id: newId(), kpiId: id, ...t, now });
      this.o.audit.record(w.tdb, ctx, { action: "kpi.thresholds", entityType: "kpi", entityId: id, summary: `Set ${clean.length} ${clean.length === 1 ? "threshold" : "thresholds"} on the KPI "${k.name}"`, before: { thresholds: before }, after: { thresholds: clean.map((t) => ({ level: t.level, comparator: t.comparator, basis: t.basis, value: t.value })) } });
    });
    return this.detail(auth, requestId, caps, id);
  }
}

export type { KpiAssignmentRow, KpiRow, ThresholdRow };
