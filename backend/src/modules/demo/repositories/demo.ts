import type { TenantDb } from "../../../db/tenant.js";

export interface BatchRow { id: string; status: string; counts_json: string; created_at: string; removed_at: string | null }
export interface PersonaRow { id: string; display_name: string; designation: string | null; department: string | null; role_names: string | null; user_id: string; manager_id: string | null; direct_reports: number }

/** The subquery that names every demo person of the organization. */
const DEMO_PEOPLE = "(SELECT om.id FROM organization_memberships om WHERE om.organization_id = @organization_id AND om.is_demo = 1)";
const DEMO_TASKS = "(SELECT dt.id FROM tasks dt WHERE dt.organization_id = @organization_id AND dt.is_demo = 1)";

/**
 * Demo rows for ONE organization: every insert sets `is_demo = 1`, and every delete reaches only rows that are demo rows or
 * hang off demo rows. Real rows are never touched (a real row that points at a demo row stops the removal: see `blockers`).
 */
export class DemoRepository {
  constructor(private readonly tdb: TenantDb) {}

  // ----- batches -----

  loadedBatch(): BatchRow | undefined {
    return this.tdb.get<BatchRow>("SELECT id, status, counts_json, created_at, removed_at FROM demo_data_batches WHERE organization_id = @organization_id AND status = 'loaded'");
  }
  lastBatch(): BatchRow | undefined {
    return this.tdb.get<BatchRow>("SELECT id, status, counts_json, created_at, removed_at FROM demo_data_batches WHERE organization_id = @organization_id ORDER BY created_at DESC, rowid DESC LIMIT 1");
  }
  insertBatch(b: { id: string; createdBy: string; countsJson: string; now: string }): void {
    this.tdb.run("INSERT INTO demo_data_batches (id, organization_id, created_by_membership_id, status, counts_json, created_at) VALUES (@id, @organization_id, @createdBy, 'loaded', @countsJson, @now)", b);
  }
  markRemoved(id: string, by: string, now: string): void {
    this.tdb.run("UPDATE demo_data_batches SET status = 'removed', removed_at = @now, removed_by_membership_id = @by WHERE organization_id = @organization_id AND id = @id", { id, by, now });
  }

  // ----- roles by template key (the seed names a few) -----

  roleId(key: string): string | undefined {
    return this.tdb.get<{ id: string }>("SELECT id FROM roles WHERE organization_id = @organization_id AND key = @key AND archived_at IS NULL", { key })?.id;
  }

  // ----- inserts (all flagged) -----

