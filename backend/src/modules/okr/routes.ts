import type { Response } from "express";
import { z } from "zod";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { unauthenticated } from "../../lib/errors.js";
import { authOf } from "../auth/guards.js";
import type { PermissionService } from "../permissions/service.js";
import { LEVELS, LIFECYCLES, MEASUREMENTS, OBJECTIVE_TYPES, PRIORITIES, type CreateObjectiveInput, type KeyResultInput, type OkrService } from "./service.js";

const uuid = z.string().uuid();
const day = z.string().max(10);
const idParams = z.object({ id: uuid });
const flag = z.enum(["true", "false"]);

const keyResultBody = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(1000).optional(),
  measurementType: z.enum(MEASUREMENTS).optional(),
  unit: z.string().max(20).nullable().optional(),
  direction: z.enum(["increase", "decrease"]).optional(),
  method: z.enum(["linear", "binary", "manual"]).optional(),
  startValue: z.number().optional(),
  targetValue: z.number(),
  weight: z.number().optional(),
  ownerId: uuid.nullable().optional(),
  dueDate: day.nullable().optional(),
}).strict();

/** Objectives and key results (stage 3.1). */
export function registerOkrRoutes(registry: RouteRegistry, deps: { permissions: PermissionService; okr: OkrService }): void {
  const { permissions, okr } = deps;
  const call = <T>(res: Response, fn: (a: NonNullable<ReturnType<typeof authOf>>, r: string, c: ReturnType<typeof permissions.capsOf>) => T): T => {
    res.setHeader("Cache-Control", "no-store");
    const a = authOf(res);
    if (!a) throw unauthenticated();
    return fn(a, String(res.locals.requestId ?? ""), permissions.capsOf(res, a));
  };
  const id = (v: { params: unknown }) => (v.params as { id: string }).id;

  registry.add({
    method: "get",
    path: "/api/objectives",
    access: { kind: "permission", key: "okr.view" },
    summary: "Objectives you may see: ones in your `okr.view` scope, ones you own or created, and ones the organization has published. Each carries its attainment (a whole-number percent from the key results' actual values, or null when nothing is recorded: never 0 for no data). Query: `level`, `lifecycle`, `ownerId`, `teamId`, `departmentId`, `mine`, `search`, `includeArchived` (needs `okr.archive` over everyone)",
    schema: { query: z.object({ level: z.enum(LEVELS).optional(), lifecycle: z.enum(LIFECYCLES).optional(), ownerId: uuid.optional(), teamId: uuid.optional(), departmentId: uuid.optional(), mine: flag.optional(), search: z.string().max(100).optional(), includeArchived: flag.optional() }).strict() },
    handler: (_req, res, v) => {
      const q = v.query as { level?: string; lifecycle?: string; ownerId?: string; teamId?: string; departmentId?: string; mine?: string; search?: string; includeArchived?: string };
      sendData(res, call(res, (a, r, c) => okr.list(a, r, c, { ...q, mine: q.mine === "true", includeArchived: q.includeArchived === "true" })));
    },
  });
  registry.add({
    method: "get",
    path: "/api/objectives/linkable",
    access: { kind: "permission", key: "okr.view" },
    summary: "Open objectives (with their key results) the caller may link a task to: a short list for the task drawer's picker",
    handler: (_req, res) => sendData(res, call(res, (a, r, c) => okr.linkable(a, r, c))),
  });
  registry.add({
    method: "post",
    path: "/api/objectives",
    access: { kind: "permission", key: "okr.create" },
    takesEntityId: true,
    summary: "Create an objective: `{level: company|department|team|individual, title, description?, objectiveType?, startDate, endDate, priority?, weight?, departmentId? (department), teamId? (team), ownerId? (individual; default the caller), lifecycle?: draft|active, keyResults?: [...]}` with up to 12 key results `{title, measurementType?, unit?, direction?: increase|decrease, method?: linear|binary|manual, startValue?, targetValue, weight?, ownerId?, dueDate?}`. The level must be inside the caller's `okr.create` scope (403 outside_scope). A target equal to the start, or on the wrong side of it for the direction, is refused (400). Audited",
    schema: {
      body: z.object({
        level: z.enum(LEVELS), title: z.string().min(1).max(160), description: z.string().max(4000).optional(), objectiveType: z.enum(OBJECTIVE_TYPES).optional(),
        startDate: day, endDate: day, priority: z.enum(PRIORITIES).optional(), weight: z.number().optional(), departmentId: uuid.nullable().optional(), teamId: uuid.nullable().optional(), ownerId: uuid.nullable().optional(),
        lifecycle: z.enum(["draft", "active"]).optional(), keyResults: z.array(keyResultBody).max(12).optional(),
      }).strict(),
    },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => okr.create(a, r, c, v.body as CreateObjectiveInput)), 201),
  });
  registry.add({
    method: "get",
    path: "/api/objectives/:id",
    access: { kind: "permission", key: "okr.view" },
    takesEntityId: true,
    summary: "One objective with its key results, what the caller may do (`can`), and the lifecycle states it may move to. Not visible to the caller, missing, or another organization's: 404",
    schema: { params: idParams },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => okr.detail(a, r, c, id(v)))),
  });
  registry.add({
    method: "patch",
    path: "/api/objectives/:id",
    access: { kind: "permission", key: "okr.view" },
    takesEntityId: true,
    summary: "Change an objective: `{title?, description?, objectiveType?, startDate?, endDate?, priority?, weight?, ownerId?, lifecycle?}`. Needs `okr.edit` over it (403 otherwise). Lifecycle moves: draft→active|cancelled, active→draft|completed|cancelled, completed→active, cancelled→draft (409 invalid_transition). Audited",
    schema: { params: idParams, body: z.object({ title: z.string().min(1).max(160).optional(), description: z.string().max(4000).optional(), objectiveType: z.enum(OBJECTIVE_TYPES).optional(), startDate: day.optional(), endDate: day.optional(), priority: z.enum(PRIORITIES).optional(), weight: z.number().optional(), ownerId: uuid.nullable().optional(), lifecycle: z.enum(LIFECYCLES).optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => okr.update(a, r, c, id(v), v.body as Parameters<OkrService["update"]>[4]))),
  });
  registry.add({
    method: "delete",
    path: "/api/objectives/:id",
    access: { kind: "permission", key: "okr.archive" },
    takesEntityId: true,
    summary: "Archive an objective (nothing is deleted). Needs `okr.archive` over it. 409 has_open_tasks while open tasks are linked, already_archived. Audited",
    schema: { params: idParams },
    handler: (_req, res, v) => {
      call(res, (a, r, c) => okr.archive(a, r, c, id(v)));
      sendData(res, { archived: true });
    },
  });
  registry.add({
    method: "post",
    path: "/api/objectives/:id/publish",
    access: { kind: "permission", key: "okr.publish" },
    takesEntityId: true,
    summary: "Publish an objective so everyone in the organization can see it (read only), or take it back: `{published: boolean}`. A draft cannot be published (409). Audited",
    schema: { params: idParams, body: z.object({ published: z.boolean() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => okr.setPublished(a, r, c, id(v), (v.body as { published: boolean }).published))),
  });
  registry.add({
    method: "get",
    path: "/api/objectives/:id/history",
    access: { kind: "permission", key: "okr.view" },
    takesEntityId: true,
    summary: "The objective's append-only progress history: every recorded value, target change and task outcome, oldest first, with who recorded it and why",
    schema: { params: idParams },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => okr.history(a, r, c, id(v)))),
  });
  registry.add({
    method: "post",
    path: "/api/objectives/:id/key-results",
    access: { kind: "permission", key: "okr.edit" },
    takesEntityId: true,
    summary: "Add a key result to an objective (same body as in objective creation). Needs `okr.edit` over the objective; at most 12; not on a finished or cancelled objective (409). Audited",
    schema: { params: idParams, body: keyResultBody },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => okr.addKeyResult(a, r, c, id(v), v.body as KeyResultInput)), 201),
  });
  registry.add({
    method: "patch",
    path: "/api/key-results/:id",
    access: { kind: "permission", key: "okr.edit" },
    takesEntityId: true,
    summary: "Change a key result: `{title?, description?, unit?, startValue?, targetValue?, weight?, ownerId?, dueDate?}`. Changing the numbers is written to the history as a target change. Audited",
    schema: { params: idParams, body: z.object({ title: z.string().min(1).max(160).optional(), description: z.string().max(1000).optional(), unit: z.string().max(20).nullable().optional(), startValue: z.number().optional(), targetValue: z.number().optional(), weight: z.number().optional(), ownerId: uuid.nullable().optional(), dueDate: day.nullable().optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => okr.updateKeyResult(a, r, c, id(v), v.body as Parameters<OkrService["updateKeyResult"]>[4]))),
  });
  registry.add({
    method: "post",
    path: "/api/key-results/:id/progress",
    access: { kind: "permission", key: "okr.update_progress" },
    takesEntityId: true,
    summary: "Record an ACTUAL value for a key result: `{value, note?}`. Appends to the history (naming the value it replaces) and updates the current value; nothing is overwritten. Yes-or-no results take 0 or 1, manual ones 0 to 100. Only on an active objective (409 objective_not_active). Audited",
    schema: { params: idParams, body: z.object({ value: z.number(), note: z.string().max(1000).optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => okr.recordProgress(a, r, c, id(v), v.body as { value: number; note?: string })), 201),
  });
}
