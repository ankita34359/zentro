import type Database from "better-sqlite3";
import type { TenantDb } from "../../../db/tenant.js";
import type { ScopeMode } from "../catalog.js";
import type { Grant } from "../resolver.js";

export interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string;
  kind: string;
  /** Protected roles cannot be edited or archived (the Owner role). */
  is_protected: number;
}

export interface AssignmentRow {
  id: string;
  membership_id: string;
  role_id: string;
  role_name: string;
  scope_type: string;
  scope_id: string | null;
  valid_from: string;
  valid_to: string | null;
  revoked_at: string | null;
  granted_by_name: string | null;
  created_at: string;
}

export interface RoleListRow extends RoleRow {
  permission_count: number;
  holder_count: number;
}

const ACTIVE = "a.revoked_at IS NULL AND a.valid_from <= @now AND (a.valid_to IS NULL OR a.valid_to >= @now)";

/** Global catalogue read. */
export class PermissionsCatalogRepository {
  constructor(private readonly db: Database.Database) {}

  list(): { key: string; module: string; description: string; allowed_scope_modes_json: string; is_sensitive: number }[] {
    return this.db.prepare("SELECT key, module, description, allowed_scope_modes_json, is_sensitive FROM permissions ORDER BY rowid").all() as never;
  }

  insert(p: { key: string; module: string; description: string; modes: string; sensitive: number }): void {
    this.db
      .prepare("INSERT OR IGNORE INTO permissions (id, key, module, description, allowed_scope_modes_json, is_sensitive) VALUES (@key, @key, @module, @description, @modes, @sensitive)")
      .run(p);
  }
}

/** Organization-owned: roles, their grants and who holds them, all through the tenant-scoped handle. */
export class RoleGrantsRepository {
  constructor(private readonly tdb: TenantDb) {}

  /** Every active grant of one person: their assignments (not revoked, inside their validity window) joined to the role's permission rows. */
  grantsFor(membershipId: string, now: string): Grant[] {
    return this.tdb
      .all<{ scope_type: Grant["scopeType"]; scope_id: string | null; key: string; scope_mode: ScopeMode }>(
        "SELECT a.scope_type AS scope_type, a.scope_id AS scope_id, p.key AS key, rp.scope_mode AS scope_mode FROM user_role_assignments a JOIN roles r ON r.id = a.role_id AND r.organization_id = @organization_id JOIN role_permissions rp ON rp.role_id = r.id AND rp.organization_id = @organization_id JOIN permissions p ON p.id = rp.permission_id WHERE a.organization_id = @organization_id AND a.membership_id = @membershipId AND a.revoked_at IS NULL AND a.valid_from <= @now AND (a.valid_to IS NULL OR a.valid_to >= @now) AND r.archived_at IS NULL",
        { membershipId, now },
      )
      .map((x) => ({ scopeType: x.scope_type, scopeId: x.scope_id, permission: x.key, mode: x.scope_mode }));
  }

  /** The people who can administer the organization right now: roles.manage and org.settings, both at all_in_scope, assigned organization-wide. */
  administratorIds(now: string): string[] {
    return this.tdb
      .all<{ membership_id: string }>(
        "SELECT DISTINCT a.membership_id AS membership_id FROM user_role_assignments a JOIN organization_memberships m ON m.id = a.membership_id AND m.organization_id = @organization_id AND m.status = 'active' JOIN roles r ON r.id = a.role_id AND r.organization_id = @organization_id AND r.archived_at IS NULL JOIN role_permissions rp1 ON rp1.role_id = r.id AND rp1.organization_id = @organization_id AND rp1.permission_id = 'roles.manage' AND rp1.scope_mode = 'all_in_scope' JOIN role_permissions rp2 ON rp2.role_id = r.id AND rp2.organization_id = @organization_id AND rp2.permission_id = 'org.settings' AND rp2.scope_mode = 'all_in_scope' WHERE a.organization_id = @organization_id AND a.scope_type = 'organization' AND a.revoked_at IS NULL AND a.valid_from <= @now AND (a.valid_to IS NULL OR a.valid_to >= @now)",
        { now },
      )
      .map((x) => x.membership_id);
  }

