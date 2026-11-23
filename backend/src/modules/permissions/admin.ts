import type { TenantCtx, TenantDb } from "../../db/tenant.js";
import { HttpError, notFound, permissionDenied } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import type { AuditService } from "../audit/service.js";
import type { AuthContext, AuthService } from "../auth/service.js";
import type { AuthStore } from "../auth/repositories/store.js";
import { PERMISSIONS, permissionByKey, type ScopeMode } from "./catalog.js";
import { scopeContainsMember } from "./resolver.js";
import type { Capabilities, PermissionService, RoleDetail } from "./service.js";

export interface GrantInput {
  permission: string;
  mode: ScopeMode;
}

export interface AssignmentView {
  id: string;
  membershipId: string;
  roleId: string;
  roleName: string;
  scopeType: string;
  /** The department or team a scoped assignment covers (null for the whole organization). */
  scopeId: string | null;
  scopeName: string | null;
  validFrom: string;
  validTo: string | null;
  revokedAt: string | null;
  grantedBy: string | null;
  /** active now / revoked / ended / not started */
  state: "active" | "revoked" | "ended" | "scheduled";
}

const slug = (name: string): string =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "role";

const key = (g: GrantInput): string => `${g.permission}:${g.mode}`;

/**
 * Role editing, role assignments and removing a person (stage 2.4). Every change is ONE transaction that also writes
 * its audit row and then re-checks the last-administrator rule, so a change that would leave the organization without
 * an administrator is rolled back whole and refused with 409 `last_admin`.
 *
 * Guardrails (docs/permission-model.md section 6): you cannot grant or take away what you do not hold; protected roles
 * (the Owner role) are view only; the last administrator cannot be removed; every change is audited.
 */
export class AdminService {
  constructor(
    private readonly o: { store: AuthStore; auth: AuthService; permissions: PermissionService; audit: AuditService },
  ) {}

  private ctx(auth: AuthContext, requestId: string): TenantCtx {
    return this.o.auth.tenantCtx(auth, requestId);
  }
  private now = (): string => this.o.auth.iso();

  /** Role definitions belong to the whole organization, so editing them needs an organization-wide `roles.manage`. */
  private requireOrganizationWide(caps: Capabilities): void {
    if (!caps.scope("roles.manage").all) throw permissionDenied();
  }

  /** Throws 409 last_admin (rolling the transaction back) when nobody could administer the organization afterwards. */
  private assertAdministratorRemains(ctx: TenantCtx): void {
    if (this.o.permissions.administratorIdsFor(ctx).length === 0) {
      throw new HttpError(409, "last_admin", "That change would leave the organization without an administrator. Make someone else an administrator first.");
    }
  }

  // ---------- roles ----------

  createRole(auth: AuthContext, requestId: string, caps: Capabilities, input: { name: string; description?: string; copyFromRoleId?: string }): RoleDetail {
    this.requireOrganizationWide(caps);
    const ctx = this.ctx(auth, requestId);
    const tdb = this.o.store.tenant(ctx);
    const grants = this.o.store.grants(tdb);
    const name = input.name.trim();
    if (grants.nameTaken(name)) throw new HttpError(409, "already_exists", "A role with this name already exists");
    let copied: GrantInput[] = [];
    if (input.copyFromRoleId) {
      copied = this.o.permissions.roleGrantsFor(ctx, input.copyFromRoleId).map((g) => ({ permission: g.permission, mode: g.mode })); // 404 for another organization's role
      if (!caps.covers(copied)) throw new HttpError(403, "cannot_grant_role", "You can only copy a role whose permissions you hold yourself");
    }
    const id = newId();
    const now = this.now();
    const taken = new Set(grants.roleKeys());
    let roleKey = slug(name);
    for (let i = 2; taken.has(roleKey); i++) roleKey = `${slug(name)}_${i}`;
    this.o.store.transaction(() => {
      grants.insertRole({ id, key: roleKey, name, description: (input.description ?? "").trim(), now, kind: "custom" });
      for (const g of copied) grants.insertGrant({ roleId: id, permission: g.permission, mode: g.mode, now });
      this.o.audit.record(tdb, ctx, { action: "role.create", entityType: "role", entityId: id, summary: `Created the role "${name}"${input.copyFromRoleId ? " as a copy of another role" : ""}`, after: { name, grants: copied.length } });
    });
    return this.o.permissions.roleDetail(ctx, id);
  }

