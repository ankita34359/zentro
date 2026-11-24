import type { Response } from "express";
import { z } from "zod";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { unauthenticated } from "../../lib/errors.js";
import { authOf } from "../auth/guards.js";
import type { AuthService } from "../auth/service.js";
import type { AuditService } from "./service.js";

const iso = z.string().max(40).datetime({ offset: true }).optional();

export function registerAuditRoutes(registry: RouteRegistry, deps: { auth: AuthService; audit: AuditService }): void {
  registry.add({
    method: "get",
    path: "/api/audit-logs",
    access: { kind: "permission", key: "audit.view" },
    summary: "The audit log, newest first, read only. Filters: actorId (membership), entityType, entityId, action, from, to; paged with `cursor`",
    schema: {
      query: z.object({
        actorId: z.string().uuid().optional(),
        entityType: z.string().max(60).optional(),
        entityId: z.string().max(80).optional(),
        action: z.string().max(80).optional(),
        from: iso,
        to: iso,
        limit: z.coerce.number().int().min(1).max(100).optional(),
        cursor: z.string().max(300).optional(),
      }),
    },
    handler: (_req, res: Response, v) => {
      const a = authOf(res);
      if (!a) throw unauthenticated();
      res.setHeader("Cache-Control", "no-store");
      const q = v.query as { actorId?: string; entityType?: string; entityId?: string; action?: string; from?: string; to?: string; limit?: number; cursor?: string };
      const ctx = deps.auth.tenantCtx(a, String(res.locals.requestId ?? ""));
      const r = deps.audit.list(ctx, q);
      sendData(res, r.entries, 200, { limit: q.limit ?? 50, nextCursor: r.nextCursor });
    },
  });
}
