import type { Response } from "express";
import { z } from "zod";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { unauthenticated } from "../../lib/errors.js";
import { authOf } from "../auth/guards.js";
import type { PermissionService } from "../permissions/service.js";
import type { TaskService } from "../tasks/service.js";
import type { AlignmentService } from "./alignment.js";

const uuid = z.string().uuid();
const idParams = z.object({ id: uuid });
const flag = z.enum(["true", "false"]);

/** Alignment, assignments, the contribution tree and the gaps report (stage 3.2). Registered BEFORE the `:id` routes of 3.1 so `tree` and `alignment-gaps` are not read as ids. */
export function registerAlignmentRoutes(registry: RouteRegistry, deps: { permissions: PermissionService; alignment: AlignmentService; tasks: TaskService }): void {
  const { permissions, alignment, tasks } = deps;
  const call = <T>(res: Response, fn: (a: NonNullable<ReturnType<typeof authOf>>, r: string, c: ReturnType<typeof permissions.capsOf>) => T): T => {
    res.setHeader("Cache-Control", "no-store");
    const a = authOf(res);
    if (!a) throw unauthenticated();
    return fn(a, String(res.locals.requestId ?? ""), permissions.capsOf(res, a));
  };
  const id = (v: { params: unknown }) => (v.params as { id: string }).id;

  registry.add({
    method: "get",
    path: "/api/objectives/tree",
    access: { kind: "permission", key: "okr.view" },
    summary: "The alignment tree of the objectives the caller may see: company → department → team → personal, each node with its health, attainment, its weight among siblings and its share of the parent (weight share × attainment). `?rootId` limits it to one branch (404 if not visible); `?includeClosed=true` adds completed and cancelled objectives. Objectives the caller cannot see are never named: a parent's `hiddenChildren` counts them",
    schema: { query: z.object({ rootId: uuid.optional(), includeClosed: flag.optional() }).strict() },
    handler: (_req, res, v) => {
      const q = v.query as { rootId?: string; includeClosed?: string };
      sendData(res, call(res, (a, r, c) => alignment.tree(a, r, c, { rootId: q.rootId, includeClosed: q.includeClosed === "true" })));
    },
  });
  registry.add({
    method: "get",
    path: "/api/objectives/alignment-gaps",
    access: { kind: "permission", key: "okr.view" },
    summary: "A deterministic report of where alignment is missing, over the objectives the caller may see: `unaligned` (contributes to nothing), `notBrokenDown` (a company or department objective nothing contributes to), `unmeasurable` (no key results), `noData`, `behindPace` (at risk or delayed), `overdue`; plus `unalignedTasks` (the caller's visible open tasks that support no objective)",
    handler: (_req, res) => {
      const g = call(res, (a, r, c) => ({ ...alignment.gaps(a, r, c), unalignedTasks: tasks.list(a, r, c, { unaligned: true, limit: 1 }).total }));
      sendData(res, g);
    },
  });
  registry.add({
    method: "get",
    path: "/api/objectives/:id/alignment",
    access: { kind: "permission", key: "okr.view" },
    takesEntityId: true,
    summary: "What this objective contributes to (its parent, with the weight), what contributes to it (its children), who else works on it, and whether the caller may change that (`can.assign`). Not visible or another organization's: 404",
    schema: { params: idParams },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => alignment.alignment(a, r, c, id(v)))),
  });
  registry.add({
    method: "put",
    path: "/api/objectives/:id/parent",
    access: { kind: "permission", key: "okr.assign" },
    takesEntityId: true,
    summary: "Make an objective contribute to a parent: `{parentId, weight?}`. The caller needs `okr.assign` over the objective and must see the parent. The parent must sit at a higher level (400 wrong_level), a loop is refused (409 alignment_loop), and an earlier parent is replaced (its link is ended, not deleted). Audited",
    schema: { params: idParams, body: z.object({ parentId: uuid, weight: z.number().min(0.01).max(100).optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => alignment.setParent(a, r, c, id(v), v.body as { parentId: string; weight?: number }))),
  });
  registry.add({
    method: "delete",
    path: "/api/objectives/:id/parent",
    access: { kind: "permission", key: "okr.assign" },
    takesEntityId: true,
    summary: "Take an objective out of its alignment (ends the link; nothing is deleted). 404 when it has no parent. Audited",
    schema: { params: idParams },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => alignment.clearParent(a, r, c, id(v)))),
  });
  registry.add({
    method: "post",
    path: "/api/objectives/:id/assignments",
    access: { kind: "permission", key: "okr.assign" },
    takesEntityId: true,
    summary: "Give an objective to a person, team or department as contributor or reviewer: `{assigneeId | teamId | departmentId, role?}` (exactly one). The caller needs `okr.assign` over the objective and over the assignee (403 outside_scope). Assignees can then see the objective. 409 already_assigned, objective_closed. Audited",
    schema: { params: idParams, body: z.object({ assigneeId: uuid.optional(), teamId: uuid.optional(), departmentId: uuid.optional(), role: z.enum(["contributor", "reviewer"]).optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => alignment.assign(a, r, c, id(v), v.body as Parameters<AlignmentService["assign"]>[4])), 201),
  });
  registry.add({
    method: "delete",
    path: "/api/objectives/:id/assignments/:aid",
    access: { kind: "permission", key: "okr.assign" },
    takesEntityId: true,
    summary: "End an assignment (the row is kept with its end date). 409 already_ended. Audited",
    schema: { params: z.object({ id: uuid, aid: uuid }) },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => alignment.unassign(a, r, c, id(v), (v.params as { aid: string }).aid))),
  });
}
