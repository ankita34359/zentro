import type { TenantDb } from "../../../db/tenant.js";

export interface ObjectiveRow {
  id: string;
  level: string;
  department_id: string | null;
  team_id: string | null;
  owner_membership_id: string | null;
  title: string;
  description: string;
  objective_type: string;
  start_date: string;
  end_date: string;
  priority: string;
  lifecycle: string;
  visibility: string;
  published_at: string | null;
  weight: number;
  created_by_membership_id: string;
  archived_at: string | null;
  is_demo: number;
  created_at: string;
  updated_at: string;
  health: string | null;
  health_reason: string | null;
  health_computed_at: string | null;
}
const OBJ_COLS = "id, level, department_id, team_id, owner_membership_id, title, description, objective_type, start_date, end_date, priority, lifecycle, visibility, published_at, weight, created_by_membership_id, archived_at, is_demo, created_at, updated_at, health, health_reason, health_computed_at";

export interface KeyResultRow {
  id: string;
  objective_id: string;
  title: string;
  description: string;
  measurement_type: string;
  unit: string | null;
  direction: string;
  progress_method: string;
  start_value: number;
  target_value: number;
  current_value: number | null;
  current_as_of: string | null;
  weight: number;
  owner_membership_id: string | null;
  due_date: string | null;
  archived_at: string | null;
  is_demo: number;
  created_at: string;
}
const KR_COLS = "id, objective_id, title, description, measurement_type, unit, direction, progress_method, start_value, target_value, current_value, current_as_of, weight, owner_membership_id, due_date, archived_at, is_demo, created_at";

export interface RelationshipRow { id: string; parent_objective_id: string; child_objective_id: string; relationship_type: string; contribution_weight: number; created_by_membership_id: string; created_at: string; ended_at: string | null }
const REL_COLS = "id, parent_objective_id, child_objective_id, relationship_type, contribution_weight, created_by_membership_id, created_at, ended_at";
export interface AssignmentRow { id: string; objective_id: string; assignee_membership_id: string | null; assignee_team_id: string | null; assignee_department_id: string | null; role: string; start_date: string; end_date: string | null; assigned_by_membership_id: string; created_at: string }
const ASG_COLS = "id, objective_id, assignee_membership_id, assignee_team_id, assignee_department_id, role, start_date, end_date, assigned_by_membership_id, created_at";

export interface HistoryRow { id: string; objective_id: string; key_result_id: string | null; recorded_at: string; value: number | null; attainment: number | null; source: string; note: string | null; recorded_by_membership_id: string | null; supersedes_id: string | null }
const HIST_COLS = "id, objective_id, key_result_id, recorded_at, value, attainment, source, note, recorded_by_membership_id, supersedes_id";

/** Objectives, key results and their progress history for ONE organization (the tenant handle supplies the organization id). */
export class OkrRepository {
  constructor(private readonly tdb: TenantDb) {}

  // ----- objectives -----

  objectives(includeArchived = false): ObjectiveRow[] {
    return this.tdb.all<ObjectiveRow>(`SELECT ${OBJ_COLS} FROM objectives WHERE organization_id = @organization_id AND (@all = 1 OR archived_at IS NULL) ORDER BY end_date, title COLLATE NOCASE, id`, { all: includeArchived ? 1 : 0 });
  }
  objective(id: string): ObjectiveRow | undefined {
    return this.tdb.get<ObjectiveRow>(`SELECT ${OBJ_COLS} FROM objectives WHERE organization_id = @organization_id AND id = @id`, { id });
  }
  insertObjective(o: { id: string; level: string; departmentId: string | null; teamId: string | null; ownerId: string | null; title: string; description: string; objectiveType: string; startDate: string; endDate: string; priority: string; lifecycle: string; weight: number; createdBy: string; now: string }): void {
    this.tdb.run(
      "INSERT INTO objectives (id, organization_id, level, department_id, team_id, owner_membership_id, title, description, objective_type, start_date, end_date, priority, lifecycle, weight, created_by_membership_id, created_at, updated_at) VALUES (@id, @organization_id, @level, @departmentId, @teamId, @ownerId, @title, @description, @objectiveType, @startDate, @endDate, @priority, @lifecycle, @weight, @createdBy, @now, @now)",
      o,
    );
  }
  updateObjective(o: { id: string; title: string; description: string; objectiveType: string; startDate: string; endDate: string; priority: string; weight: number; ownerId: string | null; now: string }): void {
    this.tdb.run("UPDATE objectives SET title = @title, description = @description, objective_type = @objectiveType, start_date = @startDate, end_date = @endDate, priority = @priority, weight = @weight, owner_membership_id = @ownerId, updated_at = @now WHERE organization_id = @organization_id AND id = @id", o);
  }
  setLifecycle(id: string, lifecycle: string, now: string): void {
    this.tdb.run("UPDATE objectives SET lifecycle = @lifecycle, updated_at = @now WHERE organization_id = @organization_id AND id = @id", { id, lifecycle, now });
  }
  setVisibility(id: string, visibility: string, publishedAt: string | null, now: string): void {
    this.tdb.run("UPDATE objectives SET visibility = @visibility, published_at = @publishedAt, updated_at = @now WHERE organization_id = @organization_id AND id = @id", { id, visibility, publishedAt, now });
  }
  setHealth(id: string, health: string | null, reason: string, now: string): void {
    this.tdb.run("UPDATE objectives SET health = @health, health_reason = @reason, health_computed_at = @now WHERE organization_id = @organization_id AND id = @id", { id, health, reason, now });
  }
  setArchived(id: string, at: string | null, now: string): void {
    this.tdb.run("UPDATE objectives SET archived_at = @at, updated_at = @now WHERE organization_id = @organization_id AND id = @id", { id, at, now });
  }

