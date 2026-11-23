import type { Response } from "express";
import { z } from "zod";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { unauthenticated } from "../../lib/errors.js";
import { authOf } from "../auth/guards.js";
import type { PermissionService } from "../permissions/service.js";
import type { ChartService } from "./chartService.js";

const uuid = z.string().uuid();

/** The organization chart (stage 2.7). */
export function registerChartRoutes(registry: RouteRegistry, deps: { permissions: PermissionService; chart: ChartService }): void {
  const { permissions, chart } = deps;
  const me = (res: Response) => {
    const a = authOf(res);
    if (!a) throw unauthenticated();
    return a;
  };
  const rid = (res: Response) => String(res.locals.requestId ?? "");
  const call = <T>(res: Response, fn: (a: ReturnType<typeof me>, r: string, c: ReturnType<typeof permissions.capsOf>) => T): T => {
    res.setHeader("Cache-Control", "no-store");
    const a = me(res);
    return fn(a, rid(res), permissions.capsOf(res, a));
  };

  const day = z.string().max(10);

  registry.add({
    method: "get",
    path: "/api/hierarchy/tree",
    access: { kind: "permission", key: "org.view" },
    summary: "The chart tree. Query: `view` (`reporting` = primary reporting lines, the default; or `organization` = departments, teams, people), `root` (a person, or with `rootKind` a department or team), `depth` (levels included, default 2, at most 6), `asOf` (a day). Nodes carry `childCount` and `children` (null = ask again with that node as the root). A scoped viewer sees only their part (`partial: true`)",
    schema: { query: z.object({ view: z.enum(["reporting", "organization"]).optional(), root: uuid.optional(), rootKind: z.enum(["department", "team"]).optional(), depth: z.coerce.number().int().min(1).max(6).optional(), asOf: day.optional() }).strict() },
    handler: (_req, res, v) => {
      const q = v.query as { view?: "reporting" | "organization"; root?: string; rootKind?: "department" | "team"; depth?: number; asOf?: string };
      sendData(res, call(res, (a, r, c) => chart.tree(a, r, c, { ...q, view: q.view ?? "reporting" })));
    },
  });
}
