import type { TenantCtx, TenantDb } from "../../db/tenant.js";
import { HttpError, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import type { AuditService } from "../audit/service.js";
import type { EventWriter } from "../automation/events.js";
import type { AuthStore } from "../auth/repositories/store.js";
import type { AuthContext, AuthService } from "../auth/service.js";
import type { NotificationService } from "../notifications/service.js";
import type { OkrService } from "../okr/service.js";
import { scopeContainsMember, type ScopeSet } from "../permissions/resolver.js";
import type { Capabilities } from "../permissions/service.js";
import type { PersonRow } from "../people/repositories/people.js";
import { addDays, todayIn } from "./dates.js";
import { suggestOrder } from "./ordering.js";
import type { AssignmentRow, TaskRow, UpdateRow } from "./repositories/tasks.js";

export const STATUSES = ["not_started", "in_progress", "blocked", "under_review", "completed", "cancelled"] as const;
export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
export const ASSIGNMENT_ROLES = ["assignee", "reviewer", "watcher"] as const;
export type Status = (typeof STATUSES)[number];

/** The status workflow: from each status, where a task may go next. Finished and cancelled work can be reopened. */
export const TRANSITIONS: Readonly<Record<Status, readonly Status[]>> = {
  not_started: ["in_progress", "blocked", "cancelled"],
  in_progress: ["not_started", "blocked", "under_review", "completed", "cancelled"],
  blocked: ["not_started", "in_progress", "cancelled"],
  under_review: ["in_progress", "completed", "cancelled"],
  completed: ["in_progress"],
  cancelled: ["not_started"],
};
export const isOpen = (status: string): boolean => status !== "completed" && status !== "cancelled";

export interface Ref { id: string; name: string }
export interface AssigneeView { assignmentId: string; kind: "person" | "team"; id: string; name: string; role: string }
export interface TaskSummary {
  id: string;
  title: string;
  status: string;
  priority: string;
  importanceWeight: number;
  progressPct: number;
  startDate: string | null;
  dueAt: string | null;
  overdue: boolean;
  estimatedMinutes: number | null;
  actualMinutes: number;
  blockedReason: string | null;
  team: Ref | null;
  createdBy: Ref;
  assignees: AssigneeView[];
  completedAt: string | null;
  isDemo: boolean;
  objectiveId: string | null;
  keyResultId: string | null;
  /** Open tasks this one has to wait for. */
  waitingOn: number;
}
export interface DependencyView { id: string; title: string; status: string; visible: boolean }
export interface OutcomeView { summary: string; value: number | null; quality: number | null; reviewedAt: string | null; reviewedBy: Ref | null }
export interface TaskDetail extends TaskSummary {
  description: string;
  parentTaskId: string | null;
  createdAt: string;
  updatedAt: string;
  /** What the caller may do with this task. The server checks again on every write. */
  can: { edit: boolean; editEstimate: boolean; update: boolean; assign: boolean; comment: boolean; link: boolean; recordOutcome: boolean; review: boolean };
  /** The objective and key result it supports (titles only for ones the caller may see). */
  links: { objective: { id: string; title: string; level: string } | null; keyResult: { id: string; title: string } | null; hidden: boolean };
  dependsOn: DependencyView[];
  blocking: DependencyView[];
  outcome: OutcomeView | null;
  /** The statuses this task may move to from where it is. */
  nextStatuses: string[];
}
export interface UpdateView { id: string; type: string; author: Ref; fromStatus: string | null; toStatus: string | null; progressPct: number | null; minutesLogged: number | null; body: string | null; createdAt: string }
export interface CommentView { id: string; author: Ref; body: string; edited: boolean; createdAt: string; mine: boolean }

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: string;
  importanceWeight?: number;
  startDate?: string | null;
  dueAt?: string | null;
  estimatedMinutes?: number | null;
  teamId?: string | null;
  /** People who do the work. Empty (and no team): the creator. */
  assigneeIds?: string[];
  assigneeTeamId?: string | null;
}

const MAX_TITLE = 160;
const isDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export function cleanTitle(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  // eslint-disable-next-line no-control-regex
  if (t.length < 1 || t.length > MAX_TITLE || /[\u0000-\u001f\u007f]/.test(t)) throw new HttpError(400, "invalid_title", `A task title is 1 to ${MAX_TITLE} characters.`);
  return t;
}
const cleanLong = (raw: string | undefined | null, max: number, field: string): string => {
  const t = (raw ?? "").trim();
  if (t.length > max) throw new HttpError(400, "invalid_text", `${field} is at most ${max} characters.`);
  return t;
};
const cleanDate = (raw: string | null | undefined, field: string): string | null => {
  if (raw === undefined || raw === null || raw === "") return null;
  if (!isDay(raw)) throw new HttpError(400, "invalid_date", `${field} must be a real date written YYYY-MM-DD.`);
  return raw;
};

/**
 * Tasks (stage 4.1). Every change is one transaction that also writes its audit row, its history row, the notifications
 * it causes and the business event. Visibility: you always see tasks you created, work on, or watch; beyond that
 * `task.view` reaches the tasks of people (or teams) inside your scope. Writing: the creator and `task.edit` (over the
 * people doing the task) change everything; an assignee updates progress, status and time and sets the estimate.
 */
export class TaskService {
  constructor(
    private readonly o: { store: AuthStore; auth: AuthService; audit: AuditService; events: EventWriter; notifications: NotificationService; okr: OkrService },
  ) {}

  private ctx(auth: AuthContext, requestId: string): TenantCtx {
    return this.o.auth.tenantCtx(auth, requestId);
  }
  private now = (): string => this.o.auth.iso();
  private today(ctx: TenantCtx): string {
    const org = this.o.store.orgs.findById(ctx.organizationId);
    return todayIn(org?.timezone ?? "UTC", new Date(this.now()));
  }

  /** Everything needed to decide who may see and change tasks, loaded once per request. */
  private world(ctx: TenantCtx) {
    const tdb = this.o.store.tenant(ctx);
    const tasks = this.o.store.tasks(tdb);
    const people = this.o.store.people(tdb);
    const structure = this.o.store.structure(tdb);
    const today = this.today(ctx);
    const names = new Map(people.people().map((p) => [p.id, p.display_name]));
    const teams = new Map(structure.teams().map((t) => [t.id, t.name]));
    const myTeams = new Set(people.teamRows({ membershipId: ctx.membershipId, asOf: today }).map((r) => r.team_id));
    const assigns = new Map<string, AssignmentRow[]>();
    for (const a of tasks.activeAssignments()) assigns.set(a.task_id, [...(assigns.get(a.task_id) ?? []), a]);
    const taskStatus = new Map<string, string>();
    const dependsOn = new Map<string, string[]>();
    const blocking = new Map<string, string[]>();
    const depRows = tasks.dependencies();
    if (depRows.length > 0) for (const t of tasks.list({ includeArchived: true })) taskStatus.set(t.id, t.status);
    for (const d of depRows) {
      dependsOn.set(d.task_id, [...(dependsOn.get(d.task_id) ?? []), d.depends_on_task_id]);
      blocking.set(d.depends_on_task_id, [...(blocking.get(d.depends_on_task_id) ?? []), d.task_id]);
    }
    return { ctx, tdb, tasks, people, structure, today, names, teams, myTeams, assigns, taskStatus, dependsOn, blocking };
  }
  private who = (w: ReturnType<TaskService["world"]>, id: string): Ref => ({ id, name: w.names.get(id) ?? "Former member" });