  // ----- key results -----

  keyResults(includeArchived = false): KeyResultRow[] {
    return this.tdb.all<KeyResultRow>(`SELECT ${KR_COLS} FROM key_results WHERE organization_id = @organization_id AND (@all = 1 OR archived_at IS NULL) ORDER BY created_at, rowid`, { all: includeArchived ? 1 : 0 });
  }
  keyResult(id: string): KeyResultRow | undefined {
    return this.tdb.get<KeyResultRow>(`SELECT ${KR_COLS} FROM key_results WHERE organization_id = @organization_id AND id = @id`, { id });
  }
  insertKeyResult(k: { id: string; objectiveId: string; title: string; description: string; measurementType: string; unit: string | null; direction: string; method: string; start: number; target: number; weight: number; ownerId: string | null; dueDate: string | null; now: string }): void {
    this.tdb.run(
      "INSERT INTO key_results (id, organization_id, objective_id, title, description, measurement_type, unit, direction, progress_method, start_value, target_value, weight, owner_membership_id, due_date, created_at, updated_at) VALUES (@id, @organization_id, @objectiveId, @title, @description, @measurementType, @unit, @direction, @method, @start, @target, @weight, @ownerId, @dueDate, @now, @now)",
      k,
    );
  }
  updateKeyResult(k: { id: string; title: string; description: string; unit: string | null; start: number; target: number; weight: number; ownerId: string | null; dueDate: string | null; now: string }): void {
    this.tdb.run("UPDATE key_results SET title = @title, description = @description, unit = @unit, start_value = @start, target_value = @target, weight = @weight, owner_membership_id = @ownerId, due_date = @dueDate, updated_at = @now WHERE organization_id = @organization_id AND id = @id", k);
  }
  setCurrent(id: string, value: number | null, asOf: string | null, now: string): void {
    this.tdb.run("UPDATE key_results SET current_value = @value, current_as_of = @asOf, updated_at = @now WHERE organization_id = @organization_id AND id = @id", { id, value, asOf, now });
  }
  archiveKeyResult(id: string, at: string, now: string): void {
    this.tdb.run("UPDATE key_results SET archived_at = @at, updated_at = @now WHERE organization_id = @organization_id AND id = @id", { id, at, now });
  }

  // ----- history (append only) -----

