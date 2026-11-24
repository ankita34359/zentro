import type { Response } from "express";
import { z } from "zod";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { unauthenticated } from "../../lib/errors.js";
import { authOf } from "../auth/guards.js";
import type { AuthService } from "../auth/service.js";
import type { AdminService } from "./admin.js";
import { SCOPE_MODES } from "./catalog.js";
import type { PermissionService } from "./service.js";

const noStore = (res: Response) => res.setHeader("Cache-Control", "no-store");

/** Reading roles (stage 2.3) and editing roles, assigning them and removing people (stage 2.4). */
export function registerRoleRoutes(registry: RouteRegistry, deps: { auth: AuthService; permissions: PermissionService; admin: AdminService }): void {
  const { auth, permissions, admin } = deps;
  const me = (res: Response) => {
    const a = authOf(res);
    if (!a) throw unauthenticated();
    return a;
  };
  const rid = (res: Response) => String(res.locals.requestId ?? "");
  const caps = (res: Response) => permissions.capsOf(res, me(res));
  const ctxOf = (res: Response) => {
    const a = authOf(res);
    if (!a) throw unauthenticated();
    return auth.tenantCtx(a, String(res.locals.requestId ?? ""));
  };

  registry.add({
    method: "get",
    path: "/api/permissions",
    access: { kind: "permission", key: "roles.view" },
    summary: "The permission catalogue: key, module, what it allows, the scope modes a role may give it, and whether it is sensitive",
    handler: (_req, res) => {
      noStore(res);
      ctxOf(res);
      sendData(res, permissions.catalog().map((p) => ({ key: p.key, module: p.module, description: p.description, modes: p.modes, sensitive: p.sensitive })));
    },
  });

  registry.add({
    method: "get",
    path: "/api/roles",
    access: { kind: "permission", key: "roles.view" },
    summary: "The organization's roles with how many permissions each grants and how many people hold it",
    handler: (_req, res) => {
      noStore(res);
      sendData(res, permissions.listRoles(ctxOf(res)));
    },
  });

  registry.add({
    method: "get",
    path: "/api/roles/:id",
    access: { kind: "permission", key: "roles.view" },
    takesEntityId: true,
    summary: "One role with its permissions and scope modes. 404 for an unknown role or another organization's role",
    schema: { params: z.object({ id: z.string().uuid() }) },
    handler: (_req, res, v) => {
      noStore(res);
      sendData(res, permissions.roleDetail(ctxOf(res), (v.params as { id: string }).id));
    },
  });

  // ---------- stage 2.4: editing roles ----------

  const uuid = z.string().uuid();
  const grant = z.object({ permission: z.string().min(3).max(80), mode: z.enum(SCOPE_MODES as unknown as [string, ...string[]]) }).strict();

  registry.add({
    method: "post",
    path: "/api/roles",
    access: { kind: "permission", key: "roles.manage" },
    summary: "Create a custom role, blank or as a copy of a role you may grant. Names are unique",
    schema: { body: z.object({ name: z.string().trim().min(2).max(60), description: z.string().trim().max(300).optional(), copyFromRoleId: uuid.optional() }).strict() },
    handler: (_req, res, v) => {
      noStore(res);
      sendData(res, admin.createRole(me(res), rid(res), caps(res), v.body as { name: string; description?: string; copyFromRoleId?: string }), 201);
    },
  });

  registry.add({
    method: "patch",
    path: "/api/roles/:id",
    access: { kind: "permission", key: "roles.manage" },
    takesEntityId: true,
    summary: "Rename a role or change its description. 403 role_protected for the Owner role; 404 for another organization's role",
    schema: { params: z.object({ id: uuid }), body: z.object({ name: z.string().trim().min(2).max(60).optional(), description: z.string().trim().max(300).optional() }).strict() },
    handler: (_req, res, v) => {
      noStore(res);
      sendData(res, admin.updateRole(me(res), rid(res), caps(res), (v.params as { id: string }).id, v.body as { name?: string; description?: string }));
    },
  });

  registry.add({
    method: "put",
    path: "/api/roles/:id/permissions",
    access: { kind: "permission", key: "roles.manage" },
    takesEntityId: true,
    summary:
      "Replace a role's permission grid: `{grants: [{permission, mode}], confirmSensitive?}`. Every cell must be a mode the catalogue allows; you can only ADD what you hold yourself (403 cannot_grant_permission); sensitive additions need confirmSensitive (400 sensitive_confirmation_required); a change that would leave nobody administering is refused (409 last_admin); audited",
    schema: { params: z.object({ id: uuid }), body: z.object({ grants: z.array(grant).max(400), confirmSensitive: z.boolean().optional() }).strict() },
    handler: (_req, res, v) => {
      noStore(res);
      const b = v.body as { grants: { permission: string; mode: (typeof SCOPE_MODES)[number] }[]; confirmSensitive?: boolean };
      sendData(res, admin.setPermissions(me(res), rid(res), caps(res), (v.params as { id: string }).id, b));
    },
  });

  registry.add({
    method: "post",
    path: "/api/roles/:id/archive",
    access: { kind: "permission", key: "roles.manage" },
    takesEntityId: true,
    summary: "Archive a role. Refused (409 role_in_use) while people hold it, and for protected roles (403 role_protected)",
    schema: { params: z.object({ id: uuid }) },
    handler: (_req, res, v) => {
      noStore(res);
      admin.archiveRole(me(res), rid(res), caps(res), (v.params as { id: string }).id);
      sendData(res, { archived: true });
    },
  });

  // ---------- stage 2.4: assigning roles ----------

  registry.add({
    method: "get",
    path: "/api/role-assignments",
    access: { kind: "permission", key: "roles.view" },
    summary: "Role assignments with their state (active, scheduled, ended, revoked); `?membershipId=` for one person",
    schema: { query: z.object({ membershipId: uuid.optional() }) },
    handler: (_req, res, v) => {
      noStore(res);
      sendData(res, admin.listAssignments(me(res), rid(res), caps(res), (v.query as { membershipId?: string }).membershipId));
    },
  });

  registry.add({
    method: "post",
    path: "/api/role-assignments",
    access: { kind: "permission", key: "roles.manage" },
    summary:
      "Give a joined person a role: `{membershipId, roleId, scopeType?: organization|department|team, scopeId?, validFrom?, validTo?}`. A department or team needs its `scopeId` (404 for another organization's, 409 archived). You can only assign a role whose permissions you hold (403 cannot_grant_role) and only at a scope you manage (403 cannot_grant_scope); audited",
    schema: {
      body: z
        .object({
          membershipId: uuid,
          roleId: uuid,
          scopeType: z.string().max(20).optional(),
          scopeId: uuid.nullable().optional(),
          validFrom: z.string().max(40).datetime({ offset: true }).optional(),
          validTo: z.string().max(40).datetime({ offset: true }).nullable().optional(),
        })
        .strict(),
    },
    handler: (_req, res, v) => {
      noStore(res);
      sendData(res, admin.assignRole(me(res), rid(res), caps(res), v.body as { membershipId: string; roleId: string; scopeType?: string; scopeId?: string | null; validFrom?: string; validTo?: string | null }), 201);
    },
  });

  registry.add({
    method: "post",
    path: "/api/role-assignments/:id/revoke",
    access: { kind: "permission", key: "roles.manage" },
    takesEntityId: true,
    summary: "Revoke a role assignment. Refused with 409 last_admin when it would leave nobody administering; audited",
    schema: { params: z.object({ id: uuid }) },
    handler: (_req, res, v) => {
      noStore(res);
      sendData(res, admin.revokeAssignment(me(res), rid(res), caps(res), (v.params as { id: string }).id));
    },
  });

  // ---------- stage 2.4: removing a person ----------

  registry.add({
    method: "post",
    path: "/api/people/:membershipId/remove",
    access: { kind: "permission", key: "people.manage" },
    takesEntityId: true,
    summary: "Remove a joined person from the organization (in the caller's scope). Their login stays; they are asked to create an organization. 409 last_admin / use_delete_account; audited",
    schema: { params: z.object({ membershipId: uuid }) },
    handler: (_req, res, v) => {
      noStore(res);
      admin.removePerson(me(res), rid(res), caps(res), (v.params as { membershipId: string }).membershipId);
      sendData(res, { removed: true });
    },
  });
}