  private editableRole(ctx: TenantCtx, id: string) {
    const grants = this.o.store.grants(this.o.store.tenant(ctx));
    const role = grants.findRole(id);
    if (!role) throw notFound(); // another organization's role looks exactly like a missing one
    if (role.is_protected === 1) throw new HttpError(403, "role_protected", "This role is protected: it can be viewed and assigned, but not edited or archived");
    return role;
  }

  updateRole(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: { name?: string; description?: string }): RoleDetail {
    this.requireOrganizationWide(caps);
    const ctx = this.ctx(auth, requestId);
    const role = this.editableRole(ctx, id);
    const tdb = this.o.store.tenant(ctx);
    const grants = this.o.store.grants(tdb);
    const name = (input.name ?? role.name).trim();
    const description = (input.description ?? role.description).trim();
    if (name !== role.name && grants.nameTaken(name, id)) throw new HttpError(409, "already_exists", "A role with this name already exists");
    this.o.store.transaction(() => {
      grants.updateRole(id, { name, description, now: this.now() });
      this.o.audit.record(tdb, ctx, {
        action: "role.update",
        entityType: "role",
        entityId: id,
        summary: `Edited the role "${role.name}"${name !== role.name ? ` (now "${name}")` : ""}`,
        before: { name: role.name, description: role.description },
        after: { name, description },
      });
    });
    return this.o.permissions.roleDetail(ctx, id);
  }

  /** Replaces a role's whole permission grid. Sensitive additions need `confirmSensitive`. */
  setPermissions(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: { grants: GrantInput[]; confirmSensitive?: boolean }): RoleDetail {
    this.requireOrganizationWide(caps);
    const ctx = this.ctx(auth, requestId);
    const role = this.editableRole(ctx, id);
    const tdb = this.o.store.tenant(ctx);
    const roleGrants = this.o.store.grants(tdb);

    // Validate every cell against the catalogue (the role editor can only give a permission a mode the catalogue allows).
    const next = new Map<string, GrantInput>();
    for (const g of input.grants) {
      const def = permissionByKey(g.permission);
      if (!def) throw new HttpError(400, "validation_failed", "Request did not pass validation", [{ path: "grants", message: `Unknown permission ${g.permission}` }]);
      if (!def.modes.includes(g.mode)) {
        throw new HttpError(400, "validation_failed", "Request did not pass validation", [{ path: "grants", message: `${g.permission} cannot be given in the ${g.mode} mode` }]);
      }
      next.set(key(g), { permission: g.permission, mode: g.mode });
    }
    const before = new Map(roleGrants.roleGrants(id).map((g) => [key(g), g] as const));
    const added = [...next.values()].filter((g) => !before.has(key(g)));
    const removed = [...before.values()].filter((g) => !next.has(key(g)));

    // You cannot grant what you do not hold (removing is always allowed, adding is checked).
    if (!caps.covers(added)) throw new HttpError(403, "cannot_grant_permission", "You can only add permissions that you hold yourself");
    const sensitive = added.filter((g) => permissionByKey(g.permission)?.sensitive);
    if (sensitive.length > 0 && !input.confirmSensitive) {
      throw new HttpError(400, "sensitive_confirmation_required", "Some of the permissions you are adding are sensitive. Confirm to continue.", {
        permissions: [...new Set(sensitive.map((g) => g.permission))],
      });
    }

    const now = this.now();
    this.o.store.transaction(() => {
      roleGrants.deleteGrants(id);
      for (const g of next.values()) roleGrants.insertGrant({ roleId: id, permission: g.permission, mode: g.mode, now });
      this.o.audit.record(tdb, ctx, {
        action: "role.permissions.update",
        entityType: "role",
        entityId: id,
        summary: `Changed the permissions of "${role.name}": ${added.length} added, ${removed.length} removed${sensitive.length > 0 ? " (including sensitive permissions)" : ""}`,
        before: { removed: removed.map(key) },
        after: { added: added.map(key), sensitiveAdded: [...new Set(sensitive.map((g) => g.permission))] },
      });
      this.assertAdministratorRemains(ctx);
    });
    return this.o.permissions.roleDetail(ctx, id);
  }

  archiveRole(auth: AuthContext, requestId: string, caps: Capabilities, id: string): void {
    this.requireOrganizationWide(caps);
    const ctx = this.ctx(auth, requestId);
    const role = this.editableRole(ctx, id);
    const tdb = this.o.store.tenant(ctx);
    const grants = this.o.store.grants(tdb);
    const holders = grants.holderCount(id, this.now());
    if (holders > 0) {
      throw new HttpError(409, "role_in_use", `${holders} ${holders === 1 ? "person holds" : "people hold"} this role. Reassign ${holders === 1 ? "them" : "them"} first, then archive it.`, { holders });
    }
    this.o.store.transaction(() => {
      grants.archiveRole(id, this.now());
      this.o.audit.record(tdb, ctx, { action: "role.archive", entityType: "role", entityId: id, summary: `Archived the role "${role.name}"` });
    });
  }

