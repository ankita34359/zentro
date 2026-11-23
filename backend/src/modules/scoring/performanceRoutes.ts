import type { Response } from "express";
import { z } from "zod";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { unauthenticated } from "../../lib/errors.js";
import { authOf } from "../auth/guards.js";
import type { PermissionService } from "../permissions/service.js";
import { PERIOD_TYPES, type PerformanceService } from "./performance.js";

const uuid = z.string().uuid();
const day = z.string().max(10);
const idParams = z.object({ id: uuid });

/** Periods, scorecards, score runs and verification (stage 5.2). */
export function registerPerformanceRoutes(registry: RouteRegistry, deps: { permissions: PermissionService; performance: PerformanceService }): void {
  const { permissions, performance } = deps;
  const call = <T>(res: Response, fn: (a: NonNullable<ReturnType<typeof authOf>>, r: string, c: ReturnType<typeof permissions.capsOf>) => T): T => {
    res.setHeader("Cache-Control", "no-store");
    const a = authOf(res);
    if (!a) throw unauthenticated();
    return fn(a, String(res.locals.requestId ?? ""), permissions.capsOf(res, a));
  };
  const id = (v: { params: unknown }) => (v.params as { id: string }).id;

  registry.add({
    method: "get",
    path: "/api/performance/periods",
    access: { kind: "baseline" },
    summary: "Performance periods (month, quarter, year or custom), newest first, each open, closed or locked, with how many scorecards the caller may open. Everyone may read their own scores (a baseline right); others' scores need `performance.view_scores` in scope",
    handler: (_req, res) => sendData(res, call(res, (a, r, c) => performance.periods(a, r, c))),
  });
  registry.add({
    method: "post",
    path: "/api/performance/periods",
    access: { kind: "permission", key: "performance.manage_periods" },
    summary: "Create a period: `{name, periodType?: month|quarter|year|custom, startDate, endDate}` (the end is the last day, inclusive). 409 name_taken. Audited",
    schema: { body: z.object({ name: z.string().min(1).max(60), periodType: z.enum(PERIOD_TYPES).optional(), startDate: day, endDate: day }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => performance.createPeriod(a, r, c, v.body as Parameters<PerformanceService["createPeriod"]>[3])), 201),
  });
  registry.add({
    method: "patch",
    path: "/api/performance/periods/:id",
    access: { kind: "permission", key: "performance.manage_periods" },
    takesEntityId: true,
    summary: "Rename a period or change its dates `{name?, startDate?, endDate?}`; only while it is open (409 period_closed). Audited with before and after",
    schema: { params: idParams, body: z.object({ name: z.string().min(1).max(60).optional(), startDate: day.optional(), endDate: day.optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => performance.updatePeriod(a, r, c, id(v), v.body as Parameters<PerformanceService["updatePeriod"]>[4]))),
  });
  registry.add({
    method: "get",
    path: "/api/performance/scorecards",
    access: { kind: "baseline" },
    summary: "The scorecards of a period (required `periodId`) the caller may see: their own always, others inside `performance.view_scores`. Each has the latest run's total (null when there is not enough data), status (final, provisional, insufficient), band, confidence and the model used. `?search` filters by name",
    schema: { query: z.object({ periodId: uuid, search: z.string().max(100).optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => performance.scorecards(a, r, c, v.query as { periodId: string; search?: string }))),
  });
  registry.add({
    method: "get",
    path: "/api/performance/scorecards/for",
    access: { kind: "baseline" },
    takesEntityId: true,
    summary: "One person's scorecard for a period: `?periodId` and `?subjectId` (default: the caller). The latest run with what it is made of, and the list of every run. 404 when there is none or it is not the caller's to see",
    schema: { query: z.object({ periodId: uuid, subjectId: uuid.optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => performance.scorecardFor(a, r, c, v.query as { periodId: string; subjectId?: string }))),
  });
  registry.add({
    method: "post",
    path: "/api/performance/scorecards/recalculate",
    access: { kind: "permission", key: "performance.recalculate" },
    takesEntityId: true,
    summary: "Calculate scores for a period: `{periodId, subjectId?}`. One person (inside the caller's `performance.recalculate` scope), or everyone in scope (at most 400). A new run is stored only when the inputs or the outcome changed; earlier runs stay. Returns how many runs were new and how many unchanged. Audited",
    schema: { body: z.object({ periodId: uuid, subjectId: uuid.optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => performance.recalculate(a, r, c, v.body as { periodId: string; subjectId?: string }, "manual"))),
  });
  registry.add({
    method: "get",
    path: "/api/performance/scorecards/:id",
    access: { kind: "baseline" },
    takesEntityId: true,
    summary: "A scorecard with its latest run and every run (the score-change history). Not visible or another organization's: 404",
    schema: { params: idParams },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => performance.scorecard(a, r, c, id(v)))),
  });
  registry.add({
    method: "get",
    path: "/api/performance/scores/:id",
    access: { kind: "baseline" },
    takesEntityId: true,
    summary: "One score run: total, status, confidence and, for the person themself or anyone with `performance.view_components` over them, every component with the records behind it and the plain-words explanation (formula, reasons, data quality, what would change it). Others get the total only (`componentsHidden`)",
    schema: { params: idParams },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => performance.score(a, r, c, id(v)))),
  });
  registry.add({
    method: "post",
    path: "/api/performance/scores/:id/verify",
    access: { kind: "baseline" },
    takesEntityId: true,
    summary: "Recompute a run from the inputs and the model it stored, with the same pure engine: `{matches, expected, actual, mismatches}`. The person themself or anyone with `performance.view_components` over them (403 otherwise). Changes nothing",
    schema: { params: idParams },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => performance.verify(a, r, c, id(v)))),
  });
}