  /** You are involved in the task: you made it, you do it (alone or through a team you belong to), review it or watch it. */
  private involved(w: ReturnType<TaskService["world"]>, t: TaskRow, me: string): boolean {
    if (t.created_by_membership_id === me) return true;
    return (w.assigns.get(t.id) ?? []).some((a) => a.assignee_membership_id === me || (a.assignee_team_id !== null && w.myTeams.has(a.assignee_team_id)));
  }
  private doing(w: ReturnType<TaskService["world"]>, t: TaskRow, me: string): boolean {
    return (w.assigns.get(t.id) ?? []).some((a) => a.role === "assignee" && (a.assignee_membership_id === me || (a.assignee_team_id !== null && w.myTeams.has(a.assignee_team_id))));
  }
  /** Any of the people (or teams) the task belongs to are inside the scope. */
  private inScope(w: ReturnType<TaskService["world"]>, t: TaskRow, scope: ScopeSet): boolean {
    if (scope.all) return true;
    if (scope.members.has(t.created_by_membership_id)) return true;
    return (w.assigns.get(t.id) ?? []).some((a) => (a.assignee_membership_id !== null && scope.members.has(a.assignee_membership_id)) || (a.assignee_team_id !== null && scope.teams.has(a.assignee_team_id)));
  }
  private canSee(w: ReturnType<TaskService["world"]>, caps: Capabilities, t: TaskRow, me: string): boolean {
    return this.involved(w, t, me) || this.inScope(w, t, caps.scope("task.view"));
  }
  private canEditAll(w: ReturnType<TaskService["world"]>, caps: Capabilities, t: TaskRow, me: string): boolean {
    return t.created_by_membership_id === me || this.inScope(w, t, caps.scope("task.edit"));
  }
  private canAssign(w: ReturnType<TaskService["world"]>, caps: Capabilities, t: TaskRow): boolean {
    return this.inScope(w, t, caps.scope("task.assign"));
  }