  // ---------- assignments ----------

  private scopeNames(tdb: TenantDb): Map<string, string> {
    const s = this.o.store.structure(tdb);
    return new Map<string, string>([...s.departments().map((d) => [d.id, d.name] as [string, string]), ...s.teams().map((t) => [t.id, t.name] as [string, string])]);
  }

  private view(a: { id: string; membership_id: string; role_id: string; role_name: string; scope_type: string; scope_id: string | null; valid_from: string; valid_to: string | null; revoked_at: string | null; granted_by_name: string | null }, names: Map<string, string>): AssignmentView {
    const now = this.now();
    const state: AssignmentView["state"] = a.revoked_at ? "revoked" : a.valid_from > now ? "scheduled" : a.valid_to !== null && a.valid_to < now ? "ended" : "active";
    return { id: a.id, membershipId: a.membership_id, roleId: a.role_id, roleName: a.role_name, scopeType: a.scope_type, scopeId: a.scope_id, scopeName: a.scope_id ? names.get(a.scope_id) ?? null : null, validFrom: a.valid_from, validTo: a.valid_to, revokedAt: a.revoked_at, grantedBy: a.granted_by_name, state };
  }

  listAssignments(auth: AuthContext, requestId: string, caps: Capabilities, membershipId?: string): AssignmentView[] {
    const ctx = this.ctx(auth, requestId);
    const scope = caps.scope("roles.view");
    const tdb = this.o.store.tenant(ctx);
    const names = this.scopeNames(tdb);
    return this.o.store
      .grants(tdb)
      .assignmentsFor(membershipId ?? null, this.now())
      .filter((a) => scopeContainsMember(scope, a.membership_id))
      .map((a) => this.view(a, names));
  }

  /** Gives a person a role, for the whole organization or for one department or team (stage 2.6). */
  assignRole(
    auth: AuthContext,
    requestId: string,
    caps: Capabilities,
    input: { membershipId: string; roleId: string; scopeType?: string; scopeId?: string | null; validFrom?: string; validTo?: string | null },
  ): AssignmentView {
    const ctx = this.ctx(auth, requestId);
    const tdb = this.o.store.tenant(ctx);
    const memberships = this.o.store.memberships(tdb);
    const grants = this.o.store.grants(tdb);
    const scopeType = (input.scopeType ?? "organization") as "organization" | "department" | "team";
    if (!["organization", "department", "team"].includes(scopeType)) throw new HttpError(400, "scope_not_available", "A role applies to the whole organization, one department or one team.");
    const structure = this.o.store.structure(tdb);
    let scopeId: string | null = null;
    let scopeName: string | null = null;
    const mine = caps.scope("roles.manage");
    if (scopeType === "organization") {
      if (!mine.all) throw new HttpError(403, "cannot_grant_scope", "You can give a role for a department or team you manage, not for the whole organization.");
    } else {
      if (!input.scopeId) throw new HttpError(400, "validation_failed", "Request did not pass validation", [{ path: "scopeId", message: `Choose the ${scopeType}` }]);
      const target = scopeType === "department" ? structure.department(input.scopeId) : structure.team(input.scopeId);
      if (!target) throw notFound();
      if (target.archived_at) throw new HttpError(409, "archived", `That ${scopeType} is archived.`);
      if (!(mine.all || (scopeType === "department" ? mine.departments : mine.teams).has(input.scopeId))) throw new HttpError(403, "cannot_grant_scope", `You can only give a role for a ${scopeType} you manage.`);
      scopeId = input.scopeId;
      scopeName = target.name;
    }
    const target = memberships.findById(input.membershipId);
    if (!target || target.status !== "active" || target.user_id === null || !scopeContainsMember(caps.scope("roles.manage"), target.id)) throw notFound(); // missing, another organization's, not joined (no login), or outside your scope
    const role = grants.findRole(input.roleId);
    if (!role) throw notFound();
    const roleGrants = grants.roleGrants(role.id).map((g) => ({ permission: g.permission, mode: g.mode }));
    if (!caps.covers(roleGrants)) throw new HttpError(403, "cannot_grant_role", "You can only assign a role whose permissions you hold yourself");

    const now = this.now();
    const validFrom = input.validFrom ?? now;
    const validTo = input.validTo ?? null;
    if (validTo !== null && validTo <= validFrom) throw new HttpError(400, "validation_failed", "Request did not pass validation", [{ path: "validTo", message: "The end must be after the start" }]);
    if (validTo !== null && validTo <= now) throw new HttpError(400, "validation_failed", "Request did not pass validation", [{ path: "validTo", message: "The end must be in the future" }]);
    if (grants.openAssignment(target.id, role.id, now, scopeType, scopeId)) throw new HttpError(409, "already_assigned", scopeId ? "This person already holds this role for that department or team" : "This person already holds this role");

    const id = newId();
    this.o.store.transaction(() => {
      grants.insertAssignment({ id, membershipId: target.id, roleId: role.id, scopeType, scopeId, validFrom, validTo, grantedByMembershipId: ctx.membershipId, now });
      this.o.audit.record(tdb, ctx, {
        action: "role_assignment.create",
        entityType: "role_assignment",
        entityId: id,
        summary: `Gave ${target.display_name} the role "${role.name}"${scopeName ? ` for the ${scopeType} "${scopeName}"` : ""}${validTo ? ` until ${validTo.slice(0, 10)}` : ""}`,
        after: { membershipId: target.id, roleId: role.id, scope: scopeType, scopeId, validFrom, validTo },
      });
      this.assertAdministratorRemains(ctx);
    });
    return this.view(grants.findAssignment(id)!, this.scopeNames(tdb));
  }

