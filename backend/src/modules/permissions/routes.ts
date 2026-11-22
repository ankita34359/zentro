import type { Response } from "express";
import { z } from "zod";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { unauthenticated } from "../../lib/errors.js";
import { authOf } from "../auth/guards.js";
import type { AuthService } from "../auth/service.js";
import type { PermissionService } from "./service.js";

const noStore = (res: Response) => res.setHeader("Cache-Control", "no-store");

/** Read-only in stage 2.3 (the role editor is stage 2.4). */
export function registerRoleRoutes(registry: RouteRegistry, deps: { auth: AuthService; permissions: PermissionService }): void {
  const { auth, permissions } = deps;
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
}
