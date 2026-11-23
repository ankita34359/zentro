import type { Response } from "express";
import { z } from "zod";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { unauthenticated } from "../../lib/errors.js";
import { authOf } from "../auth/guards.js";
import type { PermissionService } from "../permissions/service.js";
import type { MeasurementInput, MeasurementService } from "./measurements.js";

const uuid = z.string().uuid();
const day = z.string().max(10);
const idParams = z.object({ id: uuid });

/** KPI overview, measurements and history (stage 3.4). Registered BEFORE the `:id` routes of 3.3 so `overview` is not read as an id. */
export function registerMeasurementRoutes(registry: RouteRegistry, deps: { permissions: PermissionService; measurements: MeasurementService }): void {
  const { permissions, measurements } = deps;
  const call = <T>(res: Response, fn: (a: NonNullable<ReturnType<typeof authOf>>, r: string, c: ReturnType<typeof permissions.capsOf>) => T): T => {
    res.setHeader("Cache-Control", "no-store");
    const a = authOf(res);
    if (!a) throw unauthenticated();
    return fn(a, String(res.locals.requestId ?? ""), permissions.capsOf(res, a));
  };
  const id = (v: { params: unknown }) => (v.params as { id: string }).id;

  registry.add({
    method: "get",
    path: "/api/kpis/overview",
    access: { kind: "permission", key: "kpi.view" },
    summary: "KPI health across the series the caller may see (a series is one KPI for one person, team, department or the organization): counts by status (no_data, ok, excellent, warning, critical), missing periods, coverage per KPI, and a short `attention` list (critical and warning first, then those with missing periods). Nothing the caller cannot see is counted",
    handler: (_req, res) => sendData(res, call(res, (a, r, c) => measurements.overview(a, r, c))),
  });
  registry.add({
    method: "get",
    path: "/api/kpis/:id/subjects",
    access: { kind: "permission", key: "kpi.view" },
    takesEntityId: true,
    summary: "The people, teams, departments (and organization total) that have this KPI or have values for it, limited to what the caller may see, each with its status, missing periods and whether the caller may record for it",
    schema: { params: idParams },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => measurements.subjects(a, r, c, id(v)))),
  });
  registry.add({
    method: "get",
    path: "/api/kpis/:id/history",
    access: { kind: "permission", key: "kpi.view" },
    takesEntityId: true,
    summary: "The values of one KPI for one subject, period by period: `?subject=person:<id>|team:<id>|department:<id>|organization` (required), `from`, `to`. Each period is `recorded`, `missing` (the period ended with no value: never zero), `open` or `not_expected`, with its current value, attainment, threshold level and every row (corrections stay visible, the current one flagged). Also the threshold lines in the KPI's unit, coverage and the number of missing periods. A subject the caller may not see: 404",
    schema: { params: idParams, query: z.object({ subject: z.string().min(1).max(80), from: day.optional(), to: day.optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => measurements.history(a, r, c, id(v), v.query as { subject: string; from?: string; to?: string }))),
  });
  registry.add({
    method: "post",
    path: "/api/kpis/:id/measurements",
    access: { kind: "permission", key: "kpi.record" },
    takesEntityId: true,
    summary: "Record a value: `{subject: {type: person|team|department|organization, id?}, periodStart, value, valueStatus?: recorded|estimated|disputed, note?, supersedes?}`. `periodStart` is the first day of a period of the KPI's frequency (400 invalid_period; a future period 400 future_period). NEVER overwrites: a second value for the same period is 409 period_recorded unless `supersedes` names the current row, and a correction needs a `note` (400 reason_required; 409 not_current). Needs `kpi.record` over the subject (403 outside_scope; the organization total needs it over everyone); a subject the caller cannot see is 404. Checks the thresholds, writes a `kpi.measurement_recorded` event, tells the right people about a warning or critical value (once), and is audited. Returns the updated history",
    schema: { params: idParams, body: z.object({ subject: z.object({ type: z.enum(["person", "team", "department", "organization"]), id: uuid.optional() }).strict(), periodStart: day, value: z.number(), valueStatus: z.enum(["recorded", "estimated", "disputed"]).optional(), note: z.string().max(1000).optional(), supersedes: uuid.optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => measurements.record(a, r, c, id(v), v.body as MeasurementInput)), 201),
  });
}