  revokeAssignment(auth: AuthContext, requestId: string, caps: Capabilities, id: string): AssignmentView {
    const ctx = this.ctx(auth, requestId);
    const tdb = this.o.store.tenant(ctx);
    const grants = this.o.store.grants(tdb);
    const a = grants.findAssignment(id);
    if (!a || !scopeContainsMember(caps.scope("roles.manage"), a.membership_id)) throw notFound();
    if (a.revoked_at) throw new HttpError(409, "conflict", "This role assignment was already revoked");
    // Symmetric with assigning: you cannot take away a role that carries more than you hold.
    if (!caps.covers(grants.roleGrants(a.role_id).map((g) => ({ permission: g.permission, mode: g.mode })))) {
      throw new HttpError(403, "cannot_grant_role", "You can only revoke a role whose permissions you hold yourself");
    }
    const person = this.o.store.memberships(tdb).findById(a.membership_id);
    this.o.store.transaction(() => {
      grants.revokeAssignment(id, this.now());
      this.o.audit.record(tdb, ctx, {
        action: "role_assignment.revoke",
        entityType: "role_assignment",
        entityId: id,
        summary: `Took the role "${a.role_name}" away from ${person?.display_name ?? "a person"}`,
        before: { membershipId: a.membership_id, roleId: a.role_id },
      });
      this.assertAdministratorRemains(ctx);
    });
    return this.view(grants.findAssignment(id)!, this.scopeNames(tdb));
  }

  // ---------- removing a person ----------

  /** The person leaves the organization; their login stays and they are asked to create (or join) one. */
  removePerson(auth: AuthContext, requestId: string, caps: Capabilities, membershipId: string): void {
    const ctx = this.ctx(auth, requestId);
    const tdb = this.o.store.tenant(ctx);
    const memberships = this.o.store.memberships(tdb);
    const grants = this.o.store.grants(tdb);
    const target = memberships.findById(membershipId);
    if (!target || !scopeContainsMember(caps.scope("people.manage"), target.id)) throw notFound();
    if (target.id === ctx.membershipId) throw new HttpError(409, "use_delete_account", "To leave the organization yourself, use Delete my account.");
    if (target.status !== "active" || !target.user_id) throw new HttpError(409, "conflict", "Only people who have joined can be removed. Revoke an unused invitation instead.");
    const userId = target.user_id;
    const now = this.now();
    this.o.store.transaction(() => {
      grants.revokeAllFor(target.id, now);
      memberships.detachRemoved(target.id, now);
      this.o.store.people(tdb).endEverythingFor(target.id, now.slice(0, 10)); // placements and reporting lines end today; history stays
      this.o.store.users.clearDefaultOrganization(userId, ctx.organizationId, now);
      this.o.store.sessions.detachOrganization(userId, ctx.organizationId);
      this.o.audit.record(tdb, ctx, { action: "person.remove", entityType: "membership", entityId: target.id, summary: `Removed ${target.display_name} from the organization (their login stays)` });
      this.assertAdministratorRemains(ctx);
    });
  }
}

export const PERMISSION_COUNT = PERMISSIONS.length;