  history(objectiveId: string): HistoryRow[] {
    return this.tdb.all<HistoryRow>(`SELECT ${HIST_COLS} FROM objective_progress_history WHERE organization_id = @organization_id AND objective_id = @objectiveId ORDER BY recorded_at, rowid`, { objectiveId });
  }
  /** Every recorded value of every key result, oldest first (scoring reads the value AS OF a day). */
  allHistory(): HistoryRow[] {
    return this.tdb.all<HistoryRow>(`SELECT ${HIST_COLS} FROM objective_progress_history WHERE organization_id = @organization_id AND key_result_id IS NOT NULL ORDER BY recorded_at, rowid`);
  }
  latestFor(keyResultId: string): HistoryRow | undefined {
    return this.tdb.get<HistoryRow>(`SELECT ${HIST_COLS} FROM objective_progress_history WHERE organization_id = @organization_id AND key_result_id = @keyResultId AND source <> 'target_change' ORDER BY recorded_at DESC, rowid DESC LIMIT 1`, { keyResultId });
  }
  insertHistory(h: { id: string; objectiveId: string; keyResultId: string | null; value: number | null; attainment: number | null; source: string; note: string | null; by: string | null; supersedesId: string | null; now: string }): void {
    this.tdb.run(
      "INSERT INTO objective_progress_history (id, organization_id, objective_id, key_result_id, recorded_at, value, attainment, source, note, recorded_by_membership_id, supersedes_id) VALUES (@id, @organization_id, @objectiveId, @keyResultId, @now, @value, @attainment, @source, @note, @by, @supersedesId)",
      h,
    );
  }

  // ----- links from tasks -----

  taskCounts(objectiveId: string): { total: number; open: number } {
    return (
      this.tdb.get<{ total: number; open: number }>(
        "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status NOT IN ('completed', 'cancelled') THEN 1 ELSE 0 END), 0) AS open FROM tasks WHERE organization_id = @organization_id AND objective_id = @objectiveId AND archived_at IS NULL",
        { objectiveId },
      ) ?? { total: 0, open: 0 }
    );
  }
  openTaskCount(objectiveId: string): number {
    return this.taskCounts(objectiveId).open;
  }

  // ----- alignment: who contributes to whom -----

  relationships(includeEnded = false): RelationshipRow[] {
    return this.tdb.all<RelationshipRow>(`SELECT ${REL_COLS} FROM objective_relationships WHERE organization_id = @organization_id AND (@all = 1 OR ended_at IS NULL) ORDER BY created_at, rowid`, { all: includeEnded ? 1 : 0 });
  }
  relationship(id: string): RelationshipRow | undefined {
    return this.tdb.get<RelationshipRow>(`SELECT ${REL_COLS} FROM objective_relationships WHERE organization_id = @organization_id AND id = @id`, { id });
  }
  insertRelationship(r: { id: string; parentId: string; childId: string; weight: number; by: string; now: string }): void {
    this.tdb.run("INSERT INTO objective_relationships (id, organization_id, parent_objective_id, child_objective_id, relationship_type, contribution_weight, created_by_membership_id, created_at) VALUES (@id, @organization_id, @parentId, @childId, 'contributes_to', @weight, @by, @now)", r);
  }
  setRelationshipWeight(id: string, weight: number): void {
    this.tdb.run("UPDATE objective_relationships SET contribution_weight = @weight WHERE organization_id = @organization_id AND id = @id AND ended_at IS NULL", { id, weight });
  }
  endRelationship(id: string, now: string): void {
    this.tdb.run("UPDATE objective_relationships SET ended_at = @now WHERE organization_id = @organization_id AND id = @id AND ended_at IS NULL", { id, now });
  }

  // ----- assignments -----

  assignments(includeEnded = false): AssignmentRow[] {
    return this.tdb.all<AssignmentRow>(`SELECT ${ASG_COLS} FROM objective_assignments WHERE organization_id = @organization_id AND (@all = 1 OR end_date IS NULL) ORDER BY created_at, rowid`, { all: includeEnded ? 1 : 0 });
  }
  assignment(id: string): AssignmentRow | undefined {
    return this.tdb.get<AssignmentRow>(`SELECT ${ASG_COLS} FROM objective_assignments WHERE organization_id = @organization_id AND id = @id`, { id });
  }
  insertAssignment(a: { id: string; objectiveId: string; membershipId: string | null; teamId: string | null; departmentId: string | null; role: string; startDate: string; by: string; now: string }): void {
    this.tdb.run("INSERT INTO objective_assignments (id, organization_id, objective_id, assignee_membership_id, assignee_team_id, assignee_department_id, role, start_date, assigned_by_membership_id, created_at) VALUES (@id, @organization_id, @objectiveId, @membershipId, @teamId, @departmentId, @role, @startDate, @by, @now)", a);
  }
  endAssignment(id: string, day: string): void {
    this.tdb.run("UPDATE objective_assignments SET end_date = @day WHERE organization_id = @organization_id AND id = @id AND end_date IS NULL", { id, day });
  }
}
