import type { Request, Response } from "express";
import type { TenantCtx, TenantDb } from "../../db/tenant.js";
import { HttpError, notFound, permissionDenied, unauthenticated } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import type { AuthContext } from "../auth/service.js";
import type { AuthStore } from "../auth/repositories/store.js";
import { PERMISSIONS, type PermissionDef, type ScopeMode } from "./catalog.js";
import { CREATOR_ROLE_KEY, ROLE_TEMPLATES, type RoleTemplate } from "./roleTemplates.js";
import { isEmptyScope, modesFor, noHierarchy, resolveScope, type Grant, type HierarchyProvider, type ScopeSet } from "./resolver.js";

/** What one person may do right now: their grants resolved into scope sets, computed lazily and remembered for the request. */
export class Capabilities {
  private readonly memo = new Map<string, ScopeSet>();
  constructor(
    readonly caller: string,
    private readonly grants: readonly Grant[],
    private readonly hierarchy: HierarchyProvider,
    private readonly asOf: string,
  ) {}

  /** The people, teams and departments the caller may act on for this permission. Empty means not allowed. */
  scope(key: string): ScopeSet {
    let s = this.memo.get(key);
    if (!s) {
      s = resolveScope(this.grants, key, this.caller, this.hierarchy, this.asOf);
      this.memo.set(key, s);
    }
    return s;
  }
  has(key: string): boolean {
    return !isEmptyScope(this.scope(key));
  }
  /** The modes granted for the permission (raw grants). */
  modes(key: string): ScopeMode[] {
    return modesFor(this.grants, key);
  }
  /** `{ key: [modes] }` for every permission with a non-empty scope set: what `me.capabilities` returns. */
  toMap(): Record<string, ScopeMode[]> {
    const out: Record<string, ScopeMode[]> = {};
    for (const key of new Set(this.grants.map((g) => g.permission))) if (this.has(key)) out[key] = this.modes(key);
    return out;
  }
  /** Can this person hand out `grants` ("you cannot grant what you do not hold", docs/permission-model.md section 6)? */
  covers(grants: readonly { permission: string; mode: ScopeMode }[]): boolean {
    return grants.every((g) => {
      if (!this.has(g.permission)) return false;
      const held = this.modes(g.permission);
      return held.includes("all_in_scope") || held.includes(g.mode) || (g.mode === "own" && (held.includes("reports") || held.includes("my_teams")));
    });
  }
}

export interface RoleView {
  id: string;
  key: string;
  name: string;
  description: string;
  kind: string;
  /** Protected roles are view only: they cannot be edited or archived. */
  isProtected: boolean;
  permissionCount: number;
  holderCount: number;
}
export interface RoleDetail extends RoleView {
  permissions: { key: string; module: string; description: string; sensitive: boolean; modes: ScopeMode[]; allowedModes: readonly ScopeMode[] }[];
}

const CAPS_KEY = "capabilities";

export class PermissionService {
  constructor(
    private readonly store: AuthStore,
    /** Builds the hierarchy for the caller's organization (stage 2.6: the real tables; tests may return a fake). */
    private readonly hierarchyFor: (tdb: TenantDb) => HierarchyProvider = () => noHierarchy,
    private readonly clock: () => number = Date.now,
  ) {}

  private iso = (): string => new Date(this.clock()).toISOString();

  /** Loads the caller's active grants and resolves them. */
  capabilities(auth: AuthContext): Capabilities {
    if (!auth.organizationId || !auth.membershipId) return new Capabilities(auth.membershipId ?? "", [], noHierarchy, this.iso());
    const tdb = this.store.tenant({ userId: auth.userId, membershipId: auth.membershipId, organizationId: auth.organizationId, sessionId: auth.sessionId, requestId: "" });
    const now = this.iso();
    return new Capabilities(auth.membershipId, this.store.grants(tdb).grantsFor(auth.membershipId, now), this.hierarchyFor(tdb), now);
  }

  /** The route guard: the caller must hold the permission with a non-empty scope set. Memoized per request. */
  authorize = (_req: Request, res: Response, key: string): void => {
    const auth = res.locals.auth as AuthContext | undefined;
    if (!auth) throw unauthenticated();
    const caps = this.capsOf(res, auth);
    if (!caps.has(key)) throw permissionDenied();
  };

  /** The request's capabilities (loaded once). */
  capsOf(res: Response, auth: AuthContext): Capabilities {
    let caps = res.locals[CAPS_KEY] as Capabilities | undefined;
    if (!caps) {
      caps = this.capabilities(auth);
      res.locals[CAPS_KEY] = caps;
    }
    return caps;
  }

  // ---------- seeding ----------

  /** Creates the nine templates and their grants for an organization. Returns role ids by template key. Used inside the organization-creation transaction. */
  seedTemplates(tdb: TenantDb, now: string): Map<string, string> {
    const ids = new Map<string, string>();
    for (const t of ROLE_TEMPLATES) ids.set(t.key, this.insertTemplate(tdb, t, now));
    return ids;
  }

