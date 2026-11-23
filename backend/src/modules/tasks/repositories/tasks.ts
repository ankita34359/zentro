import type { TenantDb } from "../../../db/tenant.js";

export interface TaskRow {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  importance_weight: number;
  progress_pct: number;
  start_date: string | null;
  due_at: string | null;
  estimated_minutes: number | null;
  actual_minutes: number;
  completed_at: string | null;
  blocked_reason: string | null;
  team_id: string | null;
  parent_task_id: string | null;
  created_by_membership_id: string;
  archived_at: string | null;
  is_demo: number;
  created_at: string;
  updated_at: string;
  objective_id: string | null;
  key_result_id: string | null;
  outcome_summary: string | null;
  outcome_value: number | null;
  outcome_quality: number | null;
  outcome_reviewed_at: string | null;
  outcome_reviewed_by: string | null;
}
const TASK_COLS = "id, title, description, status, priority, importance_weight, progress_pct, start_date, due_at, estimated_minutes, actual_minutes, completed_at, blocked_reason, team_id, parent_task_id, created_by_membership_id, archived_at, is_demo, created_at, updated_at, objective_id, key_result_id, outcome_summary, outcome_value, outcome_quality, outcome_reviewed_at, outcome_reviewed_by";

export interface AssignmentRow {
  id: string;
  task_id: string;
  assignee_membership_id: string | null;
  assignee_team_id: string | null;
  role: string;
  assigned_at: string;
  assigned_by_membership_id: string;
  unassigned_at: string | null;
}
const ASSIGN_COLS = "id, task_id, assignee_membership_id, assignee_team_id, role, assigned_at, assigned_by_membership_id, unassigned_at";

export interface UpdateRow { id: string; task_id: string; author_membership_id: string; update_type: string; from_status: string | null; to_status: string | null; progress_pct: number | null; minutes_logged: number | null; body: string | null; created_at: string }
export interface CommentRow { id: string; task_id: string; author_membership_id: string; body: string; edited_at: string | null; deleted_at: string | null; created_at: string }
export interface DailyUpdateRow { id: string; membership_id: string; update_date: string; summary: string; blockers: string | null; submitted_at: string; updated_at: string }

export interface DependencyRow { task_id: string; depends_on_task_id: string; created_at: string }
export interface TaskFilter { status?: string[]; priority?: string; dueFrom?: string; dueTo?: string; includeArchived?: boolean }

/** Tasks and everything attached to them, for ONE organization (the tenant handle supplies the organization id). */
export class TasksRepository {
  constructor(private readonly tdb: TenantDb) {}

  // ----- tasks -----

