import type Database from "better-sqlite3";
import type { TenantDb } from "../../../db/tenant.js";

/**
 * Every table that holds organization-owned rows, in the order they must be deleted (children before parents).
 * Deleting an organization or an account must cover ALL of them: a test lists the tables that have an
 * `organization_id` column and fails when one is missing here, so a later stage that adds a table cannot forget.
 */
export const ORGANIZATION_TABLES_IN_DELETE_ORDER = ["audit_logs", "invitations", "user_role_assignments", "role_permissions", "roles", "organization_memberships"] as const;

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
    tdb.run(
      "UPDATE organization_memberships SET user_id = NULL, status = 'left', display_name = 'Former member', work_email = NULL, archived_at = @now, updated_at = @now WHERE organization_id = @organization_id AND id = @membershipId",
      { membershipId, now },
    );
  }

  /** The whole organization goes (it has no other members and no pending invitations). */
  deleteOrganizationRows(tdb: TenantDb): void {
    tdb.run("DELETE FROM audit_logs WHERE organization_id = @organization_id"); // the only deletion of audit rows: the whole organization is going away
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
