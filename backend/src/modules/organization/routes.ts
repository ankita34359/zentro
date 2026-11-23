import type { Response } from "express";
import { z } from "zod";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { unauthenticated } from "../../lib/errors.js";
import { authOf } from "../auth/guards.js";
import type { AuthService } from "../auth/service.js";
import type { PermissionService } from "../permissions/service.js";
import type { StructureService } from "./service.js";

const noStore = (res: Response) => res.setHeader("Cache-Control", "no-store");
const uuid = z.string().uuid();
const name = z.string().min(1).max(200); // the service trims and checks the real limit (80) with a clear message
const description = z.string().max(600).optional();
const idParams = z.object({ id: uuid });

/** Departments, teams, role families and designations (stage 2.5), plus renaming the organization. */
export function registerStructureRoutes(registry: RouteRegistry, deps: { auth: AuthService; permissions: PermissionService; structure: StructureService }): void {
  const { permissions, structure } = deps;
  const me = (res: Response) => {
    const a = authOf(res);
    if (!a) throw unauthenticated();
    return a;
  };
  const rid = (res: Response) => String(res.locals.requestId ?? "");
  const caps = (res: Response) => permissions.capsOf(res, me(res));
  const call = <T>(res: Response, fn: (a: ReturnType<typeof me>, r: string, c: ReturnType<typeof caps>) => T): T => {
    noStore(res);
    return fn(me(res), rid(res), caps(res));
  };

  registry.add({
    method: "get",
    path: "/api/organization/structure",
    access: { kind: "permission", key: "org.view" },
    summary: "The whole structure in one call: departments, teams (with sub-teams), role families and designations, archived ones marked. A viewer whose `org.view` is scoped sees only their part (`partial: true`)",
    handler: (_req, res) => sendData(res, call(res, (a, r, c) => structure.view(a, r, c))),
  });

  registry.add({
    method: "patch",
    path: "/api/organization",
    access: { kind: "permission", key: "org.settings" },
    summary: "Rename the organization: `{name}` (1 to 80 characters). Audited",
    schema: { body: z.object({ name }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => structure.renameOrganization(a, r, c, (v.body as { name: string }).name))),
  });

  // ----- departments -----
  registry.add({
    method: "post",
    path: "/api/departments",
    access: { kind: "permission", key: "org.manage" },
    summary: "Create a department: `{name, description?, parentId?}`. At most 8 levels (400 depth_exceeded); a name is unique among active siblings (409 name_taken); an archived parent is refused (409 parent_archived). Audited",
    schema: { body: z.object({ name, description, parentId: uuid.nullable().optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => structure.createDepartment(a, r, c, v.body as { name: string; description?: string; parentId?: string | null })), 201),
  });
  registry.add({
    method: "patch",
    path: "/api/departments/:id",
    access: { kind: "permission", key: "org.manage" },
    takesEntityId: true,
    summary: "Rename, describe or move a department: `{name?, description?, parentId?}` (`parentId: null` = top level). A department cannot move under itself or its own sub-departments (409 would_create_cycle). Audited",
    schema: { params: idParams, body: z.object({ name: name.optional(), description, parentId: uuid.nullable().optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => structure.updateDepartment(a, r, c, (v.params as { id: string }).id, v.body as { name?: string; description?: string; parentId?: string | null }))),
  });
  registry.add({
    method: "post",
    path: "/api/departments/:id/archive",
    access: { kind: "permission", key: "org.manage" },
    takesEntityId: true,
    summary: "Archive a department. Refused while it has active sub-departments or teams (409 has_active_children). Nothing is deleted",
    schema: { params: idParams },
    handler: (_req, res, v) => {
      call(res, (a, r, c) => structure.archiveDepartment(a, r, c, (v.params as { id: string }).id));
      sendData(res, { archived: true });
    },
  });
  registry.add({
    method: "post",
    path: "/api/departments/:id/restore",
    access: { kind: "permission", key: "org.manage" },
    takesEntityId: true,
    summary: "Restore an archived department (needs an active parent and a free name)",
    schema: { params: idParams },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => structure.restoreDepartment(a, r, c, (v.params as { id: string }).id))),
  });

  // ----- teams -----
  registry.add({
    method: "post",
    path: "/api/teams",
    access: { kind: "permission", key: "org.manage" },
    summary: "Create a team or sub-team: `{name, description?, departmentId, parentTeamId?}`. A sub-team shares its parent's department (400 wrong_department); at most 8 levels; name unique among active siblings. Audited",
    schema: { body: z.object({ name, description, departmentId: uuid, parentTeamId: uuid.nullable().optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => structure.createTeam(a, r, c, v.body as { name: string; description?: string; departmentId: string; parentTeamId?: string | null })), 201),
  });
  registry.add({
    method: "patch",
    path: "/api/teams/:id",
    access: { kind: "permission", key: "org.manage" },
    takesEntityId: true,
    summary: "Rename, describe or move a team: `{name?, description?, departmentId?, parentTeamId?}`. Moving to another department takes its sub-teams along; without `parentTeamId` it becomes top-level there. Audited",
    schema: { params: idParams, body: z.object({ name: name.optional(), description, departmentId: uuid.optional(), parentTeamId: uuid.nullable().optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => structure.updateTeam(a, r, c, (v.params as { id: string }).id, v.body as { name?: string; description?: string; departmentId?: string; parentTeamId?: string | null }))),
  });
  registry.add({
    method: "post",
    path: "/api/teams/:id/archive",
    access: { kind: "permission", key: "org.manage" },
    takesEntityId: true,
    summary: "Archive a team. Refused while it has active sub-teams (409 has_active_children)",
    schema: { params: idParams },
    handler: (_req, res, v) => {
      call(res, (a, r, c) => structure.archiveTeam(a, r, c, (v.params as { id: string }).id));
      sendData(res, { archived: true });
    },
  });
  registry.add({
    method: "post",
    path: "/api/teams/:id/restore",
    access: { kind: "permission", key: "org.manage" },
    takesEntityId: true,
    summary: "Restore an archived team (needs an active department and parent team, and a free name)",
    schema: { params: idParams },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => structure.restoreTeam(a, r, c, (v.params as { id: string }).id))),
  });

  // ----- role families -----
  registry.add({
    method: "post",
    path: "/api/role-families",
    access: { kind: "permission", key: "org.manage" },
    summary: "Create a role family: `{name, description?}`. Audited",
    schema: { body: z.object({ name, description }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => structure.createRoleFamily(a, r, c, v.body as { name: string; description?: string })), 201),
  });
  registry.add({
    method: "patch",
    path: "/api/role-families/:id",
    access: { kind: "permission", key: "org.manage" },
    takesEntityId: true,
    summary: "Rename or describe a role family: `{name?, description?}`",
    schema: { params: idParams, body: z.object({ name: name.optional(), description }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => structure.updateRoleFamily(a, r, c, (v.params as { id: string }).id, v.body as { name?: string; description?: string }))),
  });
  registry.add({
    method: "post",
    path: "/api/role-families/:id/archive",
    access: { kind: "permission", key: "org.manage" },
    takesEntityId: true,
    summary: "Archive a role family. Refused while it has active designations (409 has_active_children)",
    schema: { params: idParams },
    handler: (_req, res, v) => {
      call(res, (a, r, c) => structure.archiveRoleFamily(a, r, c, (v.params as { id: string }).id));
      sendData(res, { archived: true });
    },
  });
  registry.add({
    method: "post",
    path: "/api/role-families/:id/restore",
    access: { kind: "permission", key: "org.manage" },
    takesEntityId: true,
    summary: "Restore an archived role family",
    schema: { params: idParams },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => structure.restoreRoleFamily(a, r, c, (v.params as { id: string }).id))),
  });

  // ----- designations -----
  registry.add({
    method: "post",
    path: "/api/designations",
    access: { kind: "permission", key: "org.manage" },
    summary: "Create a designation: `{name, description?, roleFamilyId?}`. Audited",
    schema: { body: z.object({ name, description, roleFamilyId: uuid.nullable().optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => structure.createDesignation(a, r, c, v.body as { name: string; description?: string; roleFamilyId?: string | null })), 201),
  });
  registry.add({
    method: "patch",
    path: "/api/designations/:id",
    access: { kind: "permission", key: "org.manage" },
    takesEntityId: true,
    summary: "Rename, describe or change the role family of a designation: `{name?, description?, roleFamilyId?}`",
    schema: { params: idParams, body: z.object({ name: name.optional(), description, roleFamilyId: uuid.nullable().optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => structure.updateDesignation(a, r, c, (v.params as { id: string }).id, v.body as { name?: string; description?: string; roleFamilyId?: string | null }))),
  });
  registry.add({
    method: "post",
    path: "/api/designations/:id/archive",
    access: { kind: "permission", key: "org.manage" },
    takesEntityId: true,
    summary: "Archive a designation",
    schema: { params: idParams },
    handler: (_req, res, v) => {
      call(res, (a, r, c) => structure.archiveDesignation(a, r, c, (v.params as { id: string }).id));
      sendData(res, { archived: true });
    },
  });
  registry.add({
    method: "post",
    path: "/api/designations/:id/restore",
    access: { kind: "permission", key: "org.manage" },
    takesEntityId: true,
    summary: "Restore an archived designation (its role family must be active)",
    schema: { params: idParams },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => structure.restoreDesignation(a, r, c, (v.params as { id: string }).id))),
  });
}