  insertRoleFamily(r: { id: string; name: string; now: string }): void {
    this.tdb.run("INSERT INTO role_families (id, organization_id, name, description, is_demo, created_at, updated_at) VALUES (@id, @organization_id, @name, '', 1, @now, @now)", r);
  }
  insertDesignation(r: { id: string; familyId: string; name: string; now: string }): void {
    this.tdb.run("INSERT INTO designations (id, organization_id, role_family_id, name, description, is_demo, created_at, updated_at) VALUES (@id, @organization_id, @familyId, @name, '', 1, @now, @now)", r);
  }
  insertDepartment(r: { id: string; name: string; description: string; now: string }): void {
    this.tdb.run("INSERT INTO departments (id, organization_id, parent_id, name, description, is_demo, created_at, updated_at) VALUES (@id, @organization_id, NULL, @name, @description, 1, @now, @now)", r);
  }
  insertTeam(r: { id: string; departmentId: string; parentTeamId: string | null; name: string; now: string }): void {
    this.tdb.run("INSERT INTO teams (id, organization_id, department_id, parent_team_id, name, description, is_demo, created_at, updated_at) VALUES (@id, @organization_id, @departmentId, @parentTeamId, @name, '', 1, @now, @now)", r);
  }
  insertPerson(r: { id: string; userId: string; name: string; designationId: string; employeeCode: string; employmentType: string; startDate: string; now: string }): void {
    this.tdb.run(
      "INSERT INTO organization_memberships (id, organization_id, user_id, display_name, work_email, status, designation_id, employee_code, employment_type, start_date, is_demo, created_at, updated_at) VALUES (@id, @organization_id, @userId, @name, NULL, 'active', @designationId, @employeeCode, @employmentType, @startDate, 1, @now, @now)",
      r,
    );
  }
  insertDesignationAssignment(r: { id: string; membershipId: string; designationId: string; startDate: string; createdBy: string; now: string }): void {
    this.tdb.run("INSERT INTO designation_assignments (id, organization_id, membership_id, designation_id, start_date, reason, created_by_membership_id, created_at) VALUES (@id, @organization_id, @membershipId, @designationId, @startDate, 'Demo data', @createdBy, @now)", r);
  }
  insertDeptMembership(r: { id: string; departmentId: string; membershipId: string; type: string; startDate: string; createdBy: string; now: string }): void {
    this.tdb.run("INSERT INTO department_memberships (id, organization_id, department_id, membership_id, membership_type, start_date, created_by_membership_id, created_at) VALUES (@id, @organization_id, @departmentId, @membershipId, @type, @startDate, @createdBy, @now)", r);
  }
  insertTeamMembership(r: { id: string; teamId: string; membershipId: string; type: string; startDate: string; createdBy: string; now: string }): void {
    this.tdb.run("INSERT INTO team_memberships (id, organization_id, team_id, membership_id, membership_type, allocation_pct, start_date, created_by_membership_id, created_at) VALUES (@id, @organization_id, @teamId, @membershipId, @type, 100, @startDate, @createdBy, @now)", r);
  }
  insertReporting(r: { id: string; subordinateId: string; managerId: string; startDate: string; createdBy: string; now: string }): void {
    this.tdb.run("INSERT INTO reporting_relationships (id, organization_id, subordinate_membership_id, manager_membership_id, relationship_type, start_date, reason, created_by_membership_id, created_at) VALUES (@id, @organization_id, @subordinateId, @managerId, 'primary', @startDate, 'Demo data', @createdBy, @now)", r);
  }
  insertRoleAssignment(r: { id: string; membershipId: string; roleId: string; scopeType: string; scopeId: string | null; validFrom: string; grantedBy: string; now: string }): void {
    this.tdb.run("INSERT INTO user_role_assignments (id, organization_id, membership_id, role_id, scope_type, scope_id, valid_from, granted_by_membership_id, created_at) VALUES (@id, @organization_id, @membershipId, @roleId, @scopeType, @scopeId, @validFrom, @grantedBy, @now)", r);
  }
  insertTask(r: { id: string; title: string; description: string; status: string; priority: string; importance: number; progressPct: number; dueAt: string | null; startDate: string | null; estimated: number | null; actual: number; completedAt: string | null; blockedReason: string | null; teamId: string | null; createdBy: string; createdAt: string; updatedAt: string; objectiveId?: string | null; keyResultId?: string | null; outcomeSummary?: string | null; outcomeQuality?: number | null; outcomeReviewedBy?: string | null }): void {
    this.tdb.run(
      "INSERT INTO tasks (id, organization_id, title, description, status, priority, importance_weight, progress_pct, start_date, due_at, estimated_minutes, actual_minutes, completed_at, blocked_reason, team_id, created_by_membership_id, is_demo, created_at, updated_at, objective_id, key_result_id, outcome_summary, outcome_quality, outcome_reviewed_at, outcome_reviewed_by) VALUES (@id, @organization_id, @title, @description, @status, @priority, @importance, @progressPct, @startDate, @dueAt, @estimated, @actual, @completedAt, @blockedReason, @teamId, @createdBy, 1, @createdAt, @updatedAt, @objectiveId, @keyResultId, @outcomeSummary, @outcomeQuality, CASE WHEN @outcomeReviewedBy IS NULL THEN NULL ELSE @updatedAt END, @outcomeReviewedBy)",
      { objectiveId: null, keyResultId: null, outcomeSummary: null, outcomeQuality: null, outcomeReviewedBy: null, ...r },
    );
  }
  insertDependency(r: { taskId: string; dependsOnId: string; by: string; now: string }): void {
    this.tdb.run("INSERT INTO task_dependencies (organization_id, task_id, depends_on_task_id, created_by_membership_id, created_at) VALUES (@organization_id, @taskId, @dependsOnId, @by, @now)", r);
  }
  insertObjective(r: { id: string; level: string; departmentId: string | null; teamId: string | null; ownerId: string; title: string; description: string; objectiveType: string; startDate: string; endDate: string; priority: string; lifecycle: string; visibility: string; publishedAt: string | null; createdBy: string; now: string }): void {
    this.tdb.run(
      "INSERT INTO objectives (id, organization_id, level, department_id, team_id, owner_membership_id, title, description, objective_type, start_date, end_date, priority, lifecycle, visibility, published_at, weight, created_by_membership_id, is_demo, created_at, updated_at) VALUES (@id, @organization_id, @level, @departmentId, @teamId, @ownerId, @title, @description, @objectiveType, @startDate, @endDate, @priority, @lifecycle, @visibility, @publishedAt, 1, @createdBy, 1, @now, @now)",
      r,
    );
  }
  insertRelationship(r: { id: string; parentId: string; childId: string; weight: number; by: string; now: string }): void {
    this.tdb.run("INSERT INTO objective_relationships (id, organization_id, parent_objective_id, child_objective_id, relationship_type, contribution_weight, created_by_membership_id, created_at) VALUES (@id, @organization_id, @parentId, @childId, 'contributes_to', @weight, @by, @now)", r);
  }
  insertObjectiveAssignment(r: { id: string; objectiveId: string; teamId: string | null; departmentId: string | null; role: string; startDate: string; by: string; now: string }): void {
    this.tdb.run("INSERT INTO objective_assignments (id, organization_id, objective_id, assignee_team_id, assignee_department_id, role, start_date, assigned_by_membership_id, created_at) VALUES (@id, @organization_id, @objectiveId, @teamId, @departmentId, @role, @startDate, @by, @now)", r);
  }
  insertKeyResult(r: { id: string; objectiveId: string; title: string; unit: string | null; direction: string; method: string; start: number; target: number; current: number | null; currentAsOf: string | null; weight: number; ownerId: string; now: string }): void {
    this.tdb.run(
      "INSERT INTO key_results (id, organization_id, objective_id, title, description, measurement_type, unit, direction, progress_method, start_value, target_value, current_value, current_as_of, weight, owner_membership_id, is_demo, created_at, updated_at) VALUES (@id, @organization_id, @objectiveId, @title, '', 'number', @unit, @direction, @method, @start, @target, @current, @currentAsOf, @weight, @ownerId, 1, @now, @now)",
      r,
    );
  }
  insertHistory(r: { id: string; objectiveId: string; keyResultId: string; value: number; attainment: number | null; note: string | null; by: string; supersedesId: string | null; at: string }): void {
    this.tdb.run(
      "INSERT INTO objective_progress_history (id, organization_id, objective_id, key_result_id, recorded_at, value, attainment, source, note, recorded_by_membership_id, supersedes_id) VALUES (@id, @organization_id, @objectiveId, @keyResultId, @at, @value, @attainment, 'demo', @note, @by, @supersedesId)",
      r,
    );
  }
  insertTaskAssignment(r: { id: string; taskId: string; membershipId: string; by: string; now: string }): void {
    this.tdb.run("INSERT INTO task_assignments (id, organization_id, task_id, assignee_membership_id, role, assigned_at, assigned_by_membership_id) VALUES (@id, @organization_id, @taskId, @membershipId, 'assignee', @now, @by)", r);
  }
  insertTaskUpdate(r: { id: string; taskId: string; author: string; type: string; fromStatus: string | null; toStatus: string | null; progressPct: number | null; minutes: number | null; body: string | null; now: string }): void {
    this.tdb.run("INSERT INTO task_updates (id, organization_id, task_id, author_membership_id, update_type, from_status, to_status, progress_pct, minutes_logged, body, created_at) VALUES (@id, @organization_id, @taskId, @author, @type, @fromStatus, @toStatus, @progressPct, @minutes, @body, @now)", r);
  }
  insertTaskComment(r: { id: string; taskId: string; author: string; body: string; now: string }): void {
    this.tdb.run("INSERT INTO task_comments (id, organization_id, task_id, author_membership_id, body, created_at) VALUES (@id, @organization_id, @taskId, @author, @body, @now)", r);
  }
  insertDailyUpdate(r: { id: string; membershipId: string; day: string; summary: string; blockers: string | null; now: string }): void {
    this.tdb.run("INSERT INTO daily_updates (id, organization_id, membership_id, update_date, summary, blockers, submitted_at, updated_at) VALUES (@id, @organization_id, @membershipId, @day, @summary, @blockers, @now, @now)", r);
  }
  insertNotification(r: { id: string; recipientId: string; type: string; title: string; body: string | null; severity: string; taskId: string; dedupeKey: string; now: string }): void {
    this.tdb.run("INSERT OR IGNORE INTO notifications (id, organization_id, recipient_membership_id, type, title, body, severity, entity_type, entity_id, dedupe_key, created_at) VALUES (@id, @organization_id, @recipientId, @type, @title, @body, @severity, 'task', @taskId, @dedupeKey, @now)", r);
  }

