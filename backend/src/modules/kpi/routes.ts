import type { Response } from "express";
import { z } from "zod";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { unauthenticated } from "../../lib/errors.js";
import { authOf } from "../auth/guards.js";
import type { PermissionService } from "../permissions/service.js";
import { AGGREGATIONS, BASES, CATEGORIES, COMPARATORS, DIRECTIONS, FREQUENCIES, LEVELS, VALUE_TYPES, type AssignmentInput, type KpiInput, type KpiService } from "./service.js";

const uuid = z.string().uuid();
const day = z.string().max(10);
const idParams = z.object({ id: uuid });
const flag = z.enum(["true", "false"]);

/** KPI definitions, assignments and thresholds (stage 3.3). */
export function registerKpiRoutes(registry: RouteRegistry, deps: { permissions: PermissionService; kpis: KpiService }): void {
  const { permissions, kpis } = deps;
  const call = <T>(res: Response, fn: (a: NonNullable<ReturnType<typeof authOf>>, r: string, c: ReturnType<typeof permissions.capsOf>) => T): T => {
    res.setHeader("Cache-Control", "no-store");
    const a = authOf(res);
    if (!a) throw unauthenticated();
    return fn(a, String(res.locals.requestId ?? ""), permissions.capsOf(res, a));
  };
  const id = (v: { params: unknown }) => (v.params as { id: string }).id;
  const body = {
    key: z.string().min(1).max(40).optional(),
    name: z.string().min(1).max(80),
    description: z.string().max(1000).optional(),
    category: z.enum(CATEGORIES).optional(),
    unit: z.string().max(20).nullable().optional(),
    valueType: z.enum(VALUE_TYPES).optional(),
    direction: z.enum(DIRECTIONS).optional(),
    frequency: z.enum(FREQUENCIES).optional(),
    aggregation: z.enum(AGGREGATIONS).optional(),
    defaultTarget: z.number().min(-1e12).max(1e12).nullable().optional(),
    defaultTargetMax: z.number().min(-1e12).max(1e12).nullable().optional(),
  };

  registry.add({
    method: "get",
    path: "/api/kpis",
    access: { kind: "permission", key: "kpi.view" },
    summary: "KPI definitions. Anyone holding `kpi.view` sees every definition; each carries `assignmentCount`, the active assignments the caller may see. Query: `category`, `frequency`, `search`, `assignedToMe`, `includeArchived` (needs `kpi.configure`)",
    schema: { query: z.object({ category: z.enum(CATEGORIES).optional(), frequency: z.enum(FREQUENCIES).optional(), search: z.string().max(100).optional(), assignedToMe: flag.optional(), includeArchived: flag.optional() }).strict() },
    handler: (_req, res, v) => {
      const q = v.query as { category?: string; frequency?: string; search?: string; assignedToMe?: string; includeArchived?: string };
      sendData(res, call(res, (a, r, c) => kpis.list(a, r, c, { ...q, assignedToMe: q.assignedToMe === "true", includeArchived: q.includeArchived === "true" })));
    },
  });
  registry.add({
    method: "post",
    path: "/api/kpis",
    access: { kind: "permission", key: "kpi.configure" },
    summary: "Create a KPI: `{name, key?, description?, category?, unit?, valueType?, direction?: higher_is_better|lower_is_better|target_range, frequency?: daily|weekly|monthly|quarterly|annual, aggregation?: sum|avg|last|min|max, defaultTarget?, defaultTargetMax?}`. Needs `kpi.configure` over everyone. The key is made from the name when not given (409 key_taken). A range needs both ends. Audited",
    schema: { body: z.object(body).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => kpis.create(a, r, c, v.body as KpiInput)), 201),
  });
  registry.add({
    method: "get",
    path: "/api/kpis/:id",
    access: { kind: "permission", key: "kpi.view" },
    takesEntityId: true,
    summary: "One KPI with the assignments the caller may see (each with its target, dates and how many people it covers today), its thresholds, and what the caller may do (`can`). Missing or another organization's: 404",
    schema: { params: idParams },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => kpis.detail(a, r, c, id(v)))),
  });
  registry.add({
    method: "patch",
    path: "/api/kpis/:id",
    access: { kind: "permission", key: "kpi.configure" },
    takesEntityId: true,
    summary: "Change a KPI's definition (the key stays). Needs `kpi.configure` over everyone. Audited by field name",
    schema: { params: idParams, body: z.object({ ...body, name: body.name.optional() }).omit({ key: true }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => kpis.update(a, r, c, id(v), v.body as Partial<KpiInput>))),
  });
  registry.add({
    method: "post",
    path: "/api/kpis/:id/archive",
    access: { kind: "permission", key: "kpi.configure" },
    takesEntityId: true,
    summary: "Archive a KPI (nothing is deleted). 409 has_active_assignments while any assignment is still active; already_archived. Audited",
    schema: { params: idParams },
    handler: (_req, res, v) => {
      call(res, (a, r, c) => kpis.archive(a, r, c, id(v)));
      sendData(res, { archived: true });
    },
  });
  registry.add({
    method: "post",
    path: "/api/kpis/:id/assignments",
    access: { kind: "permission", key: "kpi.assign" },
    takesEntityId: true,
    summary: "Give a KPI, with a target, to a person, team, department, designation or role family: `{assigneeId | teamId | departmentId | designationId | roleFamilyId (exactly one), targetValue?, targetMax?, weight?, effectiveFrom?, effectiveTo?}`. A person, team or department must be inside the caller's `kpi.assign` scope (403 outside_scope); a designation or role family needs it over everyone, and covers everyone who holds it at calculation time. The KPI's default target is used when none is given. 409 already_assigned for the same subject and dates. Audited",
    schema: { params: idParams, body: z.object({ assigneeId: uuid.optional(), teamId: uuid.optional(), departmentId: uuid.optional(), designationId: uuid.optional(), roleFamilyId: uuid.optional(), targetValue: z.number().min(-1e12).max(1e12).optional(), targetMax: z.number().min(-1e12).max(1e12).nullable().optional(), weight: z.number().min(-1e12).max(1e12).optional(), effectiveFrom: day.optional(), effectiveTo: day.nullable().optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => kpis.assign(a, r, c, id(v), v.body as AssignmentInput)), 201),
  });
  registry.add({
    method: "patch",
    path: "/api/kpis/:id/assignments/:aid",
    access: { kind: "permission", key: "kpi.assign" },
    takesEntityId: true,
    summary: "Change an assignment's target, weight or end date: `{targetValue?, targetMax?, weight?, effectiveTo?}`. The caller needs `kpi.assign` over the subject. 409 already_ended. Audited with before and after",
    schema: { params: z.object({ id: uuid, aid: uuid }), body: z.object({ targetValue: z.number().min(-1e12).max(1e12).optional(), targetMax: z.number().min(-1e12).max(1e12).nullable().optional(), weight: z.number().min(-1e12).max(1e12).optional(), effectiveTo: day.nullable().optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => kpis.updateAssignment(a, r, c, id(v), (v.params as { aid: string }).aid, v.body as Parameters<KpiService["updateAssignment"]>[5]))),
  });
  registry.add({
    method: "delete",
    path: "/api/kpis/:id/assignments/:aid",
    access: { kind: "permission", key: "kpi.assign" },
    takesEntityId: true,
    summary: "End an assignment today (the row is kept, so past measurements stay explainable). 409 already_ended. Audited",
    schema: { params: z.object({ id: uuid, aid: uuid }) },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => kpis.endAssignment(a, r, c, id(v), (v.params as { aid: string }).aid))),
  });
  registry.add({
    method: "get",
    path: "/api/kpis/:id/thresholds",
    access: { kind: "permission", key: "kpi.view" },
    takesEntityId: true,
    summary: "The KPI's warning and critical thresholds (and excellent, if set)",
    schema: { params: idParams },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => kpis.thresholds(a, r, c, id(v)))),
  });
  registry.add({
    method: "put",
    path: "/api/kpis/:id/thresholds",
    access: { kind: "permission", key: "kpi.configure" },
    takesEntityId: true,
    summary: "Replace the KPI's thresholds: `{thresholds: [{level: excellent|warning|critical, comparator: lt|lte|gt|gte, basis?: absolute|percent_of_target, value, notify?}]}`, at most one per level (400 duplicate_level). The earlier list is kept in the audit entry",
    schema: { params: idParams, body: z.object({ thresholds: z.array(z.object({ level: z.enum(LEVELS), comparator: z.enum(COMPARATORS), basis: z.enum(BASES).optional(), value: z.number().min(-1e12).max(1e12), notify: z.boolean().optional() }).strict()).max(3) }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => kpis.setThresholds(a, r, c, id(v), (v.body as { thresholds: Parameters<KpiService["setThresholds"]>[4] }).thresholds))),
  });
}