  private insertTemplate(tdb: TenantDb, t: RoleTemplate, now: string): string {
    const grants = this.store.grants(tdb);
    const id = newId();
    grants.insertRole({ id, key: t.key, name: t.name, description: t.description, now, kind: "template", isProtected: t.key === CREATOR_ROLE_KEY });
    for (const [permission, mode] of this.templateGrants(t)) grants.insertGrant({ roleId: id, permission, mode, now });
    return id;
  }

  /** The Owner template is every permission at all_in_scope; the others list their grants. */
  templateGrants(t: RoleTemplate): [string, ScopeMode][] {
    if (t.key === CREATOR_ROLE_KEY) return PERMISSIONS.map((p) => [p.key, "all_in_scope"] as [string, ScopeMode]);
    return Object.entries(t.grants).flatMap(([permission, modes]) => modes.map((m) => [permission, m] as [string, ScopeMode]));
  }

  /**
   * Start-up step after the migrations: every organization gets the template roles it is missing (the migration only
   * back-filled Owner). It creates roles that do not exist; it never touches a role that does, so an organization's
   * later edits are never undone. Idempotent.
   */
  ensureRoleTemplates(): { organizations: number; rolesCreated: number } {
    let rolesCreated = 0;
    const orgIds = this.store.orgs.listIds();
    for (const organizationId of orgIds) {
      const tdb = this.store.tenant({ userId: "", membershipId: "", organizationId, sessionId: "", requestId: "" });
      const have = new Set(this.store.grants(tdb).roleKeys());
      const now = this.iso();
      this.store.transaction(() => {
        for (const t of ROLE_TEMPLATES) {
          if (have.has(t.key)) continue;
          this.insertTemplate(tdb, t, now);
          rolesCreated += 1;
        }
      });
    }
    return { organizations: orgIds.length, rolesCreated };
  }

  /** Makes sure the global catalogue table matches the code (a no-op when the migration already inserted it). */
  syncCatalog(): void {
    for (const p of PERMISSIONS) this.store.permissions.insert({ key: p.key, module: p.module, description: p.description, modes: JSON.stringify(p.modes), sensitive: p.sensitive ? 1 : 0 });
  }

  // ---------- reading roles ----------

  private tdb(ctx: TenantCtx): TenantDb {
    return this.store.tenant(ctx);
  }

  catalog(): (PermissionDef & { modes: readonly ScopeMode[] })[] {
    return [...PERMISSIONS];
  }

  listRoles(ctx: TenantCtx): RoleView[] {
    return this.store.grants(this.tdb(ctx)).listRoles(this.iso()).map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      kind: r.kind,
      isProtected: r.is_protected === 1,
      permissionCount: new Set(this.store.grants(this.tdb(ctx)).roleGrants(r.id).map((g) => g.permission)).size,
      holderCount: r.holder_count,
    }));
  }

  roleDetail(ctx: TenantCtx, id: string): RoleDetail {
    const grants = this.store.grants(this.tdb(ctx));
    const role = grants.findRole(id);
    if (!role) throw notFound(); // another organization's role looks exactly like a missing one
    const rows = grants.roleGrants(id);
    const byKey = new Map<string, ScopeMode[]>();
    for (const g of rows) byKey.set(g.permission, [...(byKey.get(g.permission) ?? []), g.mode]);
    const holder = grants.listRoles(this.iso()).find((r) => r.id === id);
    return {
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      kind: role.kind,
      isProtected: role.is_protected === 1,
      permissionCount: byKey.size,
      holderCount: holder?.holder_count ?? 0,
      permissions: PERMISSIONS.filter((p) => byKey.has(p.key)).map((p) => ({
        key: p.key,
        module: p.module,
        description: p.description,
        sensitive: p.sensitive,
        modes: byKey.get(p.key)!,
        allowedModes: p.modes,
      })),
    };
  }

  /** The grants of a role of this organization, for the "cannot grant what you do not hold" check. Throws 404 for an unknown or foreign role. */
  roleGrantsFor(ctx: TenantCtx, roleId: string): { permission: string; mode: ScopeMode }[] {
    const grants = this.store.grants(this.tdb(ctx));
    if (!grants.findRole(roleId)) throw notFound();
    return grants.roleGrants(roleId);
  }

  /** Throws 409 if removing `membershipId` would leave nobody who can administer the organization. */
  assertNotLastAdministrator(ctx: TenantCtx, membershipId: string): void {
    const admins = this.store.grants(this.tdb(ctx)).administratorIds(this.iso());
    if (admins.includes(membershipId) && admins.length === 1) {
      throw new HttpError(409, "last_admin", "You are the last administrator. Make someone else an administrator first, or delete the whole organization by being its only member.");
    }
  }

  administratorIdsFor(ctx: TenantCtx): string[] {
    return this.store.grants(this.tdb(ctx)).administratorIds(this.iso());
  }
}
