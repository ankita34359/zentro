import type { Response } from "express";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { unauthenticated } from "../../lib/errors.js";
import { authOf } from "../auth/guards.js";
import type { PermissionService } from "../permissions/service.js";
import type { OverviewService } from "./service.js";

/** The Overview page's data (stage 6.1). */
export function registerOverviewRoutes(registry: RouteRegistry, deps: { permissions: PermissionService; overview: OverviewService }): void {
  const me = (res: Response) => {
    const a = authOf(res);
    if (!a) throw unauthenticated();
    res.setHeader("Cache-Control", "no-store");
    return a;
  };
  registry.add({
    method: "get",
    path: "/api/overview",
    access: { kind: "baseline" },
    summary: "The Overview widgets, counted from real rows and adapted to what the caller may see: `personal` (their own work) always; `team` when their scope reaches other people; `organization` when it reaches everyone; the getting-started `checklist` (ticks when real data exists) and demo flags. A person with no role gets their own (empty) work only",
    handler: (_req, res) => {
      const a = me(res);
      sendData(res, deps.overview.get(a, String(res.locals.requestId ?? ""), deps.permissions.capsOf(res, a)));
    },
  });
}
