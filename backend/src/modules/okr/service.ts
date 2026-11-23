import type { TenantCtx } from "../../db/tenant.js";
import { HttpError, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import type { AuditService } from "../audit/service.js";
import type { AuthStore } from "../auth/repositories/store.js";
import type { AuthContext, AuthService } from "../auth/service.js";
import type { ScopeSet } from "../permissions/resolver.js";
import type { Capabilities } from "../permissions/service.js";
import { addDays, daysBetween, todayIn } from "../tasks/dates.js";
import { keyResultAttainment, objectiveAttainment, toPercent, type DataState, type Direction, type ProgressMethod } from "./attainment.js";
import type { KeyResultRow, ObjectiveRow } from "./repositories/okr.js";

export const LEVELS = ["company", "department", "team", "individual"] as const;
export const LIFECYCLES = ["draft", "active", "completed", "cancelled"] as const;
export const OBJECTIVE_TYPES = ["strategic", "operational", "development"] as const;
export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
export const MEASUREMENTS = ["percentage", "number", "currency", "count", "boolean", "custom"] as const;
const MAX_KEY_RESULTS = 12;

/** Lifecycle moves: where an objective may go from where it is. */
export const LIFECYCLE_MOVES: Readonly<Record<string, readonly string[]>> = {
  draft: ["active", "cancelled"],
  active: ["draft", "completed", "cancelled"],
  completed: ["active"],
  cancelled: ["draft"],
};

export interface Ref { id: string; name: string }
export interface KeyResultView {
  id: string;
  title: string;
  description: string;
  measurementType: string;
  unit: string | null;
  direction: string;
  method: string;
  startValue: number;
  targetValue: number;
  currentValue: number | null;
  currentAsOf: string | null;
  weight: number;
  owner: Ref | null;
  dueDate: string | null;
  /** Whole-number percent, or null when nothing has been recorded (which is not zero). */
  attainmentPct: number | null;
  regressed: boolean;
  capped: boolean;
  degenerate: boolean;
  isDemo: boolean;
}
export interface ObjectiveSummary {
  id: string;
  title: string;
  level: string;
  objectiveType: string;
  priority: string;
  lifecycle: string;
  visibility: string;
  published: boolean;
  startDate: string;
  endDate: string;
  weight: number;
  owner: Ref | null;
  department: Ref | null;
  team: Ref | null;
  keyResultCount: number;
  attainmentPct: number | null;
  dataState: DataState;
  /** Share of the key-result weight that has a recorded value, 0 to 100. */
  coveragePct: number;
  /** How much of the time window has passed, 0 to 100 (a pace marker; health arrives with stage 3.2). */
  elapsedPct: number;
  archived: boolean;
  isDemo: boolean;
}
export interface ObjectiveDetail extends ObjectiveSummary {
  description: string;
  createdBy: Ref;
  keyResults: KeyResultView[];
  can: { edit: boolean; updateProgress: boolean; publish: boolean; archive: boolean; addKeyResults: boolean };
  nextLifecycles: string[];
  tasks: { total: number; open: number };
}
export interface HistoryEntry { id: string; keyResultId: string | null; keyResultTitle: string | null; recordedAt: string; value: number | null; attainmentPct: number | null; source: string; note: string | null; by: Ref | null }

export interface KeyResultInput {
  title: string;
  description?: string;
  measurementType?: string;
  unit?: string | null;
  direction?: string;
  method?: string;
  startValue?: number;
  targetValue: number;
  weight?: number;
  ownerId?: string | null;
  dueDate?: string | null;
}
export interface CreateObjectiveInput {
  level: string;
  title: string;
  description?: string;
  objectiveType?: string;
  startDate: string;
  endDate: string;
  priority?: string;
  weight?: number;
  departmentId?: string | null;
  teamId?: string | null;
  ownerId?: string | null;
  lifecycle?: string;
  keyResults?: KeyResultInput[];
}

const isDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
function cleanTitle(raw: string, what: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  // eslint-disable-next-line no-control-regex
  if (t.length < 1 || t.length > 160 || /[\u0000-\u001f\u007f]/.test(t)) throw new HttpError(400, "invalid_title", `${what} is 1 to 160 characters.`);
  return t;
}
const cleanText = (raw: string | undefined | null, max: number, what: string): string => {
  const t = (raw ?? "").trim();
  if (t.length > max) throw new HttpError(400, "invalid_text", `${what} is at most ${max} characters.`);
  return t;
};
const oneOf = <T extends string>(v: string, list: readonly T[], what: string): T => {
  if (!(list as readonly string[]).includes(v)) throw new HttpError(400, "invalid_value", `${what} is one of: ${list.join(", ")}.`);
  return v as T;
};
const num = (v: number, what: string): number => {
  if (!Number.isFinite(v) || Math.abs(v) > 1e12) throw new HttpError(400, "invalid_number", `${what} must be a number.`);
  return v;
};

/**
 * Objectives and key results (stage 3.1). An objective belongs to the company, a department, a team or a person. Its
 * progress is NEVER an average of finished tasks: it comes from the actual values recorded on its key results (see
 * `attainment.ts`). Recording a value appends a history row; nothing is overwritten and nothing is deleted (archive only).
 * Every change is one transaction with its audit row. Visibility: you see objectives in your `okr.view` scope, ones you own
 * or created, and ones the organization has published.
 */
export class OkrService {
  constructor(private readonly o: { store: AuthStore; auth: AuthService; audit: AuditService }) {}

  private ctx(auth: AuthContext, requestId: string): TenantCtx {
    return this.o.auth.tenantCtx(auth, requestId);
  }
  private now = (): string => this.o.auth.iso();

  private world(ctx: TenantCtx) {
    const tdb = this.o.store.tenant(ctx);
    const okr = this.o.store.okr(tdb);
    const org = this.o.store.orgs.findById(ctx.organizationId);
    const today = todayIn(org?.timezone ?? "UTC", new Date(this.now()));
    const people = this.o.store.people(tdb);
    const structure = this.o.store.structure(tdb);
    const names = new Map(people.people().map((p) => [p.id, p.display_name]));
    const depts = new Map(structure.departments().map((d) => [d.id, d]));
    const teams = new Map(structure.teams().map((t) => [t.id, t]));
    return { tdb, okr, today, people, structure, names, depts, teams, krsByObjective: this.groupKrs(okr.keyResults()) };
  }
  private groupKrs(rows: KeyResultRow[]): Map<string, KeyResultRow[]> {
    const m = new Map<string, KeyResultRow[]>();
    for (const k of rows) m.set(k.objective_id, [...(m.get(k.objective_id) ?? []), k]);
    return m;
  }
  private who(w: ReturnType<OkrService["world"]>, id: string | null): Ref | null {
    return id ? { id, name: w.names.get(id) ?? "Former member" } : null;
  }

  // ---------- scope ----------

  private inScope(o: ObjectiveRow, scope: ScopeSet): boolean {
    if (scope.all) return true;
    if (o.owner_membership_id && scope.members.has(o.owner_membership_id)) return true;
    if (o.team_id && scope.teams.has(o.team_id)) return true;
    if (o.department_id && scope.departments.has(o.department_id)) return true;
    return false;
  }
  private canSee(w: ReturnType<OkrService["world"]>, caps: Capabilities, o: ObjectiveRow, me: string): boolean {
    if (this.inScope(o, caps.scope("okr.view"))) return true;
    if (o.owner_membership_id === me || o.created_by_membership_id === me) return true;
    if ((w.krsByObjective.get(o.id) ?? []).some((k) => k.owner_membership_id === me)) return true;
    return o.visibility === "organization" && o.lifecycle !== "draft";
  }
  private canEdit(caps: Capabilities, o: ObjectiveRow, me: string): boolean {
    return this.inScope(o, caps.scope("okr.edit")) || (o.created_by_membership_id === me && o.level === "individual" && o.owner_membership_id === me);
  }
  private canRecord(caps: Capabilities, o: ObjectiveRow, k: KeyResultRow, me: string): boolean {
    return this.inScope(o, caps.scope("okr.update_progress")) || k.owner_membership_id === me || o.owner_membership_id === me;
  }

  // ---------- views ----------

  private krView(w: ReturnType<OkrService["world"]>, k: KeyResultRow): KeyResultView {
    const a = keyResultAttainment({ direction: k.direction as Direction, method: k.progress_method as ProgressMethod, start: k.start_value, target: k.target_value, current: k.current_value, weight: k.weight });
    return {
      id: k.id, title: k.title, description: k.description, measurementType: k.measurement_type, unit: k.unit, direction: k.direction, method: k.progress_method,
      startValue: k.start_value, targetValue: k.target_value, currentValue: k.current_value, currentAsOf: k.current_as_of, weight: k.weight, owner: this.who(w, k.owner_membership_id), dueDate: k.due_date,
      attainmentPct: toPercent(a.value), regressed: a.regressed, capped: a.capped, degenerate: a.degenerate, isDemo: k.is_demo === 1,
    };
  }
  private summary(w: ReturnType<OkrService["world"]>, o: ObjectiveRow): ObjectiveSummary {
    const krs = w.krsByObjective.get(o.id) ?? [];
    const att = objectiveAttainment(krs.map((k) => ({ attainment: keyResultAttainment({ direction: k.direction as Direction, method: k.progress_method as ProgressMethod, start: k.start_value, target: k.target_value, current: k.current_value, weight: k.weight }).value, weight: k.weight })));
    const span = Math.max(1, daysBetween(o.start_date, o.end_date));
    const elapsed = Math.min(1, Math.max(0, daysBetween(o.start_date, w.today) / span));
    return {
      id: o.id, title: o.title, level: o.level, objectiveType: o.objective_type, priority: o.priority, lifecycle: o.lifecycle, visibility: o.visibility, published: o.visibility === "organization",
      startDate: o.start_date, endDate: o.end_date, weight: o.weight, owner: this.who(w, o.owner_membership_id),
      department: o.department_id ? { id: o.department_id, name: w.depts.get(o.department_id)?.name ?? "Department" } : null,
      team: o.team_id ? { id: o.team_id, name: w.teams.get(o.team_id)?.name ?? "Team" } : null,
      keyResultCount: krs.length, attainmentPct: toPercent(att.value), dataState: att.dataState, coveragePct: Math.round(att.coverage * 100), elapsedPct: Math.round(elapsed * 100),
      archived: o.archived_at !== null, isDemo: o.is_demo === 1,
    };
  }

  list(auth: AuthContext, requestId: string, caps: Capabilities, q: { level?: string; lifecycle?: string; ownerId?: string; teamId?: string; departmentId?: string; mine?: boolean; search?: string; includeArchived?: boolean }): ObjectiveSummary[] {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const me = ctx.membershipId;
    const needle = q.search?.trim().toLowerCase();
    const includeArchived = q.includeArchived === true && caps.scope("okr.archive").all;
    return w.okr
      .objectives(includeArchived)
      .filter((o) => this.canSee(w, caps, o, me))
      .filter((o) => (!q.level || o.level === q.level) && (!q.lifecycle || o.lifecycle === q.lifecycle) && (!q.ownerId || o.owner_membership_id === q.ownerId) && (!q.teamId || o.team_id === q.teamId) && (!q.departmentId || o.department_id === q.departmentId) && (!q.mine || o.owner_membership_id === me) && (!needle || o.title.toLowerCase().includes(needle)))
      .map((o) => this.summary(w, o));
  }

  detail(auth: AuthContext, requestId: string, caps: Capabilities, id: string): ObjectiveDetail {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const o = w.okr.objective(id);
    if (!o || (o.archived_at && !caps.scope("okr.archive").all) || !this.canSee(w, caps, o, ctx.membershipId)) throw notFound();
    return this.toDetail(w, caps, o, ctx.membershipId);
  }

  private toDetail(w: ReturnType<OkrService["world"]>, caps: Capabilities, o: ObjectiveRow, me: string): ObjectiveDetail {
    const tasks = w.okr.taskCounts(o.id);
    const edit = this.canEdit(caps, o, me);
    const krs = w.krsByObjective.get(o.id) ?? [];
    return {
      ...this.summary(w, o),
      description: o.description,
      createdBy: this.who(w, o.created_by_membership_id)!,
      keyResults: krs.map((k) => this.krView(w, k)),
      can: { edit, updateProgress: krs.some((k) => this.canRecord(caps, o, k, me)) || this.inScope(o, caps.scope("okr.update_progress")), publish: caps.scope("okr.publish").all, archive: this.inScope(o, caps.scope("okr.archive")), addKeyResults: edit },
      nextLifecycles: [...(LIFECYCLE_MOVES[o.lifecycle] ?? [])],
      tasks,
    };
  }

  history(auth: AuthContext, requestId: string, caps: Capabilities, id: string): HistoryEntry[] {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const o = w.okr.objective(id);
    if (!o || !this.canSee(w, caps, o, ctx.membershipId)) throw notFound();
    const titles = new Map(w.okr.keyResults(true).filter((k) => k.objective_id === id).map((k) => [k.id, k.title]));
    return w.okr.history(id).map((h) => ({ id: h.id, keyResultId: h.key_result_id, keyResultTitle: h.key_result_id ? titles.get(h.key_result_id) ?? null : null, recordedAt: h.recorded_at, value: h.value, attainmentPct: toPercent(h.attainment), source: h.source, note: h.note, by: this.who(w, h.recorded_by_membership_id) }));
  }

  // ---------- creating and changing ----------

  create(auth: AuthContext, requestId: string, caps: Capabilities, input: CreateObjectiveInput): ObjectiveDetail {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const me = ctx.membershipId;
    const level = oneOf(input.level, LEVELS, "A level");
    const title = cleanTitle(input.title, "An objective title");
    const description = cleanText(input.description, 4000, "The description");
    if (!isDay(input.startDate) || !isDay(input.endDate)) throw new HttpError(400, "invalid_date", "Dates must be real dates written YYYY-MM-DD.");
    if (input.endDate < input.startDate) throw new HttpError(400, "invalid_date", "The end date cannot be before the start date.");
    const priority = oneOf(input.priority ?? "medium", PRIORITIES, "Priority");
    const objectiveType = oneOf(input.objectiveType ?? "operational", OBJECTIVE_TYPES, "A type");
    const lifecycle = oneOf(input.lifecycle ?? "active", ["draft", "active"] as const, "A starting state");
    const weight = num(input.weight ?? 1, "The weight");
    if (weight <= 0 || weight > 100) throw new HttpError(400, "invalid_number", "The weight is more than 0 and at most 100.");
    const scope = caps.scope("okr.create");

    let departmentId: string | null = null;
    let teamId: string | null = null;
    let ownerId: string | null = input.ownerId ?? null;
    if (level === "company") {
      if (!scope.all) throw new HttpError(403, "outside_scope", "Company objectives are created by people who may create objectives for the whole organization.");
    } else if (level === "department") {
      const d = input.departmentId ? w.structure.department(input.departmentId) : undefined;
      if (!d) throw input.departmentId ? notFound() : new HttpError(400, "validation_failed", "Request did not pass validation", [{ path: "departmentId", message: "Choose the department" }]);
      if (d.archived_at) throw new HttpError(409, "archived", "That department is archived.");
      if (!(scope.all || scope.departments.has(d.id))) throw new HttpError(403, "outside_scope", "You can create objectives for departments in your scope.");
      departmentId = d.id;
    } else if (level === "team") {
      const t = input.teamId ? w.structure.team(input.teamId) : undefined;
      if (!t) throw input.teamId ? notFound() : new HttpError(400, "validation_failed", "Request did not pass validation", [{ path: "teamId", message: "Choose the team" }]);
      if (t.archived_at) throw new HttpError(409, "archived", "That team is archived.");
      if (!(scope.all || scope.teams.has(t.id))) throw new HttpError(403, "outside_scope", "You can create objectives for teams in your scope.");
      teamId = t.id;
      departmentId = t.department_id;
    } else {
      ownerId = ownerId ?? me;
      if (!(scope.all || scope.members.has(ownerId))) throw new HttpError(403, "outside_scope", "You can create personal objectives for yourself and for people in your scope.");
    }
    if (ownerId) {
      const p = w.people.person(ownerId);
      if (!p) throw notFound();
      if (p.archived_at !== null || p.status === "left") throw new HttpError(409, "archived", `${p.display_name} no longer belongs to the organization.`);
    }
    const krInputs = input.keyResults ?? [];
    if (krInputs.length > MAX_KEY_RESULTS) throw new HttpError(400, "too_many_key_results", `An objective has at most ${MAX_KEY_RESULTS} key results.`);
    const prepared = krInputs.map((k) => this.prepareKeyResult(w, k));

    const id = newId();
    const now = this.now();
    this.o.store.transaction(() => {
      w.okr.insertObjective({ id, level, departmentId, teamId, ownerId, title, description, objectiveType, startDate: input.startDate, endDate: input.endDate, priority, lifecycle, weight, createdBy: me, now });
      for (const k of prepared) w.okr.insertKeyResult({ id: newId(), objectiveId: id, ...k, now });
      this.o.audit.record(w.tdb, ctx, { action: "objective.create", entityType: "objective", entityId: id, summary: `Created the ${level} objective "${title}" with ${prepared.length} key ${prepared.length === 1 ? "result" : "results"}`, after: { level, title, lifecycle, startDate: input.startDate, endDate: input.endDate } });
    });
    const fresh = this.world(ctx);
    return this.toDetail(fresh, caps, fresh.okr.objective(id)!, me);
  }

  /** Checks a key result's numbers and returns the columns to insert. */
  private prepareKeyResult(w: ReturnType<OkrService["world"]>, k: KeyResultInput) {
    const measurementType = oneOf(k.measurementType ?? "number", MEASUREMENTS, "A measurement type");
    const direction = oneOf(k.direction ?? "increase", ["increase", "decrease"] as const, "A direction");
    let method = oneOf(k.method ?? (measurementType === "boolean" ? "binary" : "linear"), ["linear", "binary", "manual"] as const, "A progress method");
    if (measurementType === "boolean") method = "binary";
    let start = num(k.startValue ?? 0, "The start value");
    let target = num(k.targetValue, "The target");
    if (method === "binary") { start = 0; target = 1; }
    else if (method === "manual") { start = 0; target = 100; }
    else if (start === target) throw new HttpError(400, "target_equals_start", "The target must be different from the start value, otherwise progress cannot be measured.");
    else if (direction === "increase" && target < start) throw new HttpError(400, "wrong_direction", "This key result is meant to go up, but the target is below the start value. Choose \"decrease\" or change the numbers.");
    else if (direction === "decrease" && target > start) throw new HttpError(400, "wrong_direction", "This key result is meant to go down, but the target is above the start value. Choose \"increase\" or change the numbers.");
    const weight = num(k.weight ?? 1, "The weight");
    if (weight <= 0 || weight > 100) throw new HttpError(400, "invalid_number", "The weight is more than 0 and at most 100.");
    const dueDate = k.dueDate ? (isDay(k.dueDate) ? k.dueDate : (() => { throw new HttpError(400, "invalid_date", "The due date must be a real date written YYYY-MM-DD."); })()) : null;
    const ownerId = k.ownerId ?? null;
    if (ownerId && !w.people.person(ownerId)) throw notFound();
    return { title: cleanTitle(k.title, "A key result title"), description: cleanText(k.description, 1000, "The description"), measurementType, unit: cleanText(k.unit ?? "", 20, "The unit") || null, direction, method, start, target, weight, ownerId, dueDate };
  }

  update(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: { title?: string; description?: string; objectiveType?: string; startDate?: string; endDate?: string; priority?: string; weight?: number; ownerId?: string | null; lifecycle?: string }): ObjectiveDetail {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const me = ctx.membershipId;
    const o = w.okr.objective(id);
    if (!o || o.archived_at || !this.canSee(w, caps, o, me)) throw notFound();
    if (!this.canEdit(caps, o, me)) throw new HttpError(403, "permission_denied", "You cannot change this objective.");
    const next = {
      title: input.title !== undefined ? cleanTitle(input.title, "An objective title") : o.title,
      description: input.description !== undefined ? cleanText(input.description, 4000, "The description") : o.description,
      objectiveType: input.objectiveType !== undefined ? oneOf(input.objectiveType, OBJECTIVE_TYPES, "A type") : o.objective_type,
      startDate: input.startDate ?? o.start_date,
      endDate: input.endDate ?? o.end_date,
      priority: input.priority !== undefined ? oneOf(input.priority, PRIORITIES, "Priority") : o.priority,
      weight: input.weight !== undefined ? num(input.weight, "The weight") : o.weight,
      ownerId: input.ownerId !== undefined ? input.ownerId : o.owner_membership_id,
    };
    if (!isDay(next.startDate) || !isDay(next.endDate) || next.endDate < next.startDate) throw new HttpError(400, "invalid_date", "Dates must be real, and the end cannot be before the start.");
    if (next.weight <= 0 || next.weight > 100) throw new HttpError(400, "invalid_number", "The weight is more than 0 and at most 100.");
    if (next.ownerId && next.ownerId !== o.owner_membership_id && !w.people.person(next.ownerId)) throw notFound();
    if (o.level === "individual" && !next.ownerId) throw new HttpError(400, "owner_required", "A personal objective needs an owner.");
    const lifecycle = input.lifecycle;
    if (lifecycle !== undefined && lifecycle !== o.lifecycle) {
      oneOf(lifecycle, LIFECYCLES, "A state");
      if (!(LIFECYCLE_MOVES[o.lifecycle] ?? []).includes(lifecycle)) throw new HttpError(409, "invalid_transition", `An objective that is ${o.lifecycle} cannot become ${lifecycle}.`, { allowed: LIFECYCLE_MOVES[o.lifecycle] });
      if (lifecycle === "draft" && o.visibility === "organization") throw new HttpError(409, "published", "A published objective cannot go back to draft. Unpublish it first.");
    }
    const changed = [
      ...(Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== ({ title: o.title, description: o.description, objectiveType: o.objective_type, startDate: o.start_date, endDate: o.end_date, priority: o.priority, weight: o.weight, ownerId: o.owner_membership_id } as typeof next)[k]),
      ...(lifecycle !== undefined && lifecycle !== o.lifecycle ? (["lifecycle"] as const) : []),
    ];
    if (changed.length === 0) return this.toDetail(w, caps, o, me);
    const now = this.now();
    this.o.store.transaction(() => {
      w.okr.updateObjective({ id, ...next, now });
      if (lifecycle !== undefined && lifecycle !== o.lifecycle) w.okr.setLifecycle(id, lifecycle, now);
      this.o.audit.record(w.tdb, ctx, {
        action: lifecycle !== undefined && lifecycle !== o.lifecycle && changed.length === 1 ? "objective.lifecycle" : "objective.update",
        entityType: "objective",
        entityId: id,
        summary: lifecycle !== undefined && lifecycle !== o.lifecycle && changed.length === 1 ? `Moved the objective "${next.title}" from ${o.lifecycle} to ${lifecycle}` : `Changed the objective "${next.title}" (${changed.join(", ")})`,
        before: { fields: changed, lifecycle: o.lifecycle },
        after: { fields: changed, lifecycle: lifecycle ?? o.lifecycle },
      });
    });
    const fresh = this.world(ctx);
    return this.toDetail(fresh, caps, fresh.okr.objective(id)!, me);
  }

  archive(auth: AuthContext, requestId: string, caps: Capabilities, id: string): void {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const o = w.okr.objective(id);
    if (!o || !this.canSee(w, caps, o, ctx.membershipId)) throw notFound();
    if (!this.inScope(o, caps.scope("okr.archive"))) throw new HttpError(403, "permission_denied", "You cannot archive this objective.");
    if (o.archived_at) throw new HttpError(409, "already_archived", "This objective is already archived.");
    const linked = w.okr.openTaskCount(id);
    if (linked > 0) throw new HttpError(409, "has_open_tasks", `${linked} open ${linked === 1 ? "task is" : "tasks are"} still linked to this objective. Finish or unlink ${linked === 1 ? "it" : "them"} first.`, { openTasks: linked });
    this.o.store.transaction(() => {
      w.okr.setArchived(id, this.now(), this.now());
      this.o.audit.record(w.tdb, ctx, { action: "objective.archive", entityType: "objective", entityId: id, summary: `Archived the objective "${o.title}"` });
    });
  }

  /** Publishes an objective for everyone in the organization to see (read only), or takes it back. */
  setPublished(auth: AuthContext, requestId: string, caps: Capabilities, id: string, published: boolean): ObjectiveDetail {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const me = ctx.membershipId;
    const o = w.okr.objective(id);
    if (!o || o.archived_at || !this.canSee(w, caps, o, me)) throw notFound();
    if (!caps.scope("okr.publish").all) throw new HttpError(403, "permission_denied", "You cannot publish objectives.");
    if (published && o.lifecycle === "draft") throw new HttpError(409, "draft_not_publishable", "Activate the objective before publishing it.");
    if ((o.visibility === "organization") === published) return this.toDetail(w, caps, o, me);
    this.o.store.transaction(() => {
      w.okr.setVisibility(id, published ? "organization" : "scope", published ? this.now() : null, this.now());
      this.o.audit.record(w.tdb, ctx, { action: published ? "objective.publish" : "objective.unpublish", entityType: "objective", entityId: id, summary: `${published ? "Published" : "Unpublished"} the objective "${o.title}"` });
    });
    const fresh = this.world(ctx);
    return this.toDetail(fresh, caps, fresh.okr.objective(id)!, me);
  }

  // ---------- key results ----------

  addKeyResult(auth: AuthContext, requestId: string, caps: Capabilities, objectiveId: string, input: KeyResultInput): ObjectiveDetail {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const me = ctx.membershipId;
    const o = w.okr.objective(objectiveId);
    if (!o || o.archived_at || !this.canSee(w, caps, o, me)) throw notFound();
    if (!this.canEdit(caps, o, me)) throw new HttpError(403, "permission_denied", "You cannot change this objective.");
    if (o.lifecycle === "completed" || o.lifecycle === "cancelled") throw new HttpError(409, "objective_closed", "This objective is finished or cancelled. Reopen it first.");
    if ((w.krsByObjective.get(o.id) ?? []).length >= MAX_KEY_RESULTS) throw new HttpError(400, "too_many_key_results", `An objective has at most ${MAX_KEY_RESULTS} key results.`);
    const k = this.prepareKeyResult(w, input);
    const id = newId();
    this.o.store.transaction(() => {
      w.okr.insertKeyResult({ id, objectiveId, ...k, now: this.now() });
      this.o.audit.record(w.tdb, ctx, { action: "key_result.create", entityType: "key_result", entityId: id, summary: `Added the key result "${k.title}" to the objective "${o.title}"`, after: { title: k.title, start: k.start, target: k.target, direction: k.direction } });
    });
    const fresh = this.world(ctx);
    return this.toDetail(fresh, caps, fresh.okr.objective(objectiveId)!, me);
  }

  updateKeyResult(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: { title?: string; description?: string; unit?: string | null; startValue?: number; targetValue?: number; weight?: number; ownerId?: string | null; dueDate?: string | null }): ObjectiveDetail {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const me = ctx.membershipId;
    const k = w.okr.keyResult(id);
    const o = k ? w.okr.objective(k.objective_id) : undefined;
    if (!k || !o || k.archived_at || o.archived_at || !this.canSee(w, caps, o, me)) throw notFound();
    if (!this.canEdit(caps, o, me)) throw new HttpError(403, "permission_denied", "You cannot change this objective.");
    if (o.lifecycle === "completed" || o.lifecycle === "cancelled") throw new HttpError(409, "objective_closed", "This objective is finished or cancelled. Reopen it first.");
    const merged = this.prepareKeyResult(w, {
      title: input.title ?? k.title, description: input.description ?? k.description, measurementType: k.measurement_type, unit: input.unit === undefined ? k.unit : input.unit, direction: k.direction, method: k.progress_method,
      startValue: input.startValue ?? k.start_value, targetValue: input.targetValue ?? k.target_value, weight: input.weight ?? k.weight, ownerId: input.ownerId === undefined ? k.owner_membership_id : input.ownerId, dueDate: input.dueDate === undefined ? k.due_date : input.dueDate,
    });
    const targetChanged = merged.target !== k.target_value || merged.start !== k.start_value;
    const changed = [merged.title !== k.title && "title", merged.description !== k.description && "description", merged.unit !== k.unit && "unit", targetChanged && "target", merged.weight !== k.weight && "weight", merged.ownerId !== k.owner_membership_id && "responsible person", merged.dueDate !== k.due_date && "dueDate"].filter(Boolean) as string[];
    if (changed.length === 0) return this.toDetail(w, caps, o, me);
    const now = this.now();
    this.o.store.transaction(() => {
      w.okr.updateKeyResult({ id, title: merged.title, description: merged.description, unit: merged.unit, start: merged.start, target: merged.target, weight: merged.weight, ownerId: merged.ownerId, dueDate: merged.dueDate, now });
      if (targetChanged) {
        const a = keyResultAttainment({ direction: k.direction as Direction, method: k.progress_method as ProgressMethod, start: merged.start, target: merged.target, current: k.current_value, weight: merged.weight });
        w.okr.insertHistory({ id: newId(), objectiveId: o.id, keyResultId: id, value: k.current_value, attainment: a.value, source: "target_change", note: `Target changed from ${k.start_value} → ${k.target_value} to ${merged.start} → ${merged.target}`, by: me, supersedesId: null, now });
      }
      this.o.audit.record(w.tdb, ctx, { action: "key_result.update", entityType: "key_result", entityId: id, summary: `Changed the key result "${merged.title}" (${changed.join(", ")})`, before: { fields: changed, start: k.start_value, target: k.target_value }, after: { fields: changed, start: merged.start, target: merged.target } });
    });
    const fresh = this.world(ctx);
    return this.toDetail(fresh, caps, fresh.okr.objective(o.id)!, me);
  }

  /** Records an ACTUAL value. Appends a history row (naming the one it replaces) and updates the current value; never overwrites. */
  recordProgress(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: { value: number; note?: string }, source: "manual" | "task_outcome" = "manual"): ObjectiveDetail {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const me = ctx.membershipId;
    const k = w.okr.keyResult(id);
    const o = k ? w.okr.objective(k.objective_id) : undefined;
    if (!k || !o || k.archived_at || o.archived_at || !this.canSee(w, caps, o, me)) throw notFound();
    if (!this.canRecord(caps, o, k, me)) throw new HttpError(403, "permission_denied", "You cannot record values for this key result.");
    if (o.lifecycle !== "active") throw new HttpError(409, "objective_not_active", o.lifecycle === "draft" ? "Activate the objective before recording values." : "This objective is finished or cancelled. Reopen it first.");
    const value = num(input.value, "The value");
    if (k.progress_method === "binary" && value !== 0 && value !== 1) throw new HttpError(400, "invalid_value", "A yes-or-no key result is recorded as 0 (no) or 1 (yes).");
    if (k.progress_method === "manual" && (value < 0 || value > 100)) throw new HttpError(400, "invalid_value", "A percentage is recorded from 0 to 100.");
    const note = cleanText(input.note, 1000, "The note") || null;
    const a = keyResultAttainment({ direction: k.direction as Direction, method: k.progress_method as ProgressMethod, start: k.start_value, target: k.target_value, current: value, weight: k.weight });
    const prev = w.okr.latestFor(id);
    const now = this.now();
    this.o.store.transaction(() => {
      w.okr.insertHistory({ id: newId(), objectiveId: o.id, keyResultId: id, value, attainment: a.value, source, note, by: me, supersedesId: prev?.id ?? null, now });
      w.okr.setCurrent(id, value, w.today, now);
      this.o.audit.record(w.tdb, ctx, { action: "key_result.progress", entityType: "key_result", entityId: id, summary: `Recorded ${value}${k.unit ? ` ${k.unit}` : ""} for the key result "${k.title}" (${a.value === null ? "no data" : `${toPercent(a.value)}%`})`, before: { value: k.current_value }, after: { value } });
    });
    const fresh = this.world(ctx);
    return this.toDetail(fresh, caps, fresh.okr.objective(o.id)!, me);
  }

  /** Used by the task outcome (stage 4.2): can this person record a value on this key result? */
  mayRecord(ctx: TenantCtx, caps: Capabilities, keyResultId: string): boolean {
    const w = this.world(ctx);
    const k = w.okr.keyResult(keyResultId);
    const o = k ? w.okr.objective(k.objective_id) : undefined;
    return !!k && !!o && !k.archived_at && !o.archived_at && o.lifecycle === "active" && this.canRecord(caps, o, k, ctx.membershipId);
  }

  /** Objectives and key results the person may link a task to: ones they can see that are still open. */
  linkable(auth: AuthContext, requestId: string, caps: Capabilities): { id: string; title: string; level: string; keyResults: { id: string; title: string }[] }[] {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    return w.okr
      .objectives()
      .filter((o) => (o.lifecycle === "active" || o.lifecycle === "draft") && this.canSee(w, caps, o, ctx.membershipId))
      .map((o) => ({ id: o.id, title: o.title, level: o.level, keyResults: (w.krsByObjective.get(o.id) ?? []).map((k) => ({ id: k.id, title: k.title })) }));
  }

  /** Whether the person may see this objective (the task service asks before it links a task). */
  mayLink(ctx: TenantCtx, caps: Capabilities, objectiveId: string, keyResultId: string | null): { ok: true; objectiveId: string } | { ok: false } {
    const w = this.world(ctx);
    const o = w.okr.objective(objectiveId);
    if (!o || o.archived_at || !this.canSee(w, caps, o, ctx.membershipId)) return { ok: false };
    if (keyResultId) {
      const k = w.okr.keyResult(keyResultId);
      if (!k || k.objective_id !== objectiveId || k.archived_at) return { ok: false };
    }
    return { ok: true, objectiveId };
  }

  /** Titles for a task's links (the caller has already been checked with `mayLink`). */
  linkTitles(ctx: TenantCtx, objectiveId: string, keyResultId: string | null): { objective: { id: string; title: string; level: string } | null; keyResult: { id: string; title: string } | null } {
    const okr = this.o.store.okr(this.o.store.tenant(ctx));
    const o = okr.objective(objectiveId);
    const k = keyResultId ? okr.keyResult(keyResultId) : undefined;
    return { objective: o ? { id: o.id, title: o.title, level: o.level } : null, keyResult: k ? { id: k.id, title: k.title } : null };
  }

  /** The key result's objective, or undefined. */
  objectiveOfKeyResult(ctx: TenantCtx, keyResultId: string): string | undefined {
    return this.o.store.okr(this.o.store.tenant(ctx)).keyResult(keyResultId)?.objective_id;
  }

  /** For the Overview and the demo: active company-level objectives with their attainment. */
  topObjectives(ctx: TenantCtx, caps: Capabilities, limit = 5): ObjectiveSummary[] {
    const w = this.world(ctx);
    return w.okr
      .objectives()
      .filter((o) => o.level === "company" && o.lifecycle === "active" && this.canSee(w, caps, o, ctx.membershipId))
      .slice(0, limit)
      .map((o) => this.summary(w, o));
  }
  windowDays = addDays;
}
