import type Database from "better-sqlite3";
import type { TenantDb } from "../../../db/tenant.js";

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  timezone: string;
}

export interface MembershipRow {
  id: string;
  organization_id: string;
  user_id: string | null;
  display_name: string;
  status: string;
}

/** `organizations` is global (it IS the tenant), so this class reads it by the id the session carries. */
export class OrganizationsRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): OrganizationRow | undefined {
    return this.db
      .prepare("SELECT id, name, slug, timezone FROM organizations WHERE id = @id AND archived_at IS NULL")
      .get({ id }) as OrganizationRow | undefined;
  }

  slugTaken(slug: string): boolean {
    return this.db.prepare("SELECT 1 AS x FROM organizations WHERE slug = @slug").get({ slug }) !== undefined;
  }

  insert(o: { id: string; name: string; slug: string; timezone: string; createdByUserId: string; now: string }): void {
    this.db
      .prepare(
        "INSERT INTO organizations (id, name, slug, timezone, created_by_user_id, created_at, updated_at) VALUES (@id, @name, @slug, @timezone, @createdByUserId, @now, @now)",
      )
      .run(o);
  }
}

/** Everything below is organization-owned: it goes through the tenant-scoped handle, whose organization id comes from the session. */
export class MembershipsRepository {
  constructor(private readonly tdb: TenantDb) {}

  findActiveForUser(userId: string): MembershipRow | undefined {
    return this.tdb.get<MembershipRow>(
      "SELECT id, organization_id, user_id, display_name, status FROM organization_memberships WHERE organization_id = @organization_id AND user_id = @userId AND status = 'active' AND archived_at IS NULL",
      { userId },
    );
  }

  insert(m: { id: string; userId: string; displayName: string; workEmail: string; now: string }): void {
    this.tdb.run(
      "INSERT INTO organization_memberships (id, organization_id, user_id, display_name, work_email, status, created_at, updated_at) VALUES (@id, @organization_id, @userId, @displayName, @workEmail, 'active', @now, @now)",
      m,
    );
  }

  count(): number {
    return this.tdb.get<{ n: number }>("SELECT COUNT(*) AS n FROM organization_memberships WHERE organization_id = @organization_id")?.n ?? 0;
  }
}

export class RolesRepository {
  constructor(private readonly tdb: TenantDb) {}

  insert(r: { id: string; key: string; name: string; description: string; now: string }): void {
    this.tdb.run(
      "INSERT INTO roles (id, organization_id, key, name, description, kind, created_at, updated_at) VALUES (@id, @organization_id, @key, @name, @description, 'template', @now, @now)",
      r,
    );
  }

  /** Keys of the roles the person holds right now (not revoked, inside their validity window). */
  keysForMembership(membershipId: string, today: string): string[] {
    return this.tdb
      .all<{ key: string }>(
        "SELECT r.key AS key FROM user_role_assignments a JOIN roles r ON r.id = a.role_id AND r.organization_id = @organization_id WHERE a.organization_id = @organization_id AND a.membership_id = @membershipId AND a.revoked_at IS NULL AND a.valid_from <= @today AND (a.valid_to IS NULL OR a.valid_to >= @today) AND r.archived_at IS NULL ORDER BY r.key",
        { membershipId, today },
      )
      .map((x) => x.key);
  }

  assign(a: { id: string; membershipId: string; roleId: string; now: string }): void {
    this.tdb.run(
      "INSERT INTO user_role_assignments (id, organization_id, membership_id, role_id, scope_type, valid_from, granted_by_membership_id, created_at) VALUES (@id, @organization_id, @membershipId, @roleId, 'organization', @now, @membershipId, @now)",
      a,
    );
  }
}