  private summary(w: ReturnType<TaskService["world"]>, t: TaskRow): TaskSummary {
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      importanceWeight: t.importance_weight,
      progressPct: t.progress_pct,
      startDate: t.start_date,
      dueAt: t.due_at,
      overdue: t.due_at !== null && isOpen(t.status) && t.due_at < w.today,
      estimatedMinutes: t.estimated_minutes,
      actualMinutes: t.actual_minutes,
      blockedReason: t.blocked_reason,
      team: t.team_id ? { id: t.team_id, name: w.teams.get(t.team_id) ?? "Team" } : null,
      createdBy: this.who(w, t.created_by_membership_id),
      assignees: (w.assigns.get(t.id) ?? []).map((a) => (a.assignee_membership_id ? { assignmentId: a.id, kind: "person" as const, id: a.assignee_membership_id, name: w.names.get(a.assignee_membership_id) ?? "Former member", role: a.role } : { assignmentId: a.id, kind: "team" as const, id: a.assignee_team_id!, name: w.teams.get(a.assignee_team_id!) ?? "Team", role: a.role })),
      completedAt: t.completed_at,
      isDemo: t.is_demo === 1,
      objectiveId: t.objective_id,
      keyResultId: t.key_result_id,
      waitingOn: this.waitingOn(w, t.id),
    };
  }
  private waitingOn(w: ReturnType<TaskService["world"]>, id: string): number {
    return (w.dependsOn.get(id) ?? []).filter((d) => isOpen(w.taskStatus.get(d) ?? "completed")).length;
  }

  // ---------- reading ----------

  list(
    auth: AuthContext,
    requestId: string,
    caps: Capabilities,
    q: { assigneeId?: string; teamId?: string; status?: string[]; priority?: string; overdue?: boolean; blocked?: boolean; mine?: boolean; search?: string; dueFrom?: string; dueTo?: string; objectiveId?: string; keyResultId?: string; unaligned?: boolean; waiting?: boolean; limit?: number; offset?: number },
  ): { tasks: TaskSummary[]; total: number; limit: number; offset: number } {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const me = ctx.membershipId;
    const needle = q.search?.trim().toLowerCase();
    const rows = w.tasks.list({ status: q.blocked ? ["blocked"] : q.status, priority: q.priority, dueFrom: q.dueFrom, dueTo: q.dueTo }).filter((t) => {
      if (!this.canSee(w, caps, t, me)) return false;
      const as = w.assigns.get(t.id) ?? [];
      if (q.mine && !this.doing(w, t, me)) return false;
      if (q.assigneeId && !as.some((a) => a.assignee_membership_id === q.assigneeId)) return false;
      if (q.teamId && !(t.team_id === q.teamId || as.some((a) => a.assignee_team_id === q.teamId))) return false;
      if (q.overdue && !(t.due_at !== null && isOpen(t.status) && t.due_at < w.today)) return false;
      if (q.objectiveId && t.objective_id !== q.objectiveId) return false;
      if (q.keyResultId && t.key_result_id !== q.keyResultId) return false;
      if (q.unaligned && (t.objective_id !== null || !isOpen(t.status))) return false;
      if (q.waiting && this.waitingOn(w, t.id) === 0) return false;
      if (needle && !t.title.toLowerCase().includes(needle)) return false;
      return true;
    });
    const limit = Math.min(Math.max(q.limit ?? 100, 1), 300);
    const offset = Math.max(q.offset ?? 0, 0);
    return { tasks: rows.slice(offset, offset + limit).map((t) => this.summary(w, t)), total: rows.length, limit, offset };
  }

  detail(auth: AuthContext, requestId: string, caps: Capabilities, id: string): TaskDetail {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const t = w.tasks.find(id);
    if (!t || t.archived_at || !this.canSee(w, caps, t, ctx.membershipId)) throw notFound(); // missing, another organization's, or outside your scope: the same answer
    return this.toDetail(w, caps, t, ctx.membershipId);
  }

  private toDetail(w: ReturnType<TaskService["world"]>, caps: Capabilities, t: TaskRow, me: string, ctx?: TenantCtx): TaskDetail {
    const editAll = this.canEditAll(w, caps, t, me);
    const doing = this.doing(w, t, me);
    const c = ctx ?? w.ctx;
    // objective titles only for objectives the caller may see
    const linkable = t.objective_id ? this.o.okr.mayLink(c, caps, t.objective_id, t.key_result_id) : { ok: false as const };
    const linkInfo = t.objective_id && linkable.ok ? this.o.okr.linkTitles(c, t.objective_id, t.key_result_id) : null;
    const view = (id: string): DependencyView => {
      const other = w.tasks.find(id);
      const visible = !!other && !other.archived_at && this.canSee(w, caps, other, me);
      return { id, title: visible ? other!.title : "A task you cannot see", status: visible ? other!.status : w.taskStatus.get(id) ?? "unknown", visible };
    };
    const hasOutcome = t.outcome_summary !== null || t.outcome_value !== null || t.outcome_quality !== null;
    return {
      ...this.summary(w, t),
      description: t.description,
      parentTaskId: t.parent_task_id,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      can: {
        edit: editAll,
        editEstimate: editAll || doing,
        update: editAll || doing,
        assign: this.canAssign(w, caps, t),
        comment: true,
        link: editAll,
        recordOutcome: (editAll || doing) && (t.status === "completed" || t.status === "under_review"),
        review: this.canReview(w, caps, t, me),
      },
      nextStatuses: [...(TRANSITIONS[t.status as Status] ?? [])],
      links: { objective: linkInfo ? linkInfo.objective : null, keyResult: linkInfo ? linkInfo.keyResult : null, hidden: !!t.objective_id && !linkable.ok },
      dependsOn: (w.dependsOn.get(t.id) ?? []).map(view),
      blocking: (w.blocking.get(t.id) ?? []).map(view),
      outcome: hasOutcome ? { summary: t.outcome_summary ?? "", value: t.outcome_value, quality: t.outcome_quality, reviewedAt: t.outcome_reviewed_at, reviewedBy: t.outcome_reviewed_by ? this.who(w, t.outcome_reviewed_by) : null } : null,
    };
  }
  /** A reviewer: `task.review` over the people doing the task, and not the only person who did it. */
  private canReview(w: ReturnType<TaskService["world"]>, caps: Capabilities, t: TaskRow, me: string): boolean {
    if (t.status !== "completed") return false;
    if (!this.inScope(w, t, caps.scope("task.review"))) return false;
    const doers = (w.assigns.get(t.id) ?? []).filter((a) => a.role === "assignee" && a.assignee_membership_id !== null).map((a) => a.assignee_membership_id);
    return !(doers.length > 0 && doers.every((d) => d === me));
  }

  updates(auth: AuthContext, requestId: string, caps: Capabilities, id: string): UpdateView[] {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const t = w.tasks.find(id);
    if (!t || t.archived_at || !this.canSee(w, caps, t, ctx.membershipId)) throw notFound();
    return w.tasks.updates(id).map((u: UpdateRow) => ({ id: u.id, type: u.update_type, author: this.who(w, u.author_membership_id), fromStatus: u.from_status, toStatus: u.to_status, progressPct: u.progress_pct, minutesLogged: u.minutes_logged, body: u.body, createdAt: u.created_at }));
  }

  // ---------- creating and editing ----------

  create(auth: AuthContext, requestId: string, caps: Capabilities, input: CreateTaskInput): TaskDetail {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const me = ctx.membershipId;
    const title = cleanTitle(input.title);
    const priority = this.priority(input.priority ?? "medium");
    const weight = this.weight(input.importanceWeight ?? 3);
    const startDate = cleanDate(input.startDate, "The start date");
    const dueAt = cleanDate(input.dueAt, "The due date");
    if (startDate && dueAt && dueAt < startDate) throw new HttpError(400, "invalid_date", "The due date cannot be before the start date.");
    const estimate = this.estimate(input.estimatedMinutes);
    const description = cleanLong(input.description, 4000, "The description");
    const team = input.teamId ? w.structure.team(input.teamId) : undefined;
    if (input.teamId && (!team || team.archived_at)) throw team ? new HttpError(409, "archived", "That team is archived.") : notFound();

    const assignScope = caps.scope("task.assign");
    let assignees = [...new Set(input.assigneeIds ?? [])];
    if (assignees.length === 0 && !input.assigneeTeamId) assignees = [me]; // no one named: the task is yours
    for (const id of assignees) this.checkAssignee(w, id, me, assignScope);
    let assigneeTeam: string | null = null;
    if (input.assigneeTeamId) {
      const t = w.structure.team(input.assigneeTeamId);
      if (!t) throw notFound();
      if (t.archived_at) throw new HttpError(409, "archived", "That team is archived.");
      if (!(assignScope.all || assignScope.teams.has(t.id) || w.myTeams.has(t.id) && !isEmptyAssign(assignScope))) throw new HttpError(403, "outside_scope", "You can give tasks to teams in your scope.");
      assigneeTeam = t.id;
    }

    const id = newId();
    const now = this.now();
    this.o.store.transaction(() => {
      w.tasks.insert({ id, title, description, priority, importanceWeight: weight, startDate, dueAt, estimatedMinutes: estimate, teamId: team?.id ?? null, parentTaskId: null, createdBy: me, now });
      for (const a of assignees) w.tasks.insertAssignment({ id: newId(), taskId: id, membershipId: a, teamId: null, role: "assignee", by: me, now });
      if (assigneeTeam) w.tasks.insertAssignment({ id: newId(), taskId: id, membershipId: null, teamId: assigneeTeam, role: "assignee", by: me, now });
      this.o.audit.record(w.tdb, ctx, { action: "task.create", entityType: "task", entityId: id, summary: `Created the task "${title}"${assignees.length ? ` for ${assignees.map((a) => w.names.get(a) ?? "a person").join(", ")}` : ""}`, after: { title, priority, dueAt, assigneeIds: assignees, assigneeTeamId: assigneeTeam } });
      this.o.events.record(w.tdb, ctx, { eventType: "task.created", entityType: "task", entityId: id, dedupeKey: `task.created:${id}`, payload: { taskId: id, title, priority, dueAt } });
      for (const a of assignees) this.announceAssigned(w, ctx, id, title, a, `${id}:${a}:create`);
    });
    const t = w.tasks.find(id)!;
    const fresh = this.world(ctx);
    return this.toDetail(fresh, caps, t, me);
  }

  update(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: { title?: string; description?: string; priority?: string; importanceWeight?: number; startDate?: string | null; dueAt?: string | null; estimatedMinutes?: number | null; teamId?: string | null; objectiveId?: string | null; keyResultId?: string | null }): TaskDetail {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const me = ctx.membershipId;
    const t = w.tasks.find(id);
    if (!t || t.archived_at || !this.canSee(w, caps, t, me)) throw notFound();
    const editAll = this.canEditAll(w, caps, t, me);
    const fields = Object.keys(input);
    const onlyEstimate = fields.every((f) => f === "estimatedMinutes");
    if (!editAll && !(this.doing(w, t, me) && onlyEstimate)) throw new HttpError(403, "permission_denied", "You can change the estimate of a task you work on. Other changes are for the person who created it or who manages the people doing it.");
    const next = {
      title: input.title !== undefined ? cleanTitle(input.title) : t.title,
      description: input.description !== undefined ? cleanLong(input.description, 4000, "The description") : t.description,
      priority: input.priority !== undefined ? this.priority(input.priority) : t.priority,
      importanceWeight: input.importanceWeight !== undefined ? this.weight(input.importanceWeight) : t.importance_weight,
      startDate: input.startDate !== undefined ? cleanDate(input.startDate, "The start date") : t.start_date,
      dueAt: input.dueAt !== undefined ? cleanDate(input.dueAt, "The due date") : t.due_at,
      estimatedMinutes: input.estimatedMinutes !== undefined ? this.estimate(input.estimatedMinutes) : t.estimated_minutes,
      teamId: input.teamId !== undefined ? input.teamId : t.team_id,
      ...this.resolveLinks(ctx, caps, t, input),
    };
    if (next.startDate && next.dueAt && next.dueAt < next.startDate) throw new HttpError(400, "invalid_date", "The due date cannot be before the start date.");
    if (next.teamId && next.teamId !== t.team_id) {
      const team = w.structure.team(next.teamId);
      if (!team) throw notFound();
      if (team.archived_at) throw new HttpError(409, "archived", "That team is archived.");
    }
    if (!isOpen(t.status) && fields.some((f) => f !== "estimatedMinutes" && f !== "description" && f !== "objectiveId" && f !== "keyResultId")) throw new HttpError(409, "task_closed", "This task is finished or cancelled. Reopen it before changing it.");
    const prev = { title: t.title, description: t.description, priority: t.priority, importanceWeight: t.importance_weight, startDate: t.start_date, dueAt: t.due_at, estimatedMinutes: t.estimated_minutes, teamId: t.team_id, objectiveId: t.objective_id, keyResultId: t.key_result_id };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== prev[k]);
    if (changed.length === 0) return this.toDetail(w, caps, t, me);
    const now = this.now();
    this.o.store.transaction(() => {
      w.tasks.updateFields({ id, ...next, now });
      if (changed.includes("objectiveId") || changed.includes("keyResultId")) w.tasks.setLinks(id, next.objectiveId, next.keyResultId, now);
      this.o.audit.record(w.tdb, ctx, { action: "task.update", entityType: "task", entityId: id, summary: `Changed the task "${next.title}" (${changed.join(", ")})`, before: Object.fromEntries(changed.map((k) => [k, k === "description" ? "(text)" : prev[k]])), after: Object.fromEntries(changed.map((k) => [k, k === "description" ? "(text)" : next[k]])) });
    });
    const fresh = this.world(ctx);
    return this.toDetail(fresh, caps, fresh.tasks.find(id)!, me);
  }

  /** Which objective and key result a change leaves the task linked to. The caller must be able to see what they link. */
  private resolveLinks(ctx: TenantCtx, caps: Capabilities, t: TaskRow, input: { objectiveId?: string | null; keyResultId?: string | null }): { objectiveId: string | null; keyResultId: string | null } {
    if (input.objectiveId === undefined && input.keyResultId === undefined) return { objectiveId: t.objective_id, keyResultId: t.key_result_id };
    let objectiveId = input.objectiveId !== undefined ? input.objectiveId : t.objective_id;
    let keyResultId = input.keyResultId !== undefined ? input.keyResultId : input.objectiveId !== undefined && input.objectiveId !== t.objective_id ? null : t.key_result_id;
    if (keyResultId) {
      const owner = this.o.okr.objectiveOfKeyResult(ctx, keyResultId);
      if (!owner) throw notFound();
      if (objectiveId && input.objectiveId && input.objectiveId !== owner) throw new HttpError(400, "link_mismatch", "That key result belongs to a different objective.");
      objectiveId = owner;
    }
    if (objectiveId && !this.o.okr.mayLink(ctx, caps, objectiveId, keyResultId).ok) throw notFound();
    if (!objectiveId) keyResultId = null;
    return { objectiveId, keyResultId };
  }

  // ---------- dependencies, outcome and review (stage 4.2) ----------

  addDependency(auth: AuthContext, requestId: string, caps: Capabilities, id: string, dependsOnId: string): TaskDetail {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const me = ctx.membershipId;
    const t = w.tasks.find(id);
    const other = w.tasks.find(dependsOnId);
    if (!t || t.archived_at || !this.canSee(w, caps, t, me) || !other || other.archived_at || !this.canSee(w, caps, other, me)) throw notFound();
    if (!this.canEditAll(w, caps, t, me)) throw new HttpError(403, "permission_denied", "Only the person who created this task, or their manager, can set what it waits for.");
    if (id === dependsOnId) throw new HttpError(400, "self_dependency", "A task cannot wait for itself.");
    if (!isOpen(t.status)) throw new HttpError(409, "task_closed", "This task is finished or cancelled. Reopen it first.");
    if ((w.dependsOn.get(id) ?? []).includes(dependsOnId)) throw new HttpError(409, "already_dependent", "That dependency already exists.");
    if (this.reaches(w, dependsOnId, id)) throw new HttpError(409, "dependency_loop", `"${other.title}" already waits for this task (directly or through other tasks), so this would make a loop.`);
    this.o.store.transaction(() => {
      w.tasks.insertDependency(id, dependsOnId, me, this.now());
      this.o.audit.record(w.tdb, ctx, { action: "task.dependency_add", entityType: "task", entityId: id, summary: `"${t.title}" now waits for "${other.title}"`, after: { dependsOnId } });
    });
    const fresh = this.world(ctx);
    return this.toDetail(fresh, caps, fresh.tasks.find(id)!, me);
  }

  removeDependency(auth: AuthContext, requestId: string, caps: Capabilities, id: string, dependsOnId: string): TaskDetail {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const me = ctx.membershipId;
    const t = w.tasks.find(id);
    if (!t || t.archived_at || !this.canSee(w, caps, t, me)) throw notFound();
    if (!this.canEditAll(w, caps, t, me)) throw new HttpError(403, "permission_denied", "Only the person who created this task, or their manager, can set what it waits for.");
    if (!(w.dependsOn.get(id) ?? []).includes(dependsOnId)) throw notFound();
    this.o.store.transaction(() => {
      w.tasks.deleteDependency(id, dependsOnId);
      this.o.audit.record(w.tdb, ctx, { action: "task.dependency_remove", entityType: "task", entityId: id, summary: `"${t.title}" no longer waits for another task`, before: { dependsOnId } });
    });
    const fresh = this.world(ctx);
    return this.toDetail(fresh, caps, fresh.tasks.find(id)!, me);
  }

  /** Whether `from` waits (directly or through other tasks) for `target`. */
  private reaches(w: ReturnType<TaskService["world"]>, from: string, target: string): boolean {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (cur === target) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      stack.push(...(w.dependsOn.get(cur) ?? []));
    }
    return false;
  }

  /**
   * Records what the task achieved. The summary is required; a measured value is optional, and, when the task supports a
   * key result and the caller asks for it, it is also recorded as that key result's actual value (history source
   * "task_outcome"). Finishing a task never moves an objective by itself: only recorded values do.
   */
  recordOutcome(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: { summary: string; value?: number | null; recordOnKeyResult?: boolean }): TaskDetail {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const me = ctx.membershipId;
    const t = w.tasks.find(id);
    if (!t || t.archived_at || !this.canSee(w, caps, t, me)) throw notFound();
    if (!(this.canEditAll(w, caps, t, me) || this.doing(w, t, me))) throw new HttpError(403, "permission_denied", "Only the people doing this task, the person who created it, or their manager can record its outcome.");
    if (t.status !== "completed" && t.status !== "under_review") throw new HttpError(409, "not_finished", "Record the outcome once the task is finished or under review.");
    const summary = cleanLong(input.summary, 2000, "The outcome");
    if (summary.length === 0) throw new HttpError(400, "outcome_required", "Say in a sentence what the task achieved.");
    const value = input.value === undefined || input.value === null ? null : input.value;
    if (value !== null && (!Number.isFinite(value) || Math.abs(value) > 1e12)) throw new HttpError(400, "invalid_number", "The measured value must be a number.");
    const alsoKr = input.recordOnKeyResult === true;
    if (alsoKr) {
      if (value === null) throw new HttpError(400, "value_required", "Give the measured value to record it on the key result.");
      if (!t.key_result_id) throw new HttpError(409, "no_key_result", "This task is not linked to a key result.");
      if (!this.o.okr.mayRecord(ctx, caps, t.key_result_id)) throw new HttpError(403, "permission_denied", "You cannot record values for this key result, or its objective is not active.");
    }
    this.o.store.transaction(() => {
      w.tasks.setOutcome(id, summary, value, this.now());
      this.o.audit.record(w.tdb, ctx, { action: "task.outcome", entityType: "task", entityId: id, summary: `Recorded the outcome of the task "${t.title}"`, after: { value, onKeyResult: alsoKr } });
      this.o.events.record(w.tdb, ctx, { eventType: "task.outcome_recorded", entityType: "task", entityId: id, dedupeKey: `task.outcome:${id}:${this.now()}`, payload: { taskId: id, title: t.title, value } });
      if (alsoKr) this.o.okr.recordProgress(auth, requestId, caps, t.key_result_id!, { value: value!, note: `From the task "${t.title}": ${summary}`.slice(0, 1000) }, "task_outcome");
    });
    const fresh = this.world(ctx);
    return this.toDetail(fresh, caps, fresh.tasks.find(id)!, me);
  }

  /** A reviewer's 1 to 5 rating of the finished work. Not for the only person who did it. */
  review(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: { quality: number; note?: string }): TaskDetail {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const me = ctx.membershipId;
    const t = w.tasks.find(id);
    if (!t || t.archived_at || !this.canSee(w, caps, t, me)) throw notFound();
    if (t.status !== "completed") throw new HttpError(409, "not_finished", "Only finished tasks can be reviewed.");
    if (!this.canReview(w, caps, t, me)) throw new HttpError(403, "permission_denied", "You can review finished work of people in your scope, but not your own.");
    if (!Number.isInteger(input.quality) || input.quality < 1 || input.quality > 5) throw new HttpError(400, "invalid_quality", "The quality rating is a whole number from 1 to 5.");
    const note = cleanLong(input.note, 1000, "The note") || null;
    this.o.store.transaction(() => {
      w.tasks.setReview(id, input.quality, me, this.now());
      const uid = newId();
      w.tasks.insertUpdate({ id: uid, taskId: id, author: me, type: "review", fromStatus: null, toStatus: null, progressPct: null, minutes: null, body: `Rated ${input.quality} of 5${note ? `: ${note}` : ""}`, now: this.now() });
      this.o.audit.record(w.tdb, ctx, { action: "task.review", entityType: "task", entityId: id, summary: `Rated the outcome of the task "${t.title}" ${input.quality} of 5`, after: { quality: input.quality } });
      this.o.events.record(w.tdb, ctx, { eventType: "task.reviewed", entityType: "task", entityId: id, dedupeKey: `task.reviewed:${uid}`, payload: { taskId: id, title: t.title, quality: input.quality } });
      const doers = (w.assigns.get(id) ?? []).filter((a) => a.role === "assignee" && a.assignee_membership_id !== null && a.assignee_membership_id !== me).map((a) => a.assignee_membership_id!);
      if (doers.length > 0) this.o.notifications.notify(w.tdb, { recipients: doers, type: "task.reviewed", title: `${w.names.get(me) ?? "A reviewer"} reviewed your finished task`, body: `${t.title}: ${input.quality} of 5`, entityType: "task", entityId: id, dedupeKey: `task.reviewed:${uid}` });
    });
    const fresh = this.world(ctx);
    return this.toDetail(fresh, caps, fresh.tasks.find(id)!, me);
  }

  // ---------- assignments ----------

  assign(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: { assigneeId?: string; teamId?: string; role?: string }): TaskDetail {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const me = ctx.membershipId;
    const t = w.tasks.find(id);
    if (!t || t.archived_at || !this.canSee(w, caps, t, me)) throw notFound();
    if (!this.canAssign(w, caps, t)) throw new HttpError(403, "permission_denied", "You cannot change who does this task.");
    if (!isOpen(t.status)) throw new HttpError(409, "task_closed", "This task is finished or cancelled. Reopen it first.");
    if ((input.assigneeId ? 1 : 0) + (input.teamId ? 1 : 0) !== 1) throw new HttpError(400, "validation_failed", "Request did not pass validation", [{ path: "assigneeId", message: "Give a person or a team, not both and not neither" }]);
    const role = input.role ?? "assignee";
    if (!(ASSIGNMENT_ROLES as readonly string[]).includes(role)) throw new HttpError(400, "invalid_role", `A role is one of: ${ASSIGNMENT_ROLES.join(", ")}.`);
    const scope = caps.scope("task.assign");
    const already = (w.assigns.get(id) ?? []).some((a) => a.role === role && (input.assigneeId ? a.assignee_membership_id === input.assigneeId : a.assignee_team_id === input.teamId));
    if (already) throw new HttpError(409, "already_assigned", "That is already assigned to this task.");
    if (input.assigneeId) this.checkAssignee(w, input.assigneeId, me, scope);
    if (input.teamId) {
      const team = w.structure.team(input.teamId);
      if (!team) throw notFound();
      if (team.archived_at) throw new HttpError(409, "archived", "That team is archived.");
      if (!(scope.all || scope.teams.has(team.id))) throw new HttpError(403, "outside_scope", "You can give tasks to teams in your scope.");
    }
    const aid = newId();
    const now = this.now();
    const label = input.assigneeId ? w.names.get(input.assigneeId) ?? "a person" : w.teams.get(input.teamId!) ?? "a team";
    this.o.store.transaction(() => {
      w.tasks.insertAssignment({ id: aid, taskId: id, membershipId: input.assigneeId ?? null, teamId: input.teamId ?? null, role, by: me, now });
      this.o.audit.record(w.tdb, ctx, { action: "task.assign", entityType: "task", entityId: id, summary: `Added ${label} as ${role} on the task "${t.title}"`, after: { assignee: input.assigneeId ?? input.teamId, role } });
      if (role === "assignee" && input.assigneeId) this.announceAssigned(w, ctx, id, t.title, input.assigneeId, `${id}:${input.assigneeId}:${aid}`);
    });
    const fresh = this.world(ctx);
    return this.toDetail(fresh, caps, fresh.tasks.find(id)!, me);
  }

  unassign(auth: AuthContext, requestId: string, caps: Capabilities, id: string, assignmentId: string): TaskDetail {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const me = ctx.membershipId;
    const t = w.tasks.find(id);
    const a = w.tasks.assignment(assignmentId);
    if (!t || t.archived_at || !a || a.task_id !== id || !this.canSee(w, caps, t, me)) throw notFound();
    if (!this.canAssign(w, caps, t)) throw new HttpError(403, "permission_denied", "You cannot change who does this task.");
    if (a.unassigned_at) throw new HttpError(409, "already_ended", "That assignment has already ended.");
    const label = a.assignee_membership_id ? w.names.get(a.assignee_membership_id) ?? "a person" : w.teams.get(a.assignee_team_id!) ?? "a team";
    this.o.store.transaction(() => {
      w.tasks.endAssignment(assignmentId, this.now());
      this.o.audit.record(w.tdb, ctx, { action: "task.unassign", entityType: "task", entityId: id, summary: `Took ${label} off the task "${t.title}"`, before: { assignee: a.assignee_membership_id ?? a.assignee_team_id, role: a.role } });
    });
    const fresh = this.world(ctx);
    return this.toDetail(fresh, caps, fresh.tasks.find(id)!, me);
  }

  /** The person must be live in this organization; without `task.assign` over them the only valid assignee is yourself. */
  private checkAssignee(w: ReturnType<TaskService["world"]>, assigneeId: string, me: string, scope: ScopeSet): void {
    const p: PersonRow | undefined = w.people.person(assigneeId);
    if (!p) throw notFound();
    if (p.archived_at !== null || p.status === "left") throw new HttpError(409, "archived", `${p.display_name} no longer belongs to the organization.`);
    const allowed = assigneeId === me ? true : scopeContainsMember(scope, assigneeId);
    if (!allowed) throw new HttpError(403, "outside_scope", "You can give tasks to people in your scope.");
  }

  private announceAssigned(w: ReturnType<TaskService["world"]>, ctx: TenantCtx, taskId: string, title: string, assigneeId: string, key: string): void {
    this.o.events.record(w.tdb, ctx, { eventType: "task.assigned", entityType: "task", entityId: taskId, dedupeKey: `task.assigned:${key}`, payload: { taskId, title, assigneeId } });
    if (assigneeId === ctx.membershipId) return; // no notice for work you gave yourself
    this.o.notifications.notify(w.tdb, { recipients: [assigneeId], type: "task.assigned", title: `${w.names.get(ctx.membershipId) ?? "Someone"} gave you a task`, body: title, entityType: "task", entityId: taskId, dedupeKey: `task.assigned:${key}` });
  }

  // ---------- progress, status, time, blockers (append-only history) ----------

  addUpdate(
    auth: AuthContext,
    requestId: string,
    caps: Capabilities,
    id: string,
    input: { type: "status_change" | "progress" | "time_log" | "blocker"; toStatus?: string; progressPct?: number; minutesLogged?: number; note?: string },
  ): TaskDetail {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const me = ctx.membershipId;
    const t = w.tasks.find(id);
    if (!t || t.archived_at || !this.canSee(w, caps, t, me)) throw notFound();
    if (!(this.canEditAll(w, caps, t, me) || this.doing(w, t, me))) throw new HttpError(403, "permission_denied", "Only the people doing this task, the person who created it, or their manager can update it.");
    const note = cleanLong(input.note, 1000, "The note") || null;
    const now = this.now();
    const uid = newId();

    this.o.store.transaction(() => {
      if (input.type === "status_change") {
        const to = input.toStatus as Status | undefined;
        if (!to || !(STATUSES as readonly string[]).includes(to)) throw new HttpError(400, "invalid_status", `A status is one of: ${STATUSES.join(", ")}.`);
        if (to === t.status) throw new HttpError(409, "no_change", "The task is already in that status.");
        if (!TRANSITIONS[t.status as Status]?.includes(to)) throw new HttpError(409, "invalid_transition", `A task that is ${t.status.replace("_", " ")} cannot go straight to ${to.replace("_", " ")}.`, { allowed: TRANSITIONS[t.status as Status] });
        if (to === "blocked" && !note) throw new HttpError(400, "reason_required", "Say what is blocking the task.");
        const completed = to === "completed";
        if (completed && this.waitingOn(w, id) > 0) throw new HttpError(409, "waiting_on_tasks", `This task waits for ${this.waitingOn(w, id)} other ${this.waitingOn(w, id) === 1 ? "task" : "tasks"} that ${this.waitingOn(w, id) === 1 ? "is" : "are"} not finished yet.`, { waitingOn: this.waitingOn(w, id) });
        const progress = completed ? 100 : t.status === "completed" ? Math.min(t.progress_pct, 90) : t.progress_pct;
        w.tasks.setStatus({ id, status: to, progressPct: progress, completedAt: completed ? now : null, blockedReason: to === "blocked" ? note : null, now });
        w.tasks.insertUpdate({ id: uid, taskId: id, author: me, type: "status_change", fromStatus: t.status, toStatus: to, progressPct: progress, minutes: null, body: note, now });
        this.o.audit.record(w.tdb, ctx, { action: "task.status", entityType: "task", entityId: id, summary: `Moved the task "${t.title}" from ${t.status.replace("_", " ")} to ${to.replace("_", " ")}`, before: { status: t.status }, after: { status: to } });
        this.o.events.record(w.tdb, ctx, { eventType: completed ? "task.completed" : "task.status_changed", entityType: "task", entityId: id, dedupeKey: `task.status:${uid}`, payload: { taskId: id, title: t.title, from: t.status, to } });
        const creator = t.created_by_membership_id;
        if (creator !== me && (to === "blocked" || completed)) {
          this.o.notifications.notify(w.tdb, {
            recipients: [creator],
            type: completed ? "task.completed" : "task.blocked",
            title: completed ? `${w.names.get(me) ?? "Someone"} completed a task you created` : `${w.names.get(me) ?? "Someone"} reported a blocker`,
            body: completed ? t.title : `${t.title}: ${note}`,
            severity: completed ? "info" : "warning",
            entityType: "task",
            entityId: id,
            dedupeKey: `task.status:${uid}`,
          });
        }
        return;
      }
      if (!isOpen(t.status)) throw new HttpError(409, "task_closed", "This task is finished or cancelled. Reopen it before adding to it.");
      if (input.type === "progress") {
        const pct = input.progressPct;
        if (pct === undefined || !Number.isInteger(pct) || pct < 0 || pct > 100) throw new HttpError(400, "invalid_progress", "Progress is a whole number from 0 to 100.");
        if (pct === 100) throw new HttpError(400, "use_complete", "Mark the task completed instead of setting 100%.");
        w.tasks.setProgress(id, pct, now);
        w.tasks.insertUpdate({ id: uid, taskId: id, author: me, type: "progress", fromStatus: null, toStatus: null, progressPct: pct, minutes: null, body: note, now });
        // some progress on work not yet started means it has started
        if (t.status === "not_started" && pct > 0) {
          w.tasks.setStatus({ id, status: "in_progress", progressPct: pct, completedAt: null, blockedReason: null, now });
          w.tasks.insertUpdate({ id: newId(), taskId: id, author: me, type: "status_change", fromStatus: "not_started", toStatus: "in_progress", progressPct: pct, minutes: null, body: "Started (progress recorded)", now });
          this.o.audit.record(w.tdb, ctx, { action: "task.status", entityType: "task", entityId: id, summary: `Moved the task "${t.title}" from not started to in progress`, before: { status: "not_started" }, after: { status: "in_progress" } });
        }
        return;
      }
      if (input.type === "time_log") {
        const m = input.minutesLogged;
        if (m === undefined || !Number.isInteger(m) || m < 1 || m > 1440) throw new HttpError(400, "invalid_minutes", "Time is a whole number of minutes from 1 to 1440.");
        w.tasks.addMinutes(id, m, now);
        w.tasks.insertUpdate({ id: uid, taskId: id, author: me, type: "time_log", fromStatus: null, toStatus: null, progressPct: null, minutes: m, body: note, now });
        return;
      }
      if (input.type === "blocker") {
        if (!note) throw new HttpError(400, "reason_required", "Say what is blocking the task.");
        w.tasks.setBlockedReason(id, note, now);
        w.tasks.insertUpdate({ id: uid, taskId: id, author: me, type: "blocker", fromStatus: null, toStatus: null, progressPct: null, minutes: null, body: note, now });
        if (t.created_by_membership_id !== me) this.o.notifications.notify(w.tdb, { recipients: [t.created_by_membership_id], type: "task.blocked", title: `${w.names.get(me) ?? "Someone"} reported a blocker`, body: `${t.title}: ${note}`, severity: "warning", entityType: "task", entityId: id, dedupeKey: `task.blocker:${uid}` });
        return;
      }
      throw new HttpError(400, "invalid_type", "An update is a status change, progress, time or a blocker.");
    });
    const fresh = this.world(ctx);
    return this.toDetail(fresh, caps, fresh.tasks.find(id)!, me);
  }

  // ---------- comments ----------

  comments(auth: AuthContext, requestId: string, caps: Capabilities, id: string): CommentView[] {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const t = w.tasks.find(id);
    if (!t || t.archived_at || !this.canSee(w, caps, t, ctx.membershipId)) throw notFound();
    return w.tasks.comments(id).map((c) => ({ id: c.id, author: this.who(w, c.author_membership_id), body: c.body, edited: c.edited_at !== null, createdAt: c.created_at, mine: c.author_membership_id === ctx.membershipId }));
  }

  addComment(auth: AuthContext, requestId: string, caps: Capabilities, id: string, body: string): CommentView {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const me = ctx.membershipId;
    const t = w.tasks.find(id);
    if (!t || t.archived_at || !this.canSee(w, caps, t, me)) throw notFound();
    const text = cleanLong(body, 2000, "A comment");
    if (!text) throw new HttpError(400, "invalid_text", "A comment cannot be empty.");
    const cid = newId();
    const now = this.now();
    this.o.store.transaction(() => {
      w.tasks.insertComment({ id: cid, taskId: id, author: me, body: text, now });
      const recipients = new Set<string>([t.created_by_membership_id, ...(w.assigns.get(id) ?? []).flatMap((a) => (a.assignee_membership_id ? [a.assignee_membership_id] : []))]);
      recipients.delete(me);
      this.o.notifications.notify(w.tdb, { recipients: [...recipients], type: "task.comment", title: `${w.names.get(me) ?? "Someone"} commented on a task`, body: `${t.title}: ${text.length > 140 ? `${text.slice(0, 137)}…` : text}`, entityType: "task", entityId: id, dedupeKey: `task.comment:${cid}` });
    });
    return { id: cid, author: this.who(w, me), body: text, edited: false, createdAt: now, mine: true };
  }

  editComment(auth: AuthContext, requestId: string, caps: Capabilities, id: string, commentId: string, body: string): CommentView {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const t = w.tasks.find(id);
    const c = w.tasks.comment(commentId);
    if (!t || !c || c.task_id !== id || c.deleted_at || !this.canSee(w, caps, t, ctx.membershipId)) throw notFound();
    if (c.author_membership_id !== ctx.membershipId) throw new HttpError(403, "permission_denied", "You can change your own comments only.");
    const text = cleanLong(body, 2000, "A comment");
    if (!text) throw new HttpError(400, "invalid_text", "A comment cannot be empty.");
    const now = this.now();
    w.tasks.editComment(commentId, text, now);
    return { id: c.id, author: this.who(w, c.author_membership_id), body: text, edited: true, createdAt: c.created_at, mine: true };
  }

  deleteComment(auth: AuthContext, requestId: string, caps: Capabilities, id: string, commentId: string): void {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const t = w.tasks.find(id);
    const c = w.tasks.comment(commentId);
    if (!t || !c || c.task_id !== id || c.deleted_at || !this.canSee(w, caps, t, ctx.membershipId)) throw notFound();
    if (c.author_membership_id !== ctx.membershipId) throw new HttpError(403, "permission_denied", "You can delete your own comments only.");
    w.tasks.deleteComment(commentId, this.now()); // soft delete: the row stays
  }

  // ---------- my work (stage 4.4) ----------

  /**
   * The daily workspace of the signed-in person: their own open tasks grouped by urgency, a rule-based suggested order
   * with the reasons, what they finished lately and today's daily update. Own data only, so it needs no permission.
   */
  myWork(auth: AuthContext, requestId: string): MyWork {
    const ctx = this.ctx(auth, requestId);
    if (!ctx.membershipId) throw new HttpError(403, "no_organization", "Join or create an organization first.");
    const w = this.world(ctx);
    const me = ctx.membershipId;
    const mine = w.tasks.list().filter((t) => this.doing(w, t, me));
    const open = mine.filter((t) => isOpen(t.status));
    const view = (t: TaskRow) => this.summary(w, t);
    const weekEnd = addDays(w.today, 7);
    const overdue = open.filter((t) => t.due_at !== null && t.due_at < w.today);
    const dueToday = open.filter((t) => t.due_at === w.today);
    const upcoming = open.filter((t) => t.due_at !== null && t.due_at > w.today && t.due_at <= weekEnd);
    const blocked = open.filter((t) => t.status === "blocked");
    const underWay = open.filter((t) => t.status === "in_progress");
    const unscheduled = open.filter((t) => t.due_at === null && t.status !== "blocked" && t.status !== "in_progress");
    const order = suggestOrder(open.map((t) => ({ id: t.id, status: t.status, priority: t.priority, importanceWeight: t.importance_weight, dueAt: t.due_at, waitingOn: this.waitingOn(w, t.id), aligned: t.objective_id !== null })), w.today);
    const byId = new Map(open.map((t) => [t.id, t]));
    const since = addDays(w.today, -14);
    const achievements = mine.filter((t) => t.status === "completed" && t.completed_at !== null && t.completed_at.slice(0, 10) >= since).sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? "")).slice(0, 10);
    const du = w.tasks.dailyUpdate(me, w.today);
    return {
      today: w.today,
      counts: { open: open.length, overdue: overdue.length, dueToday: dueToday.length, blocked: blocked.length, completedRecently: achievements.length },
      overdue: overdue.map(view),
      dueToday: dueToday.map(view),
      upcoming: upcoming.map(view),
      blocked: blocked.map(view),
      inProgress: underWay.map(view),
      unscheduled: unscheduled.map(view),
      suggested: order.slice(0, 8).map((r) => ({ task: view(byId.get(r.id)!), score: r.score, reasons: r.reasons })),
      achievements: achievements.map(view),
      dailyUpdate: du ? { date: du.update_date, summary: du.summary, blockers: du.blockers, submittedAt: du.submitted_at } : null,
    };
  }

  /** One short update per person per day (today, or yesterday to catch up). Sending it again the same day replaces it. */
  submitDailyUpdate(auth: AuthContext, requestId: string, input: { summary: string; blockers?: string | null; date?: string | null }): { date: string; summary: string; blockers: string | null; replaced: boolean } {
    const ctx = this.ctx(auth, requestId);
    if (!ctx.membershipId) throw new HttpError(403, "no_organization", "Join or create an organization first.");
    const me = ctx.membershipId;
    const tdb = this.o.store.tenant(ctx);
    const repo = this.o.store.tasks(tdb);
    const today = this.today(ctx);
    const date = cleanDate(input.date, "The date") ?? today;
    if (date > today || date < addDays(today, -1)) throw new HttpError(400, "invalid_date", "A daily update is for today or yesterday.");
    const summary = cleanLong(input.summary, 2000, "The update");
    if (!summary) throw new HttpError(400, "invalid_text", "Write what you did or plan to do.");
    const blockers = cleanLong(input.blockers, 1000, "The blockers") || null;
    const now = this.now();
    const existing = repo.dailyUpdate(me, date);
    this.o.store.transaction(() => {
      if (existing) repo.updateDailyUpdate(existing.id, summary, blockers, now);
      else repo.insertDailyUpdate({ id: newId(), membershipId: me, day: date, summary, blockers, now });
      this.o.events.record(tdb, ctx, { eventType: "daily_update.submitted", entityType: "daily_update", entityId: existing?.id ?? me, dedupeKey: `daily_update.submitted:${me}:${date}`, payload: { membershipId: me, date, hasBlockers: blockers !== null } });
    });
    return { date, summary, blockers, replaced: existing !== undefined };
  }

  dailyUpdates(auth: AuthContext, requestId: string, q: { from?: string; to?: string }): { date: string; summary: string; blockers: string | null; submittedAt: string }[] {
    const ctx = this.ctx(auth, requestId);
    if (!ctx.membershipId) throw new HttpError(403, "no_organization", "Join or create an organization first.");
    const today = this.today(ctx);
    const from = cleanDate(q.from, "from") ?? addDays(today, -30);
    const to = cleanDate(q.to, "to") ?? today;
    return this.o.store.tasks(this.o.store.tenant(ctx)).dailyUpdates(ctx.membershipId, from, to).map((d) => ({ date: d.update_date, summary: d.summary, blockers: d.blockers, submittedAt: d.submitted_at }));
  }

  // ---------- small checks ----------

  private priority(p: string): string {
    if (!(PRIORITIES as readonly string[]).includes(p)) throw new HttpError(400, "invalid_priority", `Priority is one of: ${PRIORITIES.join(", ")}.`);
    return p;
  }
  private weight(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new HttpError(400, "invalid_importance", "Importance is a whole number from 1 to 5.");
    return n;
  }
  private estimate(n: number | null | undefined): number | null {
    if (n === undefined || n === null) return null;
    if (!Number.isInteger(n) || n < 1 || n > 100_000) throw new HttpError(400, "invalid_estimate", "An estimate is a whole number of minutes, at least 1.");
    return n;
  }
}

export interface MyWork {
  today: string;
  counts: { open: number; overdue: number; dueToday: number; blocked: number; completedRecently: number };
  overdue: TaskSummary[];
  dueToday: TaskSummary[];
  upcoming: TaskSummary[];
  blocked: TaskSummary[];
  inProgress: TaskSummary[];
  unscheduled: TaskSummary[];
  /** The rule-based order, best first, with the reasons in words. */
  suggested: { task: TaskSummary; score: number; reasons: string[] }[];
  achievements: TaskSummary[];
  dailyUpdate: { date: string; summary: string; blockers: string | null; submittedAt: string } | null;
}

const isEmptyAssign = (s: ScopeSet): boolean => !s.all && s.members.size === 0 && s.teams.size === 0 && s.departments.size === 0;