  list(f: TaskFilter = {}): TaskRow[] {
    const extra: string[] = [];
    const p: Record<string, string> = {};
    if (!f.includeArchived) extra.push(" AND archived_at IS NULL");
    if (f.priority) { extra.push(" AND priority = @priority"); p.priority = f.priority; }
    if (f.dueFrom) { extra.push(" AND due_at >= @dueFrom"); p.dueFrom = f.dueFrom; }
    if (f.dueTo) { extra.push(" AND due_at <= @dueTo"); p.dueTo = f.dueTo; }
    if (f.status?.length) {
      f.status.forEach((s, i) => { p[`s${i}`] = s; });
      extra.push(` AND status IN (${f.status.map((_, i) => `@s${i}`).join(", ")})`);
    }
    return this.tdb.all<TaskRow>(`SELECT ${TASK_COLS} FROM tasks WHERE organization_id = @organization_id${extra.join("")} ORDER BY COALESCE(due_at, '9999-12-31'), created_at DESC, id`, p);
  }
  find(id: string): TaskRow | undefined {
    return this.tdb.get<TaskRow>(`SELECT ${TASK_COLS} FROM tasks WHERE organization_id = @organization_id AND id = @id`, { id });
  }
  insert(t: { id: string; title: string; description: string; priority: string; importanceWeight: number; startDate: string | null; dueAt: string | null; estimatedMinutes: number | null; teamId: string | null; parentTaskId: string | null; createdBy: string; now: string }): void {
    this.tdb.run(
      "INSERT INTO tasks (id, organization_id, title, description, priority, importance_weight, start_date, due_at, estimated_minutes, team_id, parent_task_id, created_by_membership_id, created_at, updated_at) VALUES (@id, @organization_id, @title, @description, @priority, @importanceWeight, @startDate, @dueAt, @estimatedMinutes, @teamId, @parentTaskId, @createdBy, @now, @now)",
      t,
    );
  }
  updateFields(t: { id: string; title: string; description: string; priority: string; importanceWeight: number; startDate: string | null; dueAt: string | null; estimatedMinutes: number | null; teamId: string | null; now: string }): void {
    this.tdb.run(
      "UPDATE tasks SET title = @title, description = @description, priority = @priority, importance_weight = @importanceWeight, start_date = @startDate, due_at = @dueAt, estimated_minutes = @estimatedMinutes, team_id = @teamId, updated_at = @now WHERE organization_id = @organization_id AND id = @id",
      t,
    );
  }
  setStatus(t: { id: string; status: string; progressPct: number; completedAt: string | null; blockedReason: string | null; now: string }): void {
    this.tdb.run(
      "UPDATE tasks SET status = @status, progress_pct = @progressPct, completed_at = @completedAt, blocked_reason = @blockedReason, updated_at = @now WHERE organization_id = @organization_id AND id = @id",
      t,
    );
  }
  setProgress(id: string, progressPct: number, now: string): void {
    this.tdb.run("UPDATE tasks SET progress_pct = @progressPct, updated_at = @now WHERE organization_id = @organization_id AND id = @id", { id, progressPct, now });
  }
  setBlockedReason(id: string, reason: string | null, now: string): void {
    this.tdb.run("UPDATE tasks SET blocked_reason = @reason, updated_at = @now WHERE organization_id = @organization_id AND id = @id", { id, reason, now });
  }
  addMinutes(id: string, minutes: number, now: string): void {
    this.tdb.run("UPDATE tasks SET actual_minutes = actual_minutes + @minutes, updated_at = @now WHERE organization_id = @organization_id AND id = @id", { id, minutes, now });
  }
  /** Open tasks (not finished, not cancelled, not archived) due on or before a day: the reminder job reads these. */
  setLinks(id: string, objectiveId: string | null, keyResultId: string | null, now: string): void {
    this.tdb.run("UPDATE tasks SET objective_id = @objectiveId, key_result_id = @keyResultId, updated_at = @now WHERE organization_id = @organization_id AND id = @id", { id, objectiveId, keyResultId, now });
  }
  setOutcome(id: string, summary: string, value: number | null, now: string): void {
    // a new outcome clears an earlier review: the reviewer rates what is recorded now
    this.tdb.run("UPDATE tasks SET outcome_summary = @summary, outcome_value = @value, outcome_quality = NULL, outcome_reviewed_at = NULL, outcome_reviewed_by = NULL, updated_at = @now WHERE organization_id = @organization_id AND id = @id", { id, summary, value, now });
  }
  setReview(id: string, quality: number, by: string, now: string): void {
    this.tdb.run("UPDATE tasks SET outcome_quality = @quality, outcome_reviewed_at = @now, outcome_reviewed_by = @by, updated_at = @now WHERE organization_id = @organization_id AND id = @id", { id, quality, by, now });
  }

  // ----- dependencies -----

  dependencies(): DependencyRow[] {
    return this.tdb.all<DependencyRow>("SELECT task_id, depends_on_task_id, created_at FROM task_dependencies WHERE organization_id = @organization_id ORDER BY created_at, rowid");
  }
  insertDependency(taskId: string, dependsOnId: string, by: string, now: string): void {
    this.tdb.run("INSERT INTO task_dependencies (organization_id, task_id, depends_on_task_id, created_by_membership_id, created_at) VALUES (@organization_id, @taskId, @dependsOnId, @by, @now)", { taskId, dependsOnId, by, now });
  }
  deleteDependency(taskId: string, dependsOnId: string): number {
    return this.tdb.run("DELETE FROM task_dependencies WHERE organization_id = @organization_id AND task_id = @taskId AND depends_on_task_id = @dependsOnId", { taskId, dependsOnId }).changes;
  }

  openDueBy(day: string): TaskRow[] {
    return this.tdb.all<TaskRow>(`SELECT ${TASK_COLS} FROM tasks WHERE organization_id = @organization_id AND archived_at IS NULL AND status NOT IN ('completed', 'cancelled') AND due_at IS NOT NULL AND due_at <= @day ORDER BY due_at, id`, { day });
  }

  // ----- assignments -----

  activeAssignments(): AssignmentRow[] {
    return this.tdb.all<AssignmentRow>(`SELECT ${ASSIGN_COLS} FROM task_assignments WHERE organization_id = @organization_id AND unassigned_at IS NULL ORDER BY assigned_at, rowid`);
  }
  assignmentsOfTask(taskId: string): AssignmentRow[] {
    return this.tdb.all<AssignmentRow>(`SELECT ${ASSIGN_COLS} FROM task_assignments WHERE organization_id = @organization_id AND task_id = @taskId ORDER BY assigned_at, rowid`, { taskId });
  }
  assignment(id: string): AssignmentRow | undefined {
    return this.tdb.get<AssignmentRow>(`SELECT ${ASSIGN_COLS} FROM task_assignments WHERE organization_id = @organization_id AND id = @id`, { id });
  }
  insertAssignment(a: { id: string; taskId: string; membershipId: string | null; teamId: string | null; role: string; by: string; now: string }): void {
    this.tdb.run(
      "INSERT INTO task_assignments (id, organization_id, task_id, assignee_membership_id, assignee_team_id, role, assigned_at, assigned_by_membership_id) VALUES (@id, @organization_id, @taskId, @membershipId, @teamId, @role, @now, @by)",
      a,
    );
  }
  endAssignment(id: string, now: string): void {
    this.tdb.run("UPDATE task_assignments SET unassigned_at = @now WHERE organization_id = @organization_id AND id = @id AND unassigned_at IS NULL", { id, now });
  }

