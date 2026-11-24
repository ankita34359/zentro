import type { Response } from "express";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { unauthenticated } from "../../lib/errors.js";
import { authOf } from "../auth/guards.js";
import type { PermissionService } from "../permissions/service.js";
import type { DashboardService } from "./service.js";

/** Team Performance, Leadership, rule-based insights and integrations status: first, read-only versions (batch G). */
export function registerDashboardRoutes(registry: RouteRegistry, deps: { permissions: PermissionService; dashboards: DashboardService }): void {
  const { permissions, dashboards } = deps;
  const call = <T>(res: Response, fn: (a: NonNullable<ReturnType<typeof authOf>>, r: string, c: ReturnType<typeof permissions.capsOf>) => T): T => {
    res.setHeader("Cache-Control", "no-store");
    const a = authOf(res);
    if (!a) throw unauthenticated();
    return fn(a, String(res.locals.requestId ?? ""), permissions.capsOf(res, a));
  };
  registry.add({
    method: "get",
    path: "/api/team-performance",
    access: { kind: "baseline" },
    summary: "One card per team the caller can see: everyone may call it, and it returns only teams inside their `org.view` scope (an empty list when they have none) (their own teams, or the teams of their department, or all): members (named only where `people.view` allows, the rest counted), team objectives with health, KPI status for the team and its members, and task progress (open, overdue, blocked, done). A section the caller has no permission for (`okr.view`, `kpi.view`, `task.view`) is null",
    handler: (_req, res) => sendData(res, call(res, (a, r, c) => dashboards.teamPerformance(a, r, c))),
  });
  registry.add({
    method: "get",
    path: "/api/leadership/overview",
    access: { kind: "permission", key: "leadership.view" },
    summary: "Company objectives with health and attainment and the department and team objectives that contribute to each (from the alignment links), risks (behind pace, overdue, no data) and KPI health counts. Only with `leadership.view` over everyone",
    handler: (_req, res) => sendData(res, call(res, (a, r, c) => dashboards.leadership(a, r, c))),
  });
  registry.add({
    method: "get",
    path: "/api/ai/insights",
    access: { kind: "permission", key: "ai.view_insights" },
    summary: "Insights computed by plain rules from data the caller may already see (objectives behind pace or with no data, overdue tasks, KPI series with missing months, scores with low confidence), each with its numbers and a link to the page behind it. Calls NO AI model; `ask.enabled` is false until a provider is connected",
    handler: (_req, res) => sendData(res, call(res, (a, r, c) => dashboards.insights(a, r, c))),
  });
  registry.add({
    method: "get",
    path: "/api/integrations/status",
    access: { kind: "permission", key: "integrations.view" },
    summary: "viaSocket status (always 'Not connected' in this version), whether each required setting is set (names and yes/no only, never a value), the events Zentro records and how many of each in the last 30 days, and the steps to connect",
    handler: (_req, res) => sendData(res, call(res, (a) => dashboards.integrations(a, String(res.locals.requestId ?? "")))),
  });
}
