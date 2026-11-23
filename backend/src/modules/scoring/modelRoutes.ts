import type { Response } from "express";
import { z } from "zod";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { unauthenticated } from "../../lib/errors.js";
import { authOf } from "../auth/guards.js";
import type { PermissionService } from "../permissions/service.js";
import type { ModelInput, ModelService } from "./models.js";

const uuid = z.string().uuid();
const idParams = z.object({ id: uuid });
const flag = z.enum(["true", "false"]);

/** Scoring models (stage 5.1). */
export function registerModelRoutes(registry: RouteRegistry, deps: { permissions: PermissionService; models: ModelService }): void {
  const { permissions, models } = deps;
  const call = <T>(res: Response, fn: (a: NonNullable<ReturnType<typeof authOf>>, r: string, c: ReturnType<typeof permissions.capsOf>) => T): T => {
    res.setHeader("Cache-Control", "no-store");
    const a = authOf(res);
    if (!a) throw unauthenticated();
    return fn(a, String(res.locals.requestId ?? ""), permissions.capsOf(res, a));
  };
  const id = (v: { params: unknown }) => (v.params as { id: string }).id;
  const component = z.object({ key: z.string().min(1).max(40), label: z.string().min(1).max(80), weight: z.number().min(0).max(100), providerKey: z.string().min(1).max(60), minSample: z.number().int().min(0).max(1000).optional(), config: z.record(z.string(), z.unknown()).optional() }).strict();

  registry.add({
    method: "get",
    path: "/api/performance/models",
    access: { kind: "permission", key: "performance.view_components" },
    summary: "The scoring models (standard ones are added the first time this is opened): name, version, status (draft, active, retired), who it applies to (a designation or role family; one model is the default), minimums, bands and components with their weights, and `problems` that stop it being activated. `?includeRetired=true` adds old versions",
    schema: { query: z.object({ includeRetired: flag.optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => models.list(a, r, c, { includeRetired: (v.query as { includeRetired?: string }).includeRetired === "true" }))),
  });
  registry.add({
    method: "get",
    path: "/api/performance/models/templates",
    access: { kind: "permission", key: "performance.view_components" },
    summary: "The standard role templates a new model can start from (Employee, Intern, Team lead, Manager, Mentor, Department head, Senior management, CEO) and what each measures",
    handler: (_req, res) => sendData(res, call(res, () => models.templates())),
  });
  registry.add({
    method: "post",
    path: "/api/performance/models/preview",
    access: { kind: "permission", key: "performance.configure" },
    takesEntityId: true,
    summary: "The what-if calculator: `{modelId, values: {<componentKey>: 0..100 | null}, periodClosed?}` runs the model on the typed values and stores NOTHING. null means no data (not zero). Returns the total, status, weight coverage, confidence, each component with its effective weight and points, and the plain-words explanation",
    schema: { body: z.object({ modelId: uuid, values: z.record(z.string(), z.number().nullable()), periodClosed: z.boolean().optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => models.preview(a, r, c, v.body as Parameters<ModelService["preview"]>[3]))),
  });
  registry.add({
    method: "post",
    path: "/api/performance/models",
    access: { kind: "permission", key: "performance.configure" },
    summary: "Create a model from a standard template as a draft: `{templateKey, name?}` (409 name_taken). Audited",
    schema: { body: z.object({ templateKey: z.string().min(1).max(40), name: z.string().min(1).max(80).optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => models.create(a, r, c, v.body as { templateKey: string; name?: string })), 201),
  });
  registry.add({
    method: "get",
    path: "/api/performance/models/:id",
    access: { kind: "permission", key: "performance.view_components" },
    takesEntityId: true,
    summary: "One model with its components. Missing or another organization's: 404",
    schema: { params: idParams },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => models.detail(a, r, c, id(v)))),
  });
  registry.add({
    method: "patch",
    path: "/api/performance/models/:id",
    access: { kind: "permission", key: "performance.configure" },
    takesEntityId: true,
    summary: "Change a model: `{name?, roleFamilyId?, designationId?, isDefault?, minWeightCoverage?, minConfidenceForFinal?, bands?, components?}`. A draft is edited in place; editing an ACTIVE or retired model starts the next version as a draft (the old version and the scores that used it are untouched; 409 draft_exists when one is already open). Audited with the weights before and after",
    schema: { params: idParams, body: z.object({ name: z.string().min(1).max(80).optional(), roleFamilyId: uuid.nullable().optional(), designationId: uuid.nullable().optional(), isDefault: z.boolean().optional(), minWeightCoverage: z.number().optional(), minConfidenceForFinal: z.number().optional(), bands: z.array(z.object({ min: z.number(), label: z.string().min(1).max(40) }).strict()).max(8).optional(), components: z.array(component).max(20).optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => models.update(a, r, c, id(v), v.body as ModelInput))),
  });
  registry.add({
    method: "post",
    path: "/api/performance/models/:id/activate",
    access: { kind: "permission", key: "performance.configure" },
    takesEntityId: true,
    summary: "Make a draft the model in use. The weights must add up to exactly 100 and every measure must exist (400 model_invalid, with the list of problems). The version it replaces is retired. 409 already_active. Audited",
    schema: { params: idParams },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => models.activate(a, r, c, id(v)))),
  });
}