  // ----- what is demo, and what stops its removal -----

  demoUserIds(): string[] {
    return this.tdb.all<{ user_id: string }>("SELECT user_id FROM organization_memberships WHERE organization_id = @organization_id AND is_demo = 1 AND user_id IS NOT NULL").map((r) => r.user_id);
  }

  /** Real rows that point at demo rows. Each has a plain message; removal is refused while any exist. */
  blockers(): { kind: string; count: number; message: string }[] {
    const n = (sql: string): number => this.tdb.get<{ n: number }>(sql)?.n ?? 0;
    const found: { kind: string; count: number; message: string }[] = [];
    const add = (kind: string, count: number, message: (c: number) => string) => {
      if (count > 0) found.push({ kind, count, message: message(count) });
    };
    add("tasks", n(`SELECT COUNT(DISTINCT t.id) AS n FROM tasks t LEFT JOIN task_assignments a ON a.task_id = t.id AND a.organization_id = @organization_id AND a.unassigned_at IS NULL WHERE t.organization_id = @organization_id AND t.is_demo = 0 AND (t.created_by_membership_id IN ${DEMO_PEOPLE} OR a.assignee_membership_id IN ${DEMO_PEOPLE} OR t.team_id IN (SELECT dm.id FROM teams dm WHERE dm.organization_id = @organization_id AND dm.is_demo = 1) OR a.assignee_team_id IN (SELECT dm2.id FROM teams dm2 WHERE dm2.organization_id = @organization_id AND dm2.is_demo = 1))`), (c) => `${c} of your own ${c === 1 ? "task is" : "tasks are"} assigned to, created by or linked to demo people or teams. Reassign or delete ${c === 1 ? "it" : "them"} first.`);
    add("reporting", n(`SELECT COUNT(*) AS n FROM reporting_relationships r WHERE r.organization_id = @organization_id AND r.end_date IS NULL AND ((r.subordinate_membership_id IN ${DEMO_PEOPLE} AND r.manager_membership_id NOT IN ${DEMO_PEOPLE}) OR (r.manager_membership_id IN ${DEMO_PEOPLE} AND r.subordinate_membership_id NOT IN ${DEMO_PEOPLE}))`), (c) => `${c} reporting ${c === 1 ? "line connects" : "lines connect"} your real people with demo people. End ${c === 1 ? "it" : "them"} first.`);
    add("teams", n(`SELECT COUNT(*) AS n FROM team_memberships m WHERE m.organization_id = @organization_id AND m.membership_id NOT IN ${DEMO_PEOPLE} AND m.end_date IS NULL AND m.team_id IN (SELECT dt.id FROM teams dt WHERE dt.organization_id = @organization_id AND dt.is_demo = 1)`), (c) => `${c} of your real people ${c === 1 ? "is" : "are"} in demo teams. Move ${c === 1 ? "them" : "them"} out first.`);
    add("departments", n(`SELECT COUNT(*) AS n FROM department_memberships m WHERE m.organization_id = @organization_id AND m.membership_id NOT IN ${DEMO_PEOPLE} AND m.end_date IS NULL AND m.department_id IN (SELECT dd.id FROM departments dd WHERE dd.organization_id = @organization_id AND dd.is_demo = 1)`), (c) => `${c} of your real people ${c === 1 ? "is" : "are"} in demo departments. Move them out first.`);
    add("roles", n(`SELECT COUNT(*) AS n FROM user_role_assignments a WHERE a.organization_id = @organization_id AND a.membership_id NOT IN ${DEMO_PEOPLE} AND a.revoked_at IS NULL AND (a.scope_id IN (SELECT sd.id FROM departments sd WHERE sd.organization_id = @organization_id AND sd.is_demo = 1) OR a.scope_id IN (SELECT st.id FROM teams st WHERE st.organization_id = @organization_id AND st.is_demo = 1))`), (c) => `${c} role ${c === 1 ? "assignment is" : "assignments are"} limited to a demo department or team. Revoke ${c === 1 ? "it" : "them"} first.`);
    add("designations", n(`SELECT COUNT(*) AS n FROM organization_memberships m WHERE m.organization_id = @organization_id AND m.is_demo = 0 AND m.designation_id IN (SELECT dd.id FROM designations dd WHERE dd.organization_id = @organization_id AND dd.is_demo = 1)`), (c) => `${c} of your real people ${c === 1 ? "holds a" : "hold"} demo designation${c === 1 ? "" : "s"}. Give ${c === 1 ? "them" : "them"} another designation first.`);
    const DEMO_OBJECTIVES = "(SELECT dob.id FROM objectives dob WHERE dob.organization_id = @organization_id AND dob.is_demo = 1)";
    add("objective_tasks", n(`SELECT COUNT(*) AS n FROM tasks lt WHERE lt.organization_id = @organization_id AND lt.is_demo = 0 AND lt.objective_id IN ${DEMO_OBJECTIVES}`), (c) => `${c} of your own ${c === 1 ? "task supports" : "tasks support"} a demo objective. Unlink ${c === 1 ? "it" : "them"} first.`);
    add("objectives", n(`SELECT COUNT(*) AS n FROM objectives ro WHERE ro.organization_id = @organization_id AND ro.is_demo = 0 AND (ro.team_id IN (SELECT dtm.id FROM teams dtm WHERE dtm.organization_id = @organization_id AND dtm.is_demo = 1) OR ro.department_id IN (SELECT ddp.id FROM departments ddp WHERE ddp.organization_id = @organization_id AND ddp.is_demo = 1) OR ro.owner_membership_id IN ${DEMO_PEOPLE})`), (c) => `${c} of your own ${c === 1 ? "objective belongs" : "objectives belong"} to a demo team, department or person. Archive or move ${c === 1 ? "it" : "them"} first.`);
    add("objective_links", n(`SELECT COUNT(*) AS n FROM objective_relationships orl WHERE orl.organization_id = @organization_id AND orl.ended_at IS NULL AND ((orl.parent_objective_id IN ${DEMO_OBJECTIVES} AND orl.child_objective_id NOT IN ${DEMO_OBJECTIVES}) OR (orl.child_objective_id IN ${DEMO_OBJECTIVES} AND orl.parent_objective_id NOT IN ${DEMO_OBJECTIVES}))`), (c) => `${c} of your own objectives ${c === 1 ? "is" : "are"} aligned with demo objectives. Take ${c === 1 ? "it" : "them"} out of the alignment first.`);
    add("objective_assignments", n(`SELECT COUNT(*) AS n FROM objective_assignments oa WHERE oa.organization_id = @organization_id AND oa.end_date IS NULL AND oa.objective_id NOT IN ${DEMO_OBJECTIVES} AND (oa.assignee_membership_id IN ${DEMO_PEOPLE} OR oa.assignee_team_id IN (SELECT dtm.id FROM teams dtm WHERE dtm.organization_id = @organization_id AND dtm.is_demo = 1) OR oa.assignee_department_id IN (SELECT ddp.id FROM departments ddp WHERE ddp.organization_id = @organization_id AND ddp.is_demo = 1))`), (c) => `${c} of your own objectives ${c === 1 ? "is" : "are"} assigned to demo people, teams or departments. End ${c === 1 ? "that assignment" : "those assignments"} first.`);
    add("kpi_assignments", n(`SELECT COUNT(*) AS n FROM kpi_assignments ka WHERE ka.organization_id = @organization_id AND ka.kpi_id NOT IN (SELECT rk.id FROM kpis rk WHERE rk.organization_id = @organization_id AND rk.is_demo = 1) AND (ka.membership_id IN ${DEMO_PEOPLE} OR ka.team_id IN (SELECT dtm.id FROM teams dtm WHERE dtm.organization_id = @organization_id AND dtm.is_demo = 1) OR ka.department_id IN (SELECT ddp.id FROM departments ddp WHERE ddp.organization_id = @organization_id AND ddp.is_demo = 1) OR ka.designation_id IN (SELECT dds.id FROM designations dds WHERE dds.organization_id = @organization_id AND dds.is_demo = 1) OR ka.role_family_id IN (SELECT drf.id FROM role_families drf WHERE drf.organization_id = @organization_id AND drf.is_demo = 1))`), (c) => `${c} of your own KPI ${c === 1 ? "assignment points" : "assignments point"} at demo people, teams, departments, designations or role families. End ${c === 1 ? "it" : "them"} first.`);
    add("dependencies", n(`SELECT COUNT(*) AS n FROM task_dependencies d WHERE d.organization_id = @organization_id AND ((d.task_id IN (SELECT rt.id FROM tasks rt WHERE rt.organization_id = @organization_id AND rt.is_demo = 0) AND d.depends_on_task_id IN ${DEMO_TASKS}) OR (d.depends_on_task_id IN (SELECT rt2.id FROM tasks rt2 WHERE rt2.organization_id = @organization_id AND rt2.is_demo = 0) AND d.task_id IN ${DEMO_TASKS}))`), (c) => `${c} of your own ${c === 1 ? "task waits" : "tasks wait"} for, or ${c === 1 ? "is" : "are"} waited for by, demo tasks. Remove the dependenc${c === 1 ? "y" : "ies"} first.`);
    return found;
  }

