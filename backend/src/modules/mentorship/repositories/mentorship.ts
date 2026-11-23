import type { TenantDb } from "../../../db/tenant.js";

export interface AssignmentRow { id: string; mentor_membership_id: string; mentee_membership_id: string; start_date: string; end_date: string | null; status: string; goals: string; cadence_days: number; created_by_membership_id: string; is_demo: number; created_at: string; updated_at: string }
export interface ActivityRow { id: string; assignment_id: string; activity_type: string; occurred_on: string; duration_minutes: number | null; summary: string; outcome: string | null; created_by_membership_id: string; is_demo: number; created_at: string }
export interface ProgressRow { id: string; assignment_id: string; period_id: string; metric_key: string; current_value: number; source: string; note: string | null; entered_by_membership_id: string; measured_at: string }
const A = "id, mentor_membership_id, mentee_membership_id, start_date, end_date, status, goals, cadence_days, created_by_membership_id, is_demo, created_at, updated_at";
const ACT = "id, assignment_id, activity_type, occurred_on, duration_minutes, summary, outcome, created_by_membership_id, is_demo, created_at";

/** Mentorship assignments, activities and entered ratings for ONE organization. */
export class MentorshipRepository {
  constructor(private readonly tdb: TenantDb) {}

  assignments(): AssignmentRow[] {
    return this.tdb.all<AssignmentRow>(`SELECT ${A} FROM mentorship_assignments WHERE organization_id = @organization_id ORDER BY start_date DESC, created_at DESC, rowid DESC`);
  }
  assignment(id: string): AssignmentRow | undefined {
    return this.tdb.get<AssignmentRow>(`SELECT ${A} FROM mentorship_assignments WHERE organization_id = @organization_id AND id = @id`, { id });
  }
  insertAssignment(a: { id: string; mentorId: string; menteeId: string; startDate: string; goals: string; cadenceDays: number; by: string; isDemo?: boolean; now: string }): void {
    this.tdb.run("INSERT INTO mentorship_assignments (id, organization_id, mentor_membership_id, mentee_membership_id, start_date, status, goals, cadence_days, created_by_membership_id, is_demo, created_at, updated_at) VALUES (@id, @organization_id, @mentorId, @menteeId, @startDate, 'active', @goals, @cadenceDays, @by, @isDemo, @now, @now)", { ...a, isDemo: a.isDemo ? 1 : 0 });
  }
  updateAssignment(a: { id: string; goals: string; cadenceDays: number; status: string; endDate: string | null; now: string }): void {
    this.tdb.run("UPDATE mentorship_assignments SET goals = @goals, cadence_days = @cadenceDays, status = @status, end_date = @endDate, updated_at = @now WHERE organization_id = @organization_id AND id = @id", a);
  }

  activities(assignmentId?: string): ActivityRow[] {
    return this.tdb.all<ActivityRow>(`SELECT ${ACT} FROM mentorship_activities WHERE organization_id = @organization_id AND (@assignmentId IS NULL OR assignment_id = @assignmentId) ORDER BY occurred_on DESC, created_at DESC, rowid DESC`, { assignmentId: assignmentId ?? null });
  }
  insertActivity(a: { id: string; assignmentId: string; type: string; occurredOn: string; minutes: number | null; summary: string; outcome: string | null; by: string; isDemo?: boolean; now: string }): void {
    this.tdb.run("INSERT INTO mentorship_activities (id, organization_id, assignment_id, activity_type, occurred_on, duration_minutes, summary, outcome, created_by_membership_id, is_demo, created_at) VALUES (@id, @organization_id, @assignmentId, @type, @occurredOn, @minutes, @summary, @outcome, @by, @isDemo, @now)", { ...a, isDemo: a.isDemo ? 1 : 0 });
  }

  progress(assignmentId: string): ProgressRow[] {
    return this.tdb.all<ProgressRow>("SELECT id, assignment_id, period_id, metric_key, current_value, source, note, entered_by_membership_id, measured_at FROM mentorship_progress WHERE organization_id = @organization_id AND assignment_id = @assignmentId ORDER BY measured_at DESC, rowid DESC", { assignmentId });
  }
  insertProgress(p: { id: string; assignmentId: string; periodId: string; value: number; source: string; note: string | null; by: string; now: string }): void {
    this.tdb.run("INSERT INTO mentorship_progress (id, organization_id, assignment_id, period_id, metric_key, current_value, source, note, entered_by_membership_id, measured_at) VALUES (@id, @organization_id, @assignmentId, @periodId, 'skill_rating', @value, @source, @note, @by, @now)", p);
  }
}