  listRoles(now: string): RoleListRow[] {
    return this.tdb.all<RoleListRow>(
      "SELECT r.id AS id, r.key AS key, r.name AS name, r.description AS description, r.kind AS kind, r.is_protected AS is_protected, (SELECT COUNT(*) FROM role_permissions rp WHERE rp.organization_id = @organization_id AND rp.role_id = r.id) AS permission_count, (SELECT COUNT(DISTINCT a.membership_id) FROM user_role_assignments a WHERE a.organization_id = @organization_id AND a.role_id = r.id AND a.revoked_at IS NULL AND a.valid_from <= @now AND (a.valid_to IS NULL OR a.valid_to >= @now)) AS holder_count FROM roles r WHERE r.organization_id = @organization_id AND r.archived_at IS NULL ORDER BY r.created_at, r.name",
      { now },
    );
  }

  findRole(id: string): RoleRow | undefined {
    return this.tdb.get<RoleRow>("SELECT id, key, name, description, kind, is_protected FROM roles WHERE organization_id = @organization_id AND id = @id AND archived_at IS NULL", { id });
  }

  roleGrants(roleId: string): { permission: string; mode: ScopeMode }[] {
    return this.tdb
      .all<{ key: string; scope_mode: ScopeMode }>(
        "SELECT p.key AS key, rp.scope_mode AS scope_mode FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.organization_id = @organization_id AND rp.role_id = @roleId ORDER BY p.rowid, rp.scope_mode",
        { roleId },
      )
      .map((x) => ({ permission: x.key, mode: x.scope_mode }));
  }

  roleKeys(): string[] {
    return this.tdb.all<{ key: string }>("SELECT key FROM roles WHERE organization_id = @organization_id").map((r) => r.key);
  }

  insertRole(r: { id: string; key: string; name: string; description: string; now: string; kind?: "template" | "custom"; isProtected?: boolean }): void {
    this.tdb.run(
      "INSERT INTO roles (id, organization_id, key, name, description, kind, is_protected, created_at, updated_at) VALUES (@id, @organization_id, @key, @name, @description, @kind, @isProtected, @now, @now)",
      { id: r.id, key: r.key, name: r.name, description: r.description, now: r.now, kind: r.kind ?? "template", isProtected: r.isProtected ? 1 : 0 },
    );
  }

  updateRole(id: string, f: { name: string; description: string; now: string }): void {
    this.tdb.run("UPDATE roles SET name = @name, description = @description, updated_at = @now WHERE organization_id = @organization_id AND id = @id", { id, ...f });
  }

  archiveRole(id: string, now: string): void {
    this.tdb.run("UPDATE roles SET archived_at = @now, updated_at = @now WHERE organization_id = @organization_id AND id = @id AND archived_at IS NULL", { id, now });
  }

  /** A role name already in use by another live role (case-insensitive). */
  nameTaken(name: string, exceptId?: string): boolean {
    return (
      this.tdb.get("SELECT 1 AS x FROM roles WHERE organization_id = @organization_id AND archived_at IS NULL AND lower(name) = lower(@name) AND id <> @exceptId", { name, exceptId: exceptId ?? "" }) !== undefined
    );
  }

  /** Replaces every grant of a role. The caller wraps this, the audit row and the last-administrator check in one transaction. */
  deleteGrants(roleId: string): void {
    this.tdb.run("DELETE FROM role_permissions WHERE organization_id = @organization_id AND role_id = @roleId", { roleId });
  }

  holderCount(roleId: string, now: string): number {
    return (
      this.tdb.get<{ n: number }>(
        `SELECT COUNT(DISTINCT a.membership_id) AS n FROM user_role_assignments a WHERE a.organization_id = @organization_id AND a.role_id = @roleId AND ${ACTIVE}`,
        { roleId, now },
      )?.n ?? 0
    );
  }

  // ----- assignments -----