  // ----- updates (append only) -----

  updates(taskId: string): UpdateRow[] {
    return this.tdb.all<UpdateRow>("SELECT id, task_id, author_membership_id, update_type, from_status, to_status, progress_pct, minutes_logged, body, created_at FROM task_updates WHERE organization_id = @organization_id AND task_id = @taskId ORDER BY created_at, rowid", { taskId });
  }
  insertUpdate(u: { id: string; taskId: string; author: string; type: string; fromStatus: string | null; toStatus: string | null; progressPct: number | null; minutes: number | null; body: string | null; now: string }): void {
    this.tdb.run(
      "INSERT INTO task_updates (id, organization_id, task_id, author_membership_id, update_type, from_status, to_status, progress_pct, minutes_logged, body, created_at) VALUES (@id, @organization_id, @taskId, @author, @type, @fromStatus, @toStatus, @progressPct, @minutes, @body, @now)",
      u,
    );
  }
  /** Tasks finished since a day (a person's recent achievements). */
  completedUpdatesSince(day: string): { task_id: string; created_at: string }[] {
    return this.tdb.all<{ task_id: string; created_at: string }>("SELECT task_id, created_at FROM task_updates WHERE organization_id = @organization_id AND to_status = 'completed' AND created_at >= @day ORDER BY created_at DESC", { day });
  }

  // ----- comments -----

  comments(taskId: string): CommentRow[] {
    return this.tdb.all<CommentRow>("SELECT id, task_id, author_membership_id, body, edited_at, deleted_at, created_at FROM task_comments WHERE organization_id = @organization_id AND task_id = @taskId AND deleted_at IS NULL ORDER BY created_at, rowid", { taskId });
  }
  comment(id: string): CommentRow | undefined {
    return this.tdb.get<CommentRow>("SELECT id, task_id, author_membership_id, body, edited_at, deleted_at, created_at FROM task_comments WHERE organization_id = @organization_id AND id = @id", { id });
  }
  insertComment(c: { id: string; taskId: string; author: string; body: string; now: string }): void {
    this.tdb.run("INSERT INTO task_comments (id, organization_id, task_id, author_membership_id, body, created_at) VALUES (@id, @organization_id, @taskId, @author, @body, @now)", c);
  }
  editComment(id: string, body: string, now: string): void {
    this.tdb.run("UPDATE task_comments SET body = @body, edited_at = @now WHERE organization_id = @organization_id AND id = @id AND deleted_at IS NULL", { id, body, now });
  }
  deleteComment(id: string, now: string): void {
    this.tdb.run("UPDATE task_comments SET deleted_at = @now WHERE organization_id = @organization_id AND id = @id AND deleted_at IS NULL", { id, now });
  }

  // ----- daily updates -----

  dailyUpdates(membershipId: string, firstDay: string, lastDay: string): DailyUpdateRow[] {
    return this.tdb.all<DailyUpdateRow>("SELECT id, membership_id, update_date, summary, blockers, submitted_at, updated_at FROM daily_updates WHERE organization_id = @organization_id AND membership_id = @membershipId AND update_date >= @firstDay AND update_date <= @lastDay ORDER BY update_date DESC", { membershipId, firstDay, lastDay });
  }
  dailyUpdate(membershipId: string, day: string): DailyUpdateRow | undefined {
    return this.dailyUpdates(membershipId, day, day)[0];
  }
  insertDailyUpdate(d: { id: string; membershipId: string; day: string; summary: string; blockers: string | null; now: string }): void {
    this.tdb.run(
      "INSERT INTO daily_updates (id, organization_id, membership_id, update_date, summary, blockers, submitted_at, updated_at) VALUES (@id, @organization_id, @membershipId, @day, @summary, @blockers, @now, @now)",
      d,
    );
  }
  updateDailyUpdate(id: string, summary: string, blockers: string | null, now: string): void {
    this.tdb.run("UPDATE daily_updates SET summary = @summary, blockers = @blockers, updated_at = @now WHERE organization_id = @organization_id AND id = @id", { id, summary, blockers, now });
  }
}