  counts(): Record<string, number> {
    const one = (sql: string) => this.tdb.get<{ n: number }>(sql)?.n ?? 0;
    return {
      people: one("SELECT COUNT(*) AS n FROM organization_memberships WHERE organization_id = @organization_id AND is_demo = 1"),
      departments: one("SELECT COUNT(*) AS n FROM departments WHERE organization_id = @organization_id AND is_demo = 1"),
      teams: one("SELECT COUNT(*) AS n FROM teams WHERE organization_id = @organization_id AND is_demo = 1"),
      designations: one("SELECT COUNT(*) AS n FROM designations WHERE organization_id = @organization_id AND is_demo = 1"),
      tasks: one("SELECT COUNT(*) AS n FROM tasks WHERE organization_id = @organization_id AND is_demo = 1"),
      objectives: one("SELECT COUNT(*) AS n FROM objectives WHERE organization_id = @organization_id AND is_demo = 1"),
      keyResults: one("SELECT COUNT(*) AS n FROM key_results WHERE organization_id = @organization_id AND is_demo = 1"),
    };
  }

  // ----- removal, children before parents -----

  deleteAll(): void {
    this.tdb.run(`DELETE FROM notifications WHERE notifications.organization_id = @organization_id AND notifications.recipient_membership_id IN ${DEMO_PEOPLE}`);
    this.tdb.run(`DELETE FROM notification_preferences WHERE notification_preferences.organization_id = @organization_id AND notification_preferences.membership_id IN ${DEMO_PEOPLE}`);
    this.tdb.run(`DELETE FROM daily_updates WHERE daily_updates.organization_id = @organization_id AND daily_updates.membership_id IN ${DEMO_PEOPLE}`);
    this.tdb.run(`DELETE FROM automation_events WHERE automation_events.organization_id = @organization_id AND automation_events.entity_id IN ${DEMO_TASKS}`);
    this.tdb.run(`DELETE FROM task_dependencies WHERE task_dependencies.organization_id = @organization_id AND (task_dependencies.task_id IN ${DEMO_TASKS} OR task_dependencies.depends_on_task_id IN ${DEMO_TASKS})`);
    this.tdb.run(`DELETE FROM task_comments WHERE task_comments.organization_id = @organization_id AND task_comments.task_id IN ${DEMO_TASKS}`);
    this.tdb.run(`DELETE FROM task_updates WHERE task_updates.organization_id = @organization_id AND task_updates.task_id IN ${DEMO_TASKS}`);
    this.tdb.run(`DELETE FROM task_assignments WHERE task_assignments.organization_id = @organization_id AND (task_assignments.task_id IN ${DEMO_TASKS} OR task_assignments.assignee_membership_id IN ${DEMO_PEOPLE} OR task_assignments.assignee_team_id IN (SELECT dtm.id FROM teams dtm WHERE dtm.organization_id = @organization_id AND dtm.is_demo = 1))`);
    this.tdb.run("UPDATE tasks SET parent_task_id = NULL WHERE organization_id = @organization_id AND is_demo = 1");
    this.tdb.run("DELETE FROM tasks WHERE organization_id = @organization_id AND is_demo = 1");
    // objectives (with their key results and history) hang off demo teams, departments and people: they go before those
    this.tdb.run("DELETE FROM objective_relationships WHERE objective_relationships.organization_id = @organization_id AND (objective_relationships.parent_objective_id IN (SELECT dob0.id FROM objectives dob0 WHERE dob0.organization_id = @organization_id AND dob0.is_demo = 1) OR objective_relationships.child_objective_id IN (SELECT dob1.id FROM objectives dob1 WHERE dob1.organization_id = @organization_id AND dob1.is_demo = 1))");
    this.tdb.run(`DELETE FROM objective_assignments WHERE objective_assignments.organization_id = @organization_id AND (objective_assignments.objective_id IN (SELECT dob2.id FROM objectives dob2 WHERE dob2.organization_id = @organization_id AND dob2.is_demo = 1) OR objective_assignments.assignee_membership_id IN ${DEMO_PEOPLE} OR objective_assignments.assignee_team_id IN (SELECT dtm3.id FROM teams dtm3 WHERE dtm3.organization_id = @organization_id AND dtm3.is_demo = 1) OR objective_assignments.assignee_department_id IN (SELECT dd4.id FROM departments dd4 WHERE dd4.organization_id = @organization_id AND dd4.is_demo = 1))`);
    this.tdb.run("DELETE FROM objective_progress_history WHERE objective_progress_history.organization_id = @organization_id AND objective_progress_history.objective_id IN (SELECT dob.id FROM objectives dob WHERE dob.organization_id = @organization_id AND dob.is_demo = 1)");
    this.tdb.run("DELETE FROM key_results WHERE organization_id = @organization_id AND is_demo = 1");
    this.tdb.run("DELETE FROM objectives WHERE organization_id = @organization_id AND is_demo = 1");
    // KPIs: a demo KPI goes with its assignments, thresholds and measurements; a real KPI never points at demo rows (that is a blocker)
    this.tdb.run("DELETE FROM kpi_thresholds WHERE kpi_thresholds.organization_id = @organization_id AND kpi_thresholds.kpi_id IN (SELECT dk0.id FROM kpis dk0 WHERE dk0.organization_id = @organization_id AND dk0.is_demo = 1)");
    this.tdb.run("DELETE FROM kpi_assignments WHERE kpi_assignments.organization_id = @organization_id AND kpi_assignments.kpi_id IN (SELECT dk1.id FROM kpis dk1 WHERE dk1.organization_id = @organization_id AND dk1.is_demo = 1)");
    this.tdb.run("DELETE FROM kpis WHERE organization_id = @organization_id AND is_demo = 1");
    this.tdb.run(`DELETE FROM reporting_relationships WHERE reporting_relationships.organization_id = @organization_id AND (reporting_relationships.subordinate_membership_id IN ${DEMO_PEOPLE} OR reporting_relationships.manager_membership_id IN ${DEMO_PEOPLE})`);
    // (a real person's ENDED rows in a demo team or department are part of that team's history and go with it)
    this.tdb.run(`DELETE FROM team_memberships WHERE team_memberships.organization_id = @organization_id AND (team_memberships.membership_id IN ${DEMO_PEOPLE} OR team_memberships.team_id IN (SELECT dtm.id FROM teams dtm WHERE dtm.organization_id = @organization_id AND dtm.is_demo = 1))`);
    this.tdb.run(`DELETE FROM department_memberships WHERE department_memberships.organization_id = @organization_id AND (department_memberships.membership_id IN ${DEMO_PEOPLE} OR department_memberships.department_id IN (SELECT ddp.id FROM departments ddp WHERE ddp.organization_id = @organization_id AND ddp.is_demo = 1))`);
    this.tdb.run(`DELETE FROM designation_assignments WHERE designation_assignments.organization_id = @organization_id AND designation_assignments.membership_id IN ${DEMO_PEOPLE}`);
    this.tdb.run(`DELETE FROM user_role_assignments WHERE user_role_assignments.organization_id = @organization_id AND user_role_assignments.membership_id IN ${DEMO_PEOPLE}`);
    this.tdb.run("UPDATE organization_memberships SET designation_id = NULL WHERE organization_id = @organization_id AND is_demo = 1");
    this.tdb.run("DELETE FROM teams WHERE organization_id = @organization_id AND is_demo = 1");
    this.tdb.run("DELETE FROM departments WHERE organization_id = @organization_id AND is_demo = 1");
    this.tdb.run("DELETE FROM designations WHERE organization_id = @organization_id AND is_demo = 1");
    this.tdb.run("DELETE FROM role_families WHERE organization_id = @organization_id AND is_demo = 1");
    this.tdb.run("DELETE FROM organization_memberships WHERE organization_id = @organization_id AND is_demo = 1");
  }

