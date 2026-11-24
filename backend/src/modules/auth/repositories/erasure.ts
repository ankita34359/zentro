import type Database from "better-sqlite3";
import type { TenantDb } from "../../../db/tenant.js";
import { PeopleRepository } from "../../people/repositories/people.js";

/**
 * Every table that holds organization-owned rows, in the order they must be deleted (children before parents).
 * Deleting an organization or an account must cover ALL of them: a test lists the tables that have an
 * `organization_id` column and fails when one is missing here, so a later stage that adds a table cannot forget.
 */
export const ORGANIZATION_TABLES_IN_DELETE_ORDER = ["audit_logs", "demo_data_batches", "automation_events", "notification_preferences", "notifications", "daily_updates", "task_comments", "task_updates", "task_assignments", "task_dependencies", "tasks", "objective_progress_history", "key_results", "objective_assignments", "objective_relationships", "objectives", "kpi_measurements", "kpi_thresholds", "kpi_assignments", "kpis", "ai_requests", "organization_ai_settings", "webhook_deliveries", "webhook_settings", "inbound_endpoints", "evidence_files", "evidence_links", "evidence", "performance_reviews", "mentorship_progress", "mentorship_activities", "mentorship_assignments", "performance_comparisons", "performance_score_components", "performance_scores", "performance_scorecards", "performance_periods", "scoring_model_components", "scoring_models", "reporting_relationships", "team_memberships", "department_memberships", "designation_assignments", "designations", "role_families", "teams", "departments", "invitations", "user_role_assignments", "role_permissions", "roles", "organization_memberships"] as const;

export interface MemberCounts {
  /** Other people who have joined and still belong (active or suspended). People who left, and people only invited, do not count: invitations are counted separately. */
  others: number;
  /** Open invitations that have not expired. */
  pendingInvitations: number;
}

/** Counting and deleting for "Delete my account". Organization-owned rows go through the tenant handle; the global ones by id. */
export class ErasureRepository {
  constructor(private readonly db: Database.Database) {}

  // ----- organization-owned (tenant handle) -----

  counts(tdb: TenantDb, myMembershipId: string, now: string): MemberCounts {
    const others = tdb.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM organization_memberships WHERE organization_id = @organization_id AND id <> @myMembershipId AND status IN ('active', 'suspended') AND archived_at IS NULL",
      { myMembershipId },
    )?.n ?? 0;
    const pending = tdb.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM invitations WHERE organization_id = @organization_id AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > @now",
      { now },
    )?.n ?? 0;
    return { others, pendingInvitations: pending };
  }

  /** A person leaves an organization that continues: their roles end and their personal details are removed from the membership. */
  retireMembership(tdb: TenantDb, membershipId: string, now: string): void {
    tdb.run("UPDATE user_role_assignments SET revoked_at = @now WHERE organization_id = @organization_id AND membership_id = @membershipId AND revoked_at IS NULL", { membershipId, now });
    new PeopleRepository(tdb).endEverythingFor(membershipId, now.slice(0, 10)); // their placements and reporting lines end today (history kept)
    tdb.run(
      "UPDATE organization_memberships SET user_id = NULL, status = 'left', display_name = 'Former member', work_email = NULL, archived_at = @now, updated_at = @now WHERE organization_id = @organization_id AND id = @membershipId",
      { membershipId, now },
    );
  }

  /** The whole organization goes (it has no other members and no pending invitations). */
  deleteOrganizationRows(tdb: TenantDb): void {
    tdb.run("DELETE FROM audit_logs WHERE organization_id = @organization_id"); // the only deletion of audit rows: the whole organization is going away
    tdb.run("DELETE FROM demo_data_batches WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM automation_events WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM notification_preferences WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM notifications WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM daily_updates WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM task_comments WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM task_updates WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM task_assignments WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM task_dependencies WHERE organization_id = @organization_id");
    tdb.run("UPDATE tasks SET parent_task_id = NULL WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM tasks WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM objective_progress_history WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM objective_assignments WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM objective_relationships WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM key_results WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM objectives WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM kpi_measurements WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM kpi_thresholds WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM kpi_assignments WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM kpis WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM webhook_deliveries WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM webhook_settings WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM inbound_endpoints WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM ai_requests WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM organization_ai_settings WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM evidence_files WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM evidence_links WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM evidence WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM performance_reviews WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM mentorship_progress WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM mentorship_activities WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM mentorship_assignments WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM performance_comparisons WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM performance_score_components WHERE organization_id = @organization_id");
    tdb.run("UPDATE performance_scorecards SET latest_score_id = NULL WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM performance_scores WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM performance_scorecards WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM performance_periods WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM scoring_model_components WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM scoring_models WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM reporting_relationships WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM team_memberships WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM department_memberships WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM designation_assignments WHERE organization_id = @organization_id");
    tdb.run("UPDATE organization_memberships SET designation_id = NULL WHERE organization_id = @organization_id"); // the cached designation points at a row about to go
    tdb.run("DELETE FROM designations WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM role_families WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM teams WHERE organization_id = @organization_id"); // sub-teams point at their parent: SQLite checks foreign keys at the end of the statement, so one statement per table is enough
    tdb.run("DELETE FROM departments WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM invitations WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM user_role_assignments WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM role_permissions WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM roles WHERE organization_id = @organization_id");
    tdb.run("DELETE FROM organization_memberships WHERE organization_id = @organization_id");
  }

  // ----- global tables -----

  /** After an organization's rows are gone: nobody points at it any more, then it is deleted. */
  deleteOrganization(organizationId: string): void {
    this.db.prepare("UPDATE users SET default_organization_id = NULL WHERE default_organization_id = @organizationId").run({ organizationId });
    this.db.prepare("UPDATE sessions SET active_organization_id = NULL WHERE active_organization_id = @organizationId").run({ organizationId });
    this.db.prepare("DELETE FROM scheduled_job_runs WHERE organization_id = @organizationId").run({ organizationId }); // operational log, no foreign key
    this.db.prepare("DELETE FROM organizations WHERE id = @organizationId").run({ organizationId });
  }

  createdOrganizations(userId: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM organizations WHERE created_by_user_id = @userId").get({ userId }) as { n: number }).n;
  }

  /** Removes every session and reset token of a login (and the trace of reset links they created for others). */
  deleteLoginTraces(userId: string): void {
    this.db.prepare("DELETE FROM sessions WHERE user_id = @userId").run({ userId });
    this.db.prepare("UPDATE auth_tokens SET created_by_user_id = NULL WHERE created_by_user_id = @userId").run({ userId });
    this.db.prepare("DELETE FROM auth_tokens WHERE user_id = @userId").run({ userId });
  }

  /** The login row is deleted outright. Only valid once nothing references it. */
  deleteUser(userId: string): void {
    this.db.prepare("DELETE FROM users WHERE id = @userId").run({ userId });
  }

  /**
   * The login row stays (an organization it created still points at it) but holds nothing personal: no email, name or
   * password, and it can never sign in. The email address becomes free to register again.
   */
  tombstoneUser(userId: string, now: string): void {
    this.db
      .prepare(
        "UPDATE users SET email = @email, name = 'Deleted user', password_hash = NULL, status = 'disabled', default_organization_id = NULL, last_login_at = NULL, updated_at = @now WHERE id = @userId",
      )
      .run({ userId, now, email: `deleted-${userId}@deleted.invalid` });
  }
}
