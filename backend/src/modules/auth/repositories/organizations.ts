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
export interface MemberListRow {
  id: string;
  display_name: string;
  work_email: string | null;
  status: string;
  user_id: string | null;
  login_email: string | null;
}

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

  findById(id: string): MembershipRow | undefined {
    return this.tdb.get<MembershipRow>(
      "SELECT id, organization_id, user_id, display_name, status FROM organization_memberships WHERE organization_id = @organization_id AND id = @id",
      { id },
    );
  }

  /** A person invited by email: no login yet (user_id stays NULL until they accept). */
  insertInvited(m: { id: string; displayName: string; workEmail: string; now: string }): void {
    this.tdb.run(
      "INSERT INTO organization_memberships (id, organization_id, user_id, display_name, work_email, status, created_at, updated_at) VALUES (@id, @organization_id, NULL, @displayName, @workEmail, 'invited', @now, @now)",
      m,
    );
  }

  /** Binds the invited person to a login. Only an unbound, invited membership can be bound, once. */
  bindUser(id: string, userId: string, displayName: string, now: string): boolean {
    return (
      this.tdb.run(
        "UPDATE organization_memberships SET user_id = @userId, display_name = @displayName, status = 'active', archived_at = NULL, updated_at = @now WHERE organization_id = @organization_id AND id = @id AND user_id IS NULL AND status = 'invited'",
        { id, userId, displayName, now },
      ).changes === 1
    );
  }

  /** An invitation was revoked or replaced: the person who never joined leaves the list. */
  retireInvited(id: string, now: string): void {
    this.tdb.run(
      "UPDATE organization_memberships SET status = 'left', archived_at = @now, updated_at = @now WHERE organization_id = @organization_id AND id = @id AND user_id IS NULL AND status = 'invited'",
      { id, now },
    );
  }

  /** Back to invited (a revoked or expired invitation was regenerated). */
  reinvite(id: string, now: string): void {
    this.tdb.run(
      "UPDATE organization_memberships SET status = 'invited', archived_at = NULL, updated_at = @now WHERE organization_id = @organization_id AND id = @id AND user_id IS NULL AND status IN ('invited', 'left')",
      { id, now },
    );
  }

  /** Active or invited people with the login's email, for the Users screen. */
  listPeople(): MemberListRow[] {
    return this.tdb.all<MemberListRow>(
      "SELECT m.id AS id, m.display_name AS display_name, m.work_email AS work_email, m.status AS status, m.user_id AS user_id, u.email AS login_email FROM organization_memberships m LEFT JOIN users u ON u.id = m.user_id WHERE m.organization_id = @organization_id AND m.archived_at IS NULL ORDER BY m.display_name COLLATE NOCASE",
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

  /** Role keys held right now by every person in the organization, for the Users screen. */
  keysByMembership(today: string): Map<string, string[]> {
    const rows = this.tdb.all<{ membership_id: string; key: string }>(
      "SELECT a.membership_id AS membership_id, r.key AS key FROM user_role_assignments a JOIN roles r ON r.id = a.role_id AND r.organization_id = @organization_id WHERE a.organization_id = @organization_id AND a.revoked_at IS NULL AND a.valid_from <= @today AND (a.valid_to IS NULL OR a.valid_to >= @today) AND r.archived_at IS NULL ORDER BY r.key",
      { today },
    );
    const out = new Map<string, string[]>();
    for (const r of rows) out.set(r.membership_id, [...(out.get(r.membership_id) ?? []), r.key]);
    return out;
  }

  assign(a: { id: string; membershipId: string; roleId: string; now: string }): void {
    this.tdb.run(
      "INSERT INTO user_role_assignments (id, organization_id, membership_id, role_id, scope_type, valid_from, granted_by_membership_id, created_at) VALUES (@id, @organization_id, @membershipId, @roleId, 'organization', @now, @membershipId, @now)",
      a,
    );
  }
}
