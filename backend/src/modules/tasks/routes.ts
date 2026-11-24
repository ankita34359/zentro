import type { Response } from "express";
import { z } from "zod";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { unauthenticated } from "../../lib/errors.js";
import { authOf } from "../auth/guards.js";
import type { PermissionService } from "../permissions/service.js";
import { ASSIGNMENT_ROLES, PRIORITIES, STATUSES, type CreateTaskInput, type TaskService } from "./service.js";

const uuid = z.string().uuid();
const day = z.string().max(10);
const idParams = z.object({ id: uuid });
const flag = z.enum(["true", "false"]);

/** Tasks, My Work and the daily update (stages 4.1 and 4.4). */
export function registerTaskRoutes(registry: RouteRegistry, deps: { permissions: PermissionService; tasks: TaskService }): void {
  const { permissions, tasks } = deps;
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
  const id = (v: { params: unknown }) => (v.params as { id: string }).id;

  registry.add({
    method: "get",
    path: "/api/tasks",
    access: { kind: "permission", key: "task.view" },
    summary: "Tasks you may see: ones you created, do or watch, plus those of people or teams in your `task.view` scope. Query: `assigneeId`, `teamId`, `status` (comma list), `priority`, `overdue`, `blocked`, `mine` (tasks you do), `search`, `dueFrom`, `dueTo`, `objectiveId`, `keyResultId`, `unaligned` (open tasks supporting no objective), `waiting` (tasks waiting for others), `limit` (default 100, at most 300), `offset`. Returns `{tasks, total, limit, offset}`",
    schema: { query: z.object({ assigneeId: uuid.optional(), teamId: uuid.optional(), status: z.string().max(120).optional(), priority: z.enum(PRIORITIES).optional(), overdue: flag.optional(), blocked: flag.optional(), mine: flag.optional(), search: z.string().max(100).optional(), dueFrom: day.optional(), dueTo: day.optional(), objectiveId: uuid.optional(), keyResultId: uuid.optional(), unaligned: flag.optional(), waiting: flag.optional(), limit: z.coerce.number().int().min(1).max(300).optional(), offset: z.coerce.number().int().min(0).optional() }).strict() },
    handler: (_req, res, v) => {
      const q = v.query as { assigneeId?: string; teamId?: string; status?: string; priority?: string; overdue?: string; blocked?: string; mine?: string; search?: string; dueFrom?: string; dueTo?: string; objectiveId?: string; keyResultId?: string; unaligned?: string; waiting?: string; limit?: number; offset?: number };
      const status = q.status ? q.status.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
      if (status?.some((s) => !(STATUSES as readonly string[]).includes(s))) return sendData(res, { tasks: [], total: 0, limit: 0, offset: 0 });
      sendData(res, call(res, (a, r, c) => tasks.list(a, r, c, { ...q, status, overdue: q.overdue === "true", blocked: q.blocked === "true", mine: q.mine === "true", unaligned: q.unaligned === "true", waiting: q.waiting === "true" })));
    },
  });
  registry.add({
    method: "post",
    path: "/api/tasks",
    access: { kind: "permission", key: "task.create" },
    takesEntityId: true,
    summary: "Create a task: `{title, description?, priority?, importanceWeight?, startDate?, dueAt?, estimatedMinutes?, teamId?, assigneeIds?, assigneeTeamId?}`. Without `task.assign` the creator is the assignee and anyone else is refused (403 outside_scope); with it, assignees must be in the caller's scope. Audited; writes the `task.created` event and a notice to each new assignee",
    schema: { body: z.object({ title: z.string().min(1).max(400), description: z.string().max(8000).optional(), priority: z.enum(PRIORITIES).optional(), importanceWeight: z.number().int().min(1).max(5).optional(), startDate: day.nullable().optional(), dueAt: day.nullable().optional(), estimatedMinutes: z.number().int().min(1).max(100000).nullable().optional(), teamId: uuid.nullable().optional(), assigneeIds: z.array(uuid).max(20).optional(), assigneeTeamId: uuid.nullable().optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => tasks.create(a, r, c, v.body as CreateTaskInput)), 201),
  });
  registry.add({
    method: "get",
    path: "/api/tasks/:id",
    access: { kind: "permission", key: "task.view" },
    takesEntityId: true,
    summary: "One task with what the caller may do (`can`) and the statuses it may move to (`nextStatuses`). Not visible to the caller, missing, or another organization's: 404",
    schema: { params: idParams },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => tasks.detail(a, r, c, id(v)))),
  });
  registry.add({
    method: "patch",
    path: "/api/tasks/:id",
    access: { kind: "permission", key: "task.view" },
    takesEntityId: true,
    summary: "Change a task's details: `{title?, description?, priority?, importanceWeight?, startDate?, dueAt?, estimatedMinutes?, teamId?, objectiveId?, keyResultId?}` (the last two link the task to an objective or key result the caller may see; a key result implies its objective; null unlinks; 404 for one the caller cannot see). The creator and `task.edit` over the people doing it change everything; an assignee changes the estimate only (403 otherwise). A finished or cancelled task must be reopened first (409 task_closed). Audited",
    schema: { params: idParams, body: z.object({ title: z.string().min(1).max(400).optional(), description: z.string().max(8000).optional(), priority: z.enum(PRIORITIES).optional(), importanceWeight: z.number().int().min(1).max(5).optional(), startDate: day.nullable().optional(), dueAt: day.nullable().optional(), estimatedMinutes: z.number().int().min(1).max(100000).nullable().optional(), teamId: uuid.nullable().optional(), objectiveId: uuid.nullable().optional(), keyResultId: uuid.nullable().optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => tasks.update(a, r, c, id(v), v.body as Parameters<TaskService["update"]>[4]))),
  });
  registry.add({
    method: "post",
    path: "/api/tasks/:id/assignments",
    access: { kind: "permission", key: "task.assign" },
    takesEntityId: true,
    summary: "Add a person or a team to a task: `{assigneeId | teamId, role?: assignee|reviewer|watcher}` (one of the two). The person or team must be in the caller's `task.assign` scope. Notifies a new assignee; writes `task.assigned`; audited. 409 already_assigned, task_closed",
    schema: { params: idParams, body: z.object({ assigneeId: uuid.optional(), teamId: uuid.optional(), role: z.enum(ASSIGNMENT_ROLES).optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => tasks.assign(a, r, c, id(v), v.body as Parameters<TaskService["assign"]>[4])), 201),
  });
  registry.add({
    method: "post",
    path: "/api/tasks/:id/assignments/:aid/end",
    access: { kind: "permission", key: "task.assign" },
    takesEntityId: true,
    summary: "Take a person or team off a task (the assignment row is kept with its end time). 409 already_ended",
    schema: { params: z.object({ id: uuid, aid: uuid }) },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => tasks.unassign(a, r, c, id(v), (v.params as { aid: string }).aid))),
  });
  registry.add({
    method: "get",
    path: "/api/tasks/:id/updates",
    access: { kind: "permission", key: "task.view" },
    takesEntityId: true,
    summary: "The task's history, oldest first: status changes, progress, time logged and blockers",
    schema: { params: idParams },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => tasks.updates(a, r, c, id(v)))),
  });
  registry.add({
    method: "post",
    path: "/api/tasks/:id/updates",
    access: { kind: "permission", key: "task.view" },
    takesEntityId: true,
    summary: "Add to a task's history (append only): `{type: status_change|progress|time_log|blocker, toStatus?, progressPct?, minutesLogged?, note?}`. Allowed for the people doing the task, its creator and `task.edit` over them. A status change follows the workflow (409 invalid_transition) and `blocked` needs a note; `progress` is 0 to 99 (use completed for done); time is 1 to 1440 minutes. Notifies the creator of a blocker or completion; audited for status changes",
    schema: { params: idParams, body: z.object({ type: z.enum(["status_change", "progress", "time_log", "blocker"]), toStatus: z.enum(STATUSES).optional(), progressPct: z.number().int().min(0).max(100).optional(), minutesLogged: z.number().int().min(1).max(1440).optional(), note: z.string().max(2000).optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => tasks.addUpdate(a, r, c, id(v), v.body as Parameters<TaskService["addUpdate"]>[4])), 201),
  });
  registry.add({
    method: "post",
    path: "/api/tasks/:id/dependencies",
    access: { kind: "permission", key: "task.view" },
    takesEntityId: true,
    summary: "Make this task wait for another: `{dependsOnId}`. Both tasks must be visible to the caller, who must be the creator or hold `task.edit` over the people doing this one (403). 400 self_dependency, 409 dependency_loop, already_dependent, task_closed. The waiting task cannot be completed until the other is finished or cancelled (409 waiting_on_tasks). Audited",
    schema: { params: idParams, body: z.object({ dependsOnId: uuid }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => tasks.addDependency(a, r, c, id(v), (v.body as { dependsOnId: string }).dependsOnId)), 201),
  });
  registry.add({
    method: "delete",
    path: "/api/tasks/:id/dependencies/:depId",
    access: { kind: "permission", key: "task.view" },
    takesEntityId: true,
    summary: "Remove a dependency (same permission as adding one). 404 when there is no such dependency. Audited",
    schema: { params: z.object({ id: uuid, depId: uuid }) },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => tasks.removeDependency(a, r, c, id(v), (v.params as { depId: string }).depId))),
  });
  registry.add({
    method: "post",
    path: "/api/tasks/:id/outcome",
    access: { kind: "permission", key: "task.view" },
    takesEntityId: true,
    summary: "Record what a finished (or under-review) task achieved: `{summary, value?, recordOnKeyResult?}`. The people doing the task, its creator and `task.edit` over them may. With `recordOnKeyResult` and a `value`, the value is also recorded as the linked key result's actual value in the same transaction (needs `okr.update_progress` over it; history source task_outcome). A new outcome clears an earlier review. 409 not_finished, no_key_result. Audited",
    schema: { params: idParams, body: z.object({ summary: z.string().min(1).max(2000), value: z.number().min(-1e12).max(1e12).nullable().optional(), recordOnKeyResult: z.boolean().optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => tasks.recordOutcome(a, r, c, id(v), v.body as Parameters<TaskService["recordOutcome"]>[4])), 201),
  });
  registry.add({
    method: "post",
    path: "/api/tasks/:id/review",
    access: { kind: "permission", key: "task.review" },
    takesEntityId: true,
    summary: "Rate the quality of a finished task, 1 to 5: `{quality, note?}`. Needs `task.review` over the people who did it, and a reviewer is never the only person who did the work (403). 409 not_finished. Notifies the people who did it. Audited",
    schema: { params: idParams, body: z.object({ quality: z.number().int().min(1).max(5), note: z.string().max(1000).optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => tasks.review(a, r, c, id(v), v.body as { quality: number; note?: string })), 201),
  });
  registry.add({
    method: "get",
    path: "/api/tasks/:id/comments",
    access: { kind: "permission", key: "task.view" },
    takesEntityId: true,
    summary: "The task's comments, oldest first (deleted ones are not listed)",
    schema: { params: idParams },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => tasks.comments(a, r, c, id(v)))),
  });
  registry.add({
    method: "post",
    path: "/api/tasks/:id/comments",
    access: { kind: "permission", key: "task.view" },
    takesEntityId: true,
    summary: "Comment on a task you can see: `{body}` (at most 2000 characters). Notifies the creator and the assignees",
    schema: { params: idParams, body: z.object({ body: z.string().min(1).max(4000) }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => tasks.addComment(a, r, c, id(v), (v.body as { body: string }).body)), 201),
  });
  registry.add({
    method: "patch",
    path: "/api/tasks/:id/comments/:cid",
    access: { kind: "permission", key: "task.view" },
    takesEntityId: true,
    summary: "Edit your own comment: `{body}` (403 for someone else's)",
    schema: { params: z.object({ id: uuid, cid: uuid }), body: z.object({ body: z.string().min(1).max(4000) }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => tasks.editComment(a, r, c, id(v), (v.params as { cid: string }).cid, (v.body as { body: string }).body))),
  });
  registry.add({
    method: "delete",
    path: "/api/tasks/:id/comments/:cid",
    access: { kind: "permission", key: "task.view" },
    takesEntityId: true,
    summary: "Delete your own comment (soft delete: the row is kept)",
    schema: { params: z.object({ id: uuid, cid: uuid }) },
    handler: (_req, res, v) => {
      call(res, (a, r, c) => tasks.deleteComment(a, r, c, id(v), (v.params as { cid: string }).cid));
      sendData(res, { deleted: true });
    },
  });

  // ----- my work and the daily update: the signed-in person's own data, so no permission is needed -----
  registry.add({
    method: "get",
    path: "/api/my-work",
    access: { kind: "baseline" },
    summary: "The signed-in person's daily workspace: their open tasks grouped (overdue, due today, upcoming, blocked, in progress, unscheduled), the rule-based `suggested` order with reasons, recent achievements and today's daily update. Own data only",
    handler: (_req, res) => sendData(res, call(res, (a, r) => tasks.myWork(a, r))),
  });
  registry.add({
    method: "get",
    path: "/api/daily-updates",
    access: { kind: "baseline" },
    summary: "Your own daily updates, newest first. Query: `from`, `to` (default the last 30 days)",
    schema: { query: z.object({ from: day.optional(), to: day.optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r) => tasks.dailyUpdates(a, r, v.query as { from?: string; to?: string }))),
  });
  registry.add({
    method: "post",
    path: "/api/daily-updates",
    access: { kind: "baseline" },
    summary: "Send your daily update: `{summary, blockers?, date?}`. One per person per day (today or yesterday); sending again the same day replaces it. Writes the `daily_update.submitted` event once per day",
    schema: { body: z.object({ summary: z.string().min(1).max(4000), blockers: z.string().max(2000).nullable().optional(), date: day.nullable().optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r) => tasks.submitDailyUpdate(a, r, v.body as { summary: string; blockers?: string | null; date?: string | null })), 201),
  });
}