  assignmentsFor(membershipId: string | null, now: string): AssignmentRow[] {
    return this.tdb.all<AssignmentRow>(
      "SELECT a.id AS id, a.membership_id AS membership_id, a.role_id AS role_id, r.name AS role_name, a.scope_type AS scope_type, a.scope_id AS scope_id, a.valid_from AS valid_from, a.valid_to AS valid_to, a.revoked_at AS revoked_at, g.display_name AS granted_by_name, a.created_at AS created_at FROM user_role_assignments a JOIN roles r ON r.id = a.role_id AND r.organization_id = @organization_id LEFT JOIN organization_memberships g ON g.id = a.granted_by_membership_id AND g.organization_id = @organization_id WHERE a.organization_id = @organization_id AND (@membershipId IS NULL OR a.membership_id = @membershipId) ORDER BY a.created_at DESC, a.id",
      { membershipId, now },
    );
  }

  findAssignment(id: string): AssignmentRow | undefined {
    return this.tdb.get<AssignmentRow>(
      "SELECT a.id AS id, a.membership_id AS membership_id, a.role_id AS role_id, r.name AS role_name, a.scope_type AS scope_type, a.scope_id AS scope_id, a.valid_from AS valid_from, a.valid_to AS valid_to, a.revoked_at AS revoked_at, g.display_name AS granted_by_name, a.created_at AS created_at FROM user_role_assignments a JOIN roles r ON r.id = a.role_id AND r.organization_id = @organization_id LEFT JOIN organization_memberships g ON g.id = a.granted_by_membership_id AND g.organization_id = @organization_id WHERE a.organization_id = @organization_id AND a.id = @id",
      { id },
    );
  }

  /** An assignment of this role to this person that is not revoked and not over yet (so a second one would be a duplicate). */
  openAssignment(membershipId: string, roleId: string, now: string, scopeType = "organization", scopeId: string | null = null): AssignmentRow | undefined {
    return this.assignmentsFor(membershipId, now).find((a) => a.role_id === roleId && a.scope_type === scopeType && a.scope_id === scopeId && a.revoked_at === null && (a.valid_to === null || a.valid_to >= now));
  }

  insertAssignment(a: { id: string; membershipId: string; roleId: string; scopeType?: "organization" | "department" | "team"; scopeId?: string | null; validFrom: string; validTo: string | null; grantedByMembershipId: string | null; now: string }): void {
    this.tdb.run(
      "INSERT INTO user_role_assignments (id, organization_id, membership_id, role_id, scope_type, scope_id, valid_from, valid_to, granted_by_membership_id, created_at) VALUES (@id, @organization_id, @membershipId, @roleId, @scopeType, @scopeId, @validFrom, @validTo, @grantedByMembershipId, @now)",
      { ...a, scopeType: a.scopeType ?? "organization", scopeId: a.scopeId ?? null },
    );
  }

  revokeAssignment(id: string, now: string): boolean {
    return this.tdb.run("UPDATE user_role_assignments SET revoked_at = @now WHERE organization_id = @organization_id AND id = @id AND revoked_at IS NULL", { id, now }).changes === 1;
  }

  revokeAllFor(membershipId: string, now: string): void {
    this.tdb.run("UPDATE user_role_assignments SET revoked_at = @now WHERE organization_id = @organization_id AND membership_id = @membershipId AND revoked_at IS NULL", { membershipId, now });
  }

  insertGrant(g: { roleId: string; permission: string; mode: ScopeMode; now: string }): void {
    this.tdb.run(
      "INSERT INTO role_permissions (organization_id, role_id, permission_id, scope_mode, created_at) VALUES (@organization_id, @roleId, @permission, @mode, @now)",
      g,
    );
  }

  assign(a: { id: string; membershipId: string; roleId: string; grantedByMembershipId: string | null; now: string }): void {
    this.tdb.run(
      "INSERT INTO user_role_assignments (id, organization_id, membership_id, role_id, scope_type, valid_from, granted_by_membership_id, created_at) VALUES (@id, @organization_id, @membershipId, @roleId, 'organization', @now, @grantedByMembershipId, @now)",
      a,
    );
  }

  /** Ids of every organization-owned role for the organization this handle belongs to (used to size a seed). */
  roleIdByKey(key: string): string | undefined {
    return this.tdb.get<{ id: string }>("SELECT id FROM roles WHERE organization_id = @organization_id AND key = @key", { key })?.id;
  }
}