  // ----- who can be viewed as -----

  personas(): PersonaRow[] {
    return this.tdb.all<PersonaRow>(
      "SELECT m.id AS id, m.display_name AS display_name, d.name AS designation, (SELECT dp.name FROM department_memberships dm JOIN departments dp ON dp.id = dm.department_id AND dp.organization_id = @organization_id WHERE dm.organization_id = @organization_id AND dm.membership_id = m.id AND dm.end_date IS NULL ORDER BY dm.created_at LIMIT 1) AS department, (SELECT GROUP_CONCAT(r.name, ', ') FROM user_role_assignments a JOIN roles r ON r.id = a.role_id AND r.organization_id = @organization_id WHERE a.organization_id = @organization_id AND a.membership_id = m.id AND a.revoked_at IS NULL) AS role_names, m.user_id AS user_id, (SELECT r1.manager_membership_id FROM reporting_relationships r1 WHERE r1.organization_id = @organization_id AND r1.subordinate_membership_id = m.id AND r1.relationship_type = 'primary' AND r1.end_date IS NULL LIMIT 1) AS manager_id, (SELECT COUNT(*) FROM reporting_relationships r2 WHERE r2.organization_id = @organization_id AND r2.manager_membership_id = m.id AND r2.end_date IS NULL) AS direct_reports FROM organization_memberships m LEFT JOIN designations d ON d.id = m.designation_id AND d.organization_id = @organization_id WHERE m.organization_id = @organization_id AND m.is_demo = 1 AND m.user_id IS NOT NULL AND m.status = 'active' AND m.archived_at IS NULL ORDER BY m.display_name COLLATE NOCASE",
    );
  }
  persona(id: string): { id: string; user_id: string; display_name: string; is_demo: number } | undefined {
    return this.tdb.get<{ id: string; user_id: string; display_name: string; is_demo: number }>("SELECT id, user_id, display_name, is_demo FROM organization_memberships WHERE organization_id = @organization_id AND id = @id AND user_id IS NOT NULL", { id });
  }
}
