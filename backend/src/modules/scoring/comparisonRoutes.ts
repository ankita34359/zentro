import type { Response } from "express";
import { z } from "zod";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { HttpError, unauthenticated } from "../../lib/errors.js";
import { authOf } from "../auth/guards.js";
import type { PermissionService } from "../permissions/service.js";
import type { ComparisonService, CompareQuery } from "./comparison.js";

const uuid = z.string().uuid();
const flag = z.enum(["true", "false"]);
const cohort = {
  roleFamilyId: uuid.optional(),
  departmentId: uuid.optional(),
  minTenureDays: z.number().int().min(0).max(3650).optional(),
  includeInsufficient: z.boolean().optional(),
};

/** Peer comparison and saved comparisons (stage 5.4). */
export function registerComparisonRoutes(registry: RouteRegistry, deps: { permissions: PermissionService; comparison: ComparisonService }): void {
  const { permissions, comparison } = deps;
  const call = <T>(res: Response, fn: (a: NonNullable<ReturnType<typeof authOf>>, r: string, c: ReturnType<typeof permissions.capsOf>) => T): T => {
    res.setHeader("Cache-Control", "no-store");
    const a = authOf(res);
    if (!a) throw unauthenticated();
    return fn(a, String(res.locals.requestId ?? ""), permissions.capsOf(res, a));
  };

  registry.add({
    method: "get",
    path: "/api/performance/compare",
    access: { kind: "baseline" },
    takesEntityId: true,
    summary: "Where people stand among their peers in one period. Query: `periodId` (required), `roleFamilyId` (default: your own), `departmentId`, `subjectIds` (comma separated: compare just these people), `minTenureDays` (default 30), `includeInsufficient`. The cohort is the role family AS OF the period; different families are refused (422 cohort_mismatch). Everyone gets `you` (their own rank and percentile); named rows and other people's scores only for people inside `performance.compare` scope that the caller may also see the score of (`hiddenCount` says how many were left out). Fewer than 3 people: no rank, only raw numbers; a z-score from 8 people. Context (tenure, team size, workload, data coverage) is shown, not applied",
    schema: { query: z.object({ periodId: uuid, roleFamilyId: uuid.optional(), departmentId: uuid.optional(), subjectIds: z.string().max(2400).optional(), minTenureDays: z.coerce.number().int().min(0).max(3650).optional(), includeInsufficient: flag.optional() }).strict() },
    handler: (_req, res, v) => {
      const q = v.query as { periodId: string; roleFamilyId?: string; departmentId?: string; subjectIds?: string; minTenureDays?: number; includeInsufficient?: string };
      const ids = q.subjectIds ? q.subjectIds.split(",").map((x) => x.trim()).filter(Boolean) : [];
      for (const id of ids) if (!uuid.safeParse(id).success) throw new HttpError(400, "invalid_id", "subjectIds is a comma separated list of ids.");
      const input: CompareQuery = { periodId: q.periodId, ...(q.roleFamilyId ? { roleFamilyId: q.roleFamilyId } : {}), ...(q.departmentId ? { departmentId: q.departmentId } : {}), subjectIds: ids, ...(q.minTenureDays !== undefined ? { minTenureDays: q.minTenureDays } : {}), includeInsufficient: q.includeInsufficient === "true" };
      sendData(res, call(res, (a, r, c) => comparison.compare(a, r, c, input)));
    },
  });
  registry.add({
    method: "get",
    path: "/api/performance/compare/difference",
    access: { kind: "permission", key: "performance.compare" },
    takesEntityId: true,
    summary: "Why two people's totals differ, part by part: `?periodId&a&b`. Each part is A's points minus B's, largest first, and they add up to the difference between the totals. Both people must be inside the caller's `performance.compare` scope and their parts visible to the caller; different role families are refused (422 cohort_mismatch)",
    schema: { query: z.object({ periodId: uuid, a: uuid, b: uuid }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => comparison.difference(a, r, c, v.query as { periodId: string; a: string; b: string }))),
  });
  registry.add({
    method: "get",
    path: "/api/performance/comparisons",
    access: { kind: "permission", key: "performance.compare" },
    summary: "Saved comparisons the caller may open: their own, and all of them with `performance.compare` over everyone. Newest first",
    handler: (_req, res) => sendData(res, call(res, (a, r, c) => comparison.list(a, r, c))),
  });
  registry.add({
    method: "post",
    path: "/api/performance/comparisons",
    access: { kind: "permission", key: "performance.compare" },
    takesEntityId: true,
    summary: "Save a comparison as a snapshot that does not change when scores are recalculated: `{name, periodId, roleFamilyId?, departmentId?, subjectIds?, minTenureDays?, includeInsufficient?}`. It stores what the caller was allowed to see. Audited",
    schema: { body: z.object({ name: z.string().min(1).max(80), periodId: uuid, subjectIds: z.array(uuid).max(60).optional(), ...cohort }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => comparison.save(a, r, c, v.body as CompareQuery & { name: string })), 201),
  });
  registry.add({
    method: "get",
    path: "/api/performance/comparisons/:id",
    access: { kind: "permission", key: "performance.compare" },
    takesEntityId: true,
    summary: "One saved comparison exactly as it was saved. Not the caller's to see, missing, or another organization's: 404",
    schema: { params: z.object({ id: uuid }) },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => comparison.get(a, r, c, (v.params as { id: string }).id))),
  });
}
