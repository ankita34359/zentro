import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { suggestOrder } from "../backend/src/modules/tasks/ordering.js";
import { ORIGIN, type TestApp } from "./helpers/app.js";
import { get, makeAuthApp, post, send, signUpWithOrg } from "./helpers/auth.js";
import { addPerson, roleIds } from "./helpers/roles.js";

let t: TestApp;
afterEach(() => t?.cleanup());

const code = (r: { body: { error?: { code?: string } } }) => r.body.error?.code;
const created = async (path: string, body: Record<string, unknown>, cookie: string): Promise<string> => {
  const r = await post(t.app, path, body, cookie);
  expect(r.status, `${path} ${JSON.stringify(r.body)}`).toBe(201);
  return r.body.data.id as string;
};
const dayOffset = (n: number): string => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const audit = async (cookie: string) => (await get(t.app, "/api/audit-logs?limit=100", cookie)).body.data as { action: string; summary: string }[];
const inbox = async (cookie: string, q = "") => (await get(t.app, `/api/notifications${q}`, cookie)).body.data as { notifications: { id: string; type: string; title: string; body: string | null; read: boolean; entityId: string | null }[]; unreadCount: number; nextCursor: string | null };
const one = <T>(sql: string, ...p: unknown[]) => t.db.prepare(sql).get(...p) as T;

async function setup() {
  t = makeAuthApp();
  const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
  const ids = await roleIds(t.app, owner);
  const dept = await created("/api/departments", { name: "Engineering" }, owner);
  const core = await created("/api/teams", { name: "Core", departmentId: dept }, owner);
  const other = await created("/api/teams", { name: "Other", departmentId: dept }, owner);
  const mgr = await addPerson(t.app, owner, "mgr@example.com", ids.manager, "Max Manager");
  const emp = await addPerson(t.app, owner, "emp@example.com", ids.employee, "Emma Employee");
  const mate = await addPerson(t.app, owner, "mate@example.com", ids.employee, "Tom Teammate");
  const stranger = await addPerson(t.app, owner, "stranger@example.com", ids.employee, "Sam Stranger");
  for (const p of [emp, mate]) await post(t.app, `/api/teams/${core}/members`, { membershipId: p.membershipId }, owner);
  await post(t.app, `/api/teams/${other}/members`, { membershipId: stranger.membershipId }, owner);
  await post(t.app, "/api/hierarchy/reporting", { subordinateId: emp.membershipId, managerId: mgr.membershipId }, owner);
  return { owner, ids, core, other, mgr, emp, mate, stranger };
}
const task = async (cookie: string, body: Record<string, unknown>) => created("/api/tasks", { title: "A task", ...body }, cookie);

describe("creating tasks", () => {
  it("an employee creates a task for themselves; it is audited, writes the task.created event and shows in the list", async () => {
    const s = await setup();
    const r = await post(t.app, "/api/tasks", { title: "  Write   the report ", description: "Quarterly", priority: "high", importanceWeight: 4, dueAt: dayOffset(3), estimatedMinutes: 120 }, s.emp.cookie);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data).toMatchObject({ title: "Write the report", status: "not_started", priority: "high", progressPct: 0, dueAt: dayOffset(3), overdue: false, estimatedMinutes: 120, assignees: [{ kind: "person", id: s.emp.membershipId, role: "assignee" }], createdBy: { id: s.emp.membershipId } });
    expect(r.body.data.can).toEqual({ edit: true, editEstimate: true, update: true, assign: false, comment: true, link: true, recordOutcome: false, review: false });
    expect((await get(t.app, "/api/tasks", s.emp.cookie)).body.data.total).toBe(1);
    expect((await audit(s.owner)).find((e) => e.action === "task.create")!.summary).toBe('Created the task "Write the report" for Emma Employee');
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM automation_events WHERE event_type = 'task.created'").n).toBe(1);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM notifications").n).toBe(0); // no notice for work you gave yourself
  });

  it("without task.assign you cannot give work to someone else; a manager can, within their reports, and the person is notified", async () => {
    const s = await setup();
    const no = await post(t.app, "/api/tasks", { title: "Not yours", assigneeIds: [s.mate.membershipId] }, s.emp.cookie);
    expect(no.status).toBe(403);
    expect(code(no)).toBe("outside_scope");
    const out = await post(t.app, "/api/tasks", { title: "Not a report", assigneeIds: [s.stranger.membershipId] }, s.mgr.cookie);
    expect(code(out)).toBe("outside_scope");
    const ok = await post(t.app, "/api/tasks", { title: "Prepare the demo", assigneeIds: [s.emp.membershipId], dueAt: dayOffset(1) }, s.mgr.cookie);
    expect(ok.status).toBe(201);
    const n = await inbox(s.emp.cookie);
    expect(n.unreadCount).toBe(1);
    expect(n.notifications[0]).toMatchObject({ type: "task.assigned", title: "Max Manager gave you a task", body: "Prepare the demo", entityId: ok.body.data.id });
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM automation_events WHERE event_type = 'task.assigned'").n).toBe(1);
  });

  it("naming nobody means the task is yours, even for someone who may assign work to others", async () => {
    const s = await setup();
    const r = await post(t.app, "/api/tasks", { title: "Mine by default" }, s.mgr.cookie);
    expect(r.body.data.assignees).toMatchObject([{ id: s.mgr.membershipId, role: "assignee" }]);
    expect((await get(t.app, "/api/my-work", s.mgr.cookie)).body.data.counts.open).toBe(1);
  });

  it("validates titles, dates, priority, importance and estimates, and never trusts an organization id", async () => {
    const s = await setup();
    const bad = (body: Record<string, unknown>) => post(t.app, "/api/tasks", body, s.emp.cookie);
    expect(code(await bad({ title: "  " }))).toBe("invalid_title");
    expect(code(await bad({ title: "x", dueAt: "2026-02-31" }))).toBe("invalid_date");
    expect(code(await bad({ title: "x", startDate: "2026-05-02", dueAt: "2026-05-01" }))).toBe("invalid_date");
    expect(code(await bad({ title: "x", priority: "urgent" }))).toBe("validation_failed");
    expect(code(await bad({ title: "x", importanceWeight: 9 }))).toBe("validation_failed");
    expect(code(await bad({ title: "x", estimatedMinutes: 0 }))).toBe("validation_failed");
    expect((await bad({ title: "x", organization_id: "o" })).status).toBe(400);
    expect((await bad({ title: "x", assigneeIds: ["11111111-1111-4111-8111-111111111111"] })).status).toBe(404); // an unknown person
  });
});

describe("who sees which task", () => {
  it("you always see tasks you made or do; teammates' tasks follow task.view (my teams); a manager sees their reports'; others get 404", async () => {
    const s = await setup();
    const mine = await task(s.emp.cookie, { title: "Emma's own" });
    const mates = await task(s.mate.cookie, { title: "Tom's own" });
    const strangers = await task(s.stranger.cookie, { title: "Sam's own" });
    const list = async (cookie: string) => ((await get(t.app, "/api/tasks", cookie)).body.data.tasks as { title: string }[]).map((x) => x.title).sort();
    expect(await list(s.emp.cookie)).toEqual(["Emma's own", "Tom's own"]); // teammates (Core), not Sam in another team
    expect(await list(s.mgr.cookie)).toEqual(["Emma's own"]); // reports only
    expect(await list(s.stranger.cookie)).toEqual(["Sam's own"]);
    expect((await get(t.app, `/api/tasks/${strangers}`, s.emp.cookie)).status).toBe(404);
    expect((await get(t.app, `/api/tasks/${mates}`, s.emp.cookie)).status).toBe(200);
    expect((await get(t.app, `/api/tasks/${mine}`, s.stranger.cookie)).status).toBe(404);
    expect((await get(t.app, `/api/tasks/${mine}`, s.owner)).status).toBe(200); // the owner sees everything
    expect((await get(t.app, "/api/tasks", s.owner)).body.data.total).toBe(3);
  });

  it("filters: status, priority, overdue, blocked, mine, search, assignee, team, due range, paging", async () => {
    const s = await setup();
    const a = await task(s.emp.cookie, { title: "Late invoice", dueAt: dayOffset(-3), priority: "critical" });
    await task(s.emp.cookie, { title: "Plan trip", dueAt: dayOffset(5) });
    const c = await task(s.emp.cookie, { title: "Stuck thing" });
    await post(t.app, `/api/tasks/${c}/updates`, { type: "status_change", toStatus: "blocked", note: "Waiting for access" }, s.emp.cookie);
    const q = async (qs: string) => ((await get(t.app, `/api/tasks?${qs}`, s.emp.cookie)).body.data.tasks as { title: string }[]).map((x) => x.title).sort();
    expect(await q("overdue=true")).toEqual(["Late invoice"]);
    expect(await q("blocked=true")).toEqual(["Stuck thing"]);
    expect(await q("priority=critical")).toEqual(["Late invoice"]);
    expect(await q("status=not_started,blocked")).toEqual(["Late invoice", "Plan trip", "Stuck thing"]);
    expect(await q("mine=true")).toHaveLength(3);
    expect(await q("search=trip")).toEqual(["Plan trip"]);
    expect(await q(`assigneeId=${s.emp.membershipId}`)).toHaveLength(3);
    expect(await q(`assigneeId=${s.mate.membershipId}`)).toEqual([]);
    expect(await q(`dueFrom=${dayOffset(0)}&dueTo=${dayOffset(10)}`)).toEqual(["Plan trip"]);
    expect((await get(t.app, "/api/tasks?limit=2&offset=1", s.emp.cookie)).body.data).toMatchObject({ total: 3, limit: 2, offset: 1 });
    expect((await get(t.app, "/api/tasks?limit=9999", s.emp.cookie)).status).toBe(400);
    expect(a).toBeTruthy();
  });
});

describe("the status workflow, progress, time and blockers", () => {
  it("moves through the workflow, records every step in the history, sets completion, and refuses a jump", async () => {
    const s = await setup();
    const id = await task(s.emp.cookie, { title: "Ship it" });
    const step = (body: Record<string, unknown>) => post(t.app, `/api/tasks/${id}/updates`, body, s.emp.cookie);
    expect(code(await step({ type: "status_change", toStatus: "completed" }))).toBe("invalid_transition"); // not started cannot be completed
    expect((await step({ type: "status_change", toStatus: "in_progress" })).body.data.status).toBe("in_progress");
    expect(code(await step({ type: "status_change", toStatus: "in_progress" }))).toBe("no_change");
    expect(code(await step({ type: "status_change", toStatus: "blocked" }))).toBe("reason_required");
    const blocked = await step({ type: "status_change", toStatus: "blocked", note: "Waiting for the API key" });
    expect(blocked.body.data).toMatchObject({ status: "blocked", blockedReason: "Waiting for the API key" });
    expect(blocked.body.data.nextStatuses).toEqual(["not_started", "in_progress", "cancelled"]);
    expect((await step({ type: "status_change", toStatus: "in_progress" })).body.data.blockedReason).toBeNull();
    const review = await step({ type: "status_change", toStatus: "under_review" });
    expect(review.body.data.status).toBe("under_review");
    const done = await step({ type: "status_change", toStatus: "completed", note: "Shipped" });
    expect(done.body.data).toMatchObject({ status: "completed", progressPct: 100 });
    expect(one<{ completed_at: string }>("SELECT completed_at FROM tasks WHERE id = ?", id).completed_at).toBeTruthy();
    expect(code(await step({ type: "progress", progressPct: 40 }))).toBe("task_closed");
    expect((await step({ type: "status_change", toStatus: "in_progress" })).body.data).toMatchObject({ status: "in_progress", completedAt: null }); // reopened
    const history = (await get(t.app, `/api/tasks/${id}/updates`, s.emp.cookie)).body.data as { type: string; fromStatus: string | null; toStatus: string | null }[];
    expect(history.map((h) => `${h.fromStatus}>${h.toStatus}`)).toEqual(["not_started>in_progress", "in_progress>blocked", "blocked>in_progress", "in_progress>under_review", "under_review>completed", "completed>in_progress"]);
    expect((await audit(s.owner)).filter((e) => e.action === "task.status")).toHaveLength(6);
  });

  it("progress starts work that has not started, time adds up, a blocker is noted, and bad numbers are refused", async () => {
    const s = await setup();
    const id = await task(s.emp.cookie, { title: "Draft", estimatedMinutes: 60 });
    const up = (body: Record<string, unknown>) => post(t.app, `/api/tasks/${id}/updates`, body, s.emp.cookie);
    expect((await up({ type: "progress", progressPct: 30, note: "Outline done" })).body.data).toMatchObject({ status: "in_progress", progressPct: 30 });
    expect((await up({ type: "time_log", minutesLogged: 45 })).body.data.actualMinutes).toBe(45);
    expect((await up({ type: "time_log", minutesLogged: 30 })).body.data.actualMinutes).toBe(75); // over the estimate is allowed and visible
    expect((await up({ type: "blocker", note: "Need a review slot" })).body.data.blockedReason).toBe("Need a review slot");
    expect(code(await up({ type: "progress", progressPct: 100 }))).toBe("use_complete");
    expect(code(await up({ type: "progress", progressPct: 50.5 }))).toBe("validation_failed");
    expect(code(await up({ type: "time_log", minutesLogged: 0 }))).toBe("validation_failed");
    expect(code(await up({ type: "blocker" }))).toBe("reason_required");
    const types = ((await get(t.app, `/api/tasks/${id}/updates`, s.emp.cookie)).body.data as { type: string }[]).map((h) => h.type);
    expect(types).toEqual(["progress", "status_change", "time_log", "time_log", "blocker"]);
  });

  it("a refused update leaves no history, audit or notification behind", async () => {
    const s = await setup();
    const id = await task(s.emp.cookie, { title: "Atomic" });
    const before = { updates: one<{ n: number }>("SELECT COUNT(*) n FROM task_updates").n, audit: (await audit(s.owner)).length, events: one<{ n: number }>("SELECT COUNT(*) n FROM automation_events").n };
    await post(t.app, `/api/tasks/${id}/updates`, { type: "status_change", toStatus: "completed" }, s.emp.cookie);
    await post(t.app, `/api/tasks/${id}/updates`, { type: "status_change", toStatus: "blocked" }, s.emp.cookie);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM task_updates").n).toBe(before.updates);
    expect((await audit(s.owner)).length).toBe(before.audit);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM automation_events").n).toBe(before.events);
  });

  it("who may update: the people doing it, its creator and a manager over them; not a teammate, not a stranger", async () => {
    const s = await setup();
    const id = await task(s.emp.cookie, { title: "Emma's" });
    const tryUpdate = (cookie: string) => post(t.app, `/api/tasks/${id}/updates`, { type: "time_log", minutesLogged: 5 }, cookie);
    expect((await tryUpdate(s.emp.cookie)).status).toBe(201);
    expect((await tryUpdate(s.mgr.cookie)).status).toBe(201); // task.edit over their reports
    expect((await tryUpdate(s.mate.cookie)).status).toBe(403); // can see it (my teams) but is not doing it
    expect((await tryUpdate(s.stranger.cookie)).status).toBe(404); // cannot even see it
  });

  it("the creator hears about a blocker and a completion by the person doing the work, once each", async () => {
    const s = await setup();
    const id = await created("/api/tasks", { title: "Fix login", assigneeIds: [s.emp.membershipId] }, s.mgr.cookie);
    await post(t.app, `/api/tasks/${id}/updates`, { type: "status_change", toStatus: "in_progress" }, s.emp.cookie);
    await post(t.app, `/api/tasks/${id}/updates`, { type: "status_change", toStatus: "blocked", note: "No test account" }, s.emp.cookie);
    await post(t.app, `/api/tasks/${id}/updates`, { type: "status_change", toStatus: "in_progress" }, s.emp.cookie);
    await post(t.app, `/api/tasks/${id}/updates`, { type: "status_change", toStatus: "completed" }, s.emp.cookie);
    const n = (await inbox(s.mgr.cookie)).notifications;
    expect(n.map((x) => x.type)).toEqual(["task.completed", "task.blocked"]);
    expect(n[1]!.body).toBe("Fix login: No test account");
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM automation_events WHERE event_type = 'task.completed'").n).toBe(1);
    expect((await inbox(s.emp.cookie)).notifications.map((x) => x.type)).toEqual(["task.assigned"]); // nothing sent to the person who acted
  });
});

describe("editing and assigning", () => {
  it("the creator changes everything; an assignee only the estimate; a closed task must be reopened; changes are audited by field name", async () => {
    const s = await setup();
    const id = await created("/api/tasks", { title: "Manager's task", assigneeIds: [s.emp.membershipId], estimatedMinutes: 30 }, s.mgr.cookie);
    expect((await send(t.app, "patch", `/api/tasks/${id}`, { estimatedMinutes: 90 }, s.emp.cookie)).body.data.estimatedMinutes).toBe(90);
    const denied = await send(t.app, "patch", `/api/tasks/${id}`, { title: "Renamed by Emma" }, s.emp.cookie);
    expect(denied.status).toBe(403);
    const ok = await send(t.app, "patch", `/api/tasks/${id}`, { title: "Renamed", priority: "critical", dueAt: dayOffset(2) }, s.mgr.cookie);
    expect(ok.body.data).toMatchObject({ title: "Renamed", priority: "critical", dueAt: dayOffset(2) });
    expect((await audit(s.owner)).find((e) => e.action === "task.update")!.summary).toBe('Changed the task "Renamed" (title, priority, dueAt)'.replace("title, priority, dueAt", "title, priority, dueAt"));
    expect((await send(t.app, "patch", `/api/tasks/${id}`, { title: "Renamed" }, s.mgr.cookie)).status).toBe(200); // no change: no audit row
    expect((await audit(s.owner)).filter((e) => e.action === "task.update")).toHaveLength(2);
    await post(t.app, `/api/tasks/${id}/updates`, { type: "status_change", toStatus: "cancelled" }, s.mgr.cookie);
    expect(code(await send(t.app, "patch", `/api/tasks/${id}`, { title: "Too late" }, s.mgr.cookie))).toBe("task_closed");
  });

  it("assign and unassign: scope-checked, notified, audited, history kept; duplicates and closed tasks refused", async () => {
    const s = await setup();
    const id = await created("/api/tasks", { title: "Shared", assigneeIds: [s.emp.membershipId] }, s.mgr.cookie);
    const add = (cookie: string, body: Record<string, unknown>) => post(t.app, `/api/tasks/${id}/assignments`, body, cookie);
    expect((await add(s.emp.cookie, { assigneeId: s.mate.membershipId })).status).toBe(403); // employees cannot assign
    expect(code(await add(s.mgr.cookie, { assigneeId: s.stranger.membershipId }))).toBe("outside_scope");
    expect(code(await add(s.mgr.cookie, { assigneeId: s.emp.membershipId }))).toBe("already_assigned");
    expect(code(await add(s.mgr.cookie, {}))).toBe("validation_failed");
    expect((await add(s.mgr.cookie, { assigneeId: s.mgr.membershipId })).status).toBe(201); // a manager is in their own scope
    expect((await add(s.owner, { teamId: s.core })).body.data.assignees.map((a: { name: string }) => a.name).sort()).toEqual(["Core", "Emma Employee", "Max Manager"]);
    const d = (await get(t.app, `/api/tasks/${id}`, s.emp.cookie)).body.data;
    const emmaRow = d.assignees.find((a: { id: string }) => a.id === s.emp.membershipId).assignmentId;
    const gone = await post(t.app, `/api/tasks/${id}/assignments/${emmaRow}/end`, undefined, s.mgr.cookie);
    expect(gone.status).toBe(200);
    expect(gone.body.data.assignees.map((a: { id: string }) => a.id)).not.toContain(s.emp.membershipId);
    expect(code(await post(t.app, `/api/tasks/${id}/assignments/${emmaRow}/end`, undefined, s.mgr.cookie))).toBe("already_ended");
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM task_assignments WHERE task_id = ?", id).n).toBe(3); // nothing deleted
    expect((await audit(s.owner)).filter((e) => e.action === "task.assign" || e.action === "task.unassign").length).toBe(3);
    // team tasks are done by team members: Emma is in Core, so the team assignment still lets her update it
    expect((await post(t.app, `/api/tasks/${id}/updates`, { type: "time_log", minutesLogged: 10 }, s.emp.cookie)).status).toBe(201);
    await post(t.app, `/api/tasks/${id}/updates`, { type: "status_change", toStatus: "cancelled" }, s.mgr.cookie);
    expect(code(await add(s.mgr.cookie, { assigneeId: s.mate.membershipId }))).toBe("task_closed");
  });
});

describe("comments", () => {
  it("anyone who can see a task can comment; only the author edits or deletes (soft); others are notified, the author is not", async () => {
    const s = await setup();
    const id = await created("/api/tasks", { title: "Discuss", assigneeIds: [s.emp.membershipId] }, s.mgr.cookie);
    const c = await post(t.app, `/api/tasks/${id}/comments`, { body: "  Looks good  " }, s.emp.cookie);
    expect(c.status).toBe(201);
    expect(c.body.data).toMatchObject({ body: "Looks good", mine: true, author: { name: "Emma Employee" } });
    expect((await inbox(s.mgr.cookie)).notifications.map((n) => n.type)).toContain("task.comment");
    expect((await inbox(s.emp.cookie)).notifications.filter((n) => n.type === "task.comment")).toHaveLength(0);
    expect(code(await post(t.app, `/api/tasks/${id}/comments`, { body: "   " }, s.emp.cookie))).toBe("invalid_text");
    expect((await send(t.app, "patch", `/api/tasks/${id}/comments/${c.body.data.id}`, { body: "Changed" }, s.mgr.cookie)).status).toBe(403);
    const edited = await send(t.app, "patch", `/api/tasks/${id}/comments/${c.body.data.id}`, { body: "Changed" }, s.emp.cookie);
    expect(edited.body.data).toMatchObject({ body: "Changed", edited: true });
    expect((await get(t.app, `/api/tasks/${id}/comments`, s.mgr.cookie)).body.data[0]).toMatchObject({ body: "Changed", mine: false });
    const del = (cookie: string) => request(t.app).delete(`/api/tasks/${id}/comments/${c.body.data.id}`).set("Origin", ORIGIN).set("Cookie", cookie);
    expect((await del(s.mgr.cookie)).status).toBe(403);
    expect((await del(s.emp.cookie)).status).toBe(200);
    expect((await get(t.app, `/api/tasks/${id}/comments`, s.mgr.cookie)).body.data).toEqual([]);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM task_comments WHERE deleted_at IS NOT NULL").n).toBe(1); // soft delete: the row stays
  });
});

describe("rule-based suggested order", () => {
  const T = (id: string, p: Partial<{ status: string; priority: string; importanceWeight: number; dueAt: string | null }>) => ({ id, status: "not_started", priority: "medium", importanceWeight: 3, dueAt: null, ...p });
  it("overdue first (the later, the higher), then today, tomorrow, then priority and importance with this week's deadlines, under-way work lifted; blocked work always last; every task says why", () => {
    const r = suggestOrder([
      T("later", { dueAt: "2026-06-20" }),
      T("blocked", { status: "blocked", priority: "critical", dueAt: "2026-06-05" }),
      T("today", { dueAt: "2026-06-10" }),
      T("overdue1", { dueAt: "2026-06-09" }),
      T("overdue5", { dueAt: "2026-06-05" }),
      T("tomorrow", { dueAt: "2026-06-11" }),
      T("critical", { priority: "critical" }),
      T("week", { dueAt: "2026-06-15" }),
      T("underway", { status: "in_progress" }),
      T("plain", {}),
    ], "2026-06-10");
    expect(r.map((x) => x.id)).toEqual(["overdue5", "overdue1", "today", "tomorrow", "critical", "week", "underway", "later", "plain", "blocked"]);
    expect(r.find((x) => x.id === "overdue5")!.reasons).toEqual(["Overdue by 5 days"]);
    expect(r.find((x) => x.id === "overdue1")!.reasons).toEqual(["Overdue by 1 day"]);
    expect(r.find((x) => x.id === "today")!.reasons).toEqual(["Due today"]);
    expect(r.find((x) => x.id === "critical")!.reasons).toEqual(["Critical priority"]);
    expect(r.find((x) => x.id === "blocked")!.reasons[0]).toMatch(/^Blocked:/);
    expect(r.find((x) => x.id === "plain")!.reasons).toEqual(["No deadline pressure; ordered by priority and importance"]);
    expect(r.every((x) => x.reasons.length > 0)).toBe(true);
  });
  it("is deterministic: equal scores order by due day then id, and importance breaks priority ties", () => {
    const a = suggestOrder([T("b", { importanceWeight: 5 }), T("a", { importanceWeight: 5 }), T("c", { importanceWeight: 2 })], "2026-06-10");
    expect(a.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(a.find((x) => x.id === "a")!.reasons).toContain("Importance 5 of 5");
  });
});

describe("My Work and the daily update", () => {
  it("groups your own open tasks, orders them with reasons, lists recent achievements, and is private to you", async () => {
    const s = await setup();
    await task(s.emp.cookie, { title: "Overdue one", dueAt: dayOffset(-2) });
    await task(s.emp.cookie, { title: "Today one", dueAt: dayOffset(0), priority: "high" });
    await task(s.emp.cookie, { title: "Soon one", dueAt: dayOffset(4) });
    await task(s.emp.cookie, { title: "Someday one" });
    const stuck = await task(s.emp.cookie, { title: "Stuck one" });
    await post(t.app, `/api/tasks/${stuck}/updates`, { type: "status_change", toStatus: "blocked", note: "Waiting" }, s.emp.cookie);
    const going = await task(s.emp.cookie, { title: "Going one" });
    await post(t.app, `/api/tasks/${going}/updates`, { type: "status_change", toStatus: "in_progress" }, s.emp.cookie);
    const fin = await task(s.emp.cookie, { title: "Finished one" });
    await post(t.app, `/api/tasks/${fin}/updates`, { type: "status_change", toStatus: "in_progress" }, s.emp.cookie);
    await post(t.app, `/api/tasks/${fin}/updates`, { type: "status_change", toStatus: "completed" }, s.emp.cookie);
    await task(s.mate.cookie, { title: "Tom's task" });
    const w = (await get(t.app, "/api/my-work", s.emp.cookie)).body.data;
    const titles = (xs: { title: string }[]) => xs.map((x) => x.title);
    expect(titles(w.overdue)).toEqual(["Overdue one"]);
    expect(titles(w.dueToday)).toEqual(["Today one"]);
    expect(titles(w.upcoming)).toEqual(["Soon one"]);
    expect(titles(w.blocked)).toEqual(["Stuck one"]);
    expect(titles(w.inProgress)).toEqual(["Going one"]);
    expect(titles(w.unscheduled)).toEqual(["Someday one"]);
    expect(titles(w.achievements)).toEqual(["Finished one"]);
    expect(w.counts).toEqual({ open: 6, overdue: 1, dueToday: 1, blocked: 1, completedRecently: 1 });
    expect(w.suggested[0].task.title).toBe("Overdue one");
    expect(w.suggested[0].reasons[0]).toBe("Overdue by 2 days");
    expect(w.suggested.at(-1).task.title).toBe("Stuck one");
    expect(JSON.stringify(w)).not.toContain("Tom's task");
    expect(w.dailyUpdate).toBeNull();
  });

  it("works for someone with no role and for a person with no work at all", async () => {
    const s = await setup();
    const none = await addPerson(t.app, s.owner, "none@example.com", undefined, "No Role");
    const w = (await get(t.app, "/api/my-work", none.cookie)).body.data;
    expect(w.counts.open).toBe(0);
    expect(w.suggested).toEqual([]);
  });

  it("the daily update: one per day (sending again replaces it), only today or yesterday, event written once, own list only", async () => {
    const s = await setup();
    const first = await post(t.app, "/api/daily-updates", { summary: "Wrote the spec", blockers: "None" }, s.emp.cookie);
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ date: dayOffset(0), replaced: false });
    const again = await post(t.app, "/api/daily-updates", { summary: "Wrote the spec and reviewed two PRs" }, s.emp.cookie);
    expect(again.body.data.replaced).toBe(true);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM daily_updates").n).toBe(1);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM automation_events WHERE event_type = 'daily_update.submitted'").n).toBe(1);
    expect((await post(t.app, "/api/daily-updates", { summary: "Yesterday's", date: dayOffset(-1) }, s.emp.cookie)).status).toBe(201);
    expect(code(await post(t.app, "/api/daily-updates", { summary: "Too old", date: dayOffset(-3) }, s.emp.cookie))).toBe("invalid_date");
    expect(code(await post(t.app, "/api/daily-updates", { summary: "Future", date: dayOffset(1) }, s.emp.cookie))).toBe("invalid_date");
    expect(code(await post(t.app, "/api/daily-updates", { summary: "   " }, s.emp.cookie))).toBe("invalid_text");
    expect((await get(t.app, "/api/my-work", s.emp.cookie)).body.data.dailyUpdate).toMatchObject({ summary: "Wrote the spec and reviewed two PRs" });
    const mine = (await get(t.app, "/api/daily-updates", s.emp.cookie)).body.data as { date: string }[];
    expect(mine.map((d) => d.date)).toEqual([dayOffset(0), dayOffset(-1)]);
    expect((await get(t.app, "/api/daily-updates", s.mate.cookie)).body.data).toEqual([]); // nobody else's
  });
});

describe("notifications (the bell)", () => {
  it("lists yours newest first with the unread count, marks one or all read, and refuses someone else's", async () => {
    const s = await setup();
    for (const title of ["One", "Two", "Three"]) await created("/api/tasks", { title, assigneeIds: [s.emp.membershipId] }, s.mgr.cookie);
    const all = await inbox(s.emp.cookie);
    expect(all.notifications.map((n) => n.body)).toEqual(["Three", "Two", "One"]);
    expect(all.unreadCount).toBe(3);
    const r = await post(t.app, `/api/notifications/${all.notifications[0]!.id}/read`, undefined, s.emp.cookie);
    expect(r.body.data.unreadCount).toBe(2);
    expect((await inbox(s.emp.cookie, "?unread=true")).notifications).toHaveLength(2);
    expect((await post(t.app, `/api/notifications/${all.notifications[1]!.id}/read`, undefined, s.mgr.cookie)).status).toBe(404); // not yours
    const page1 = await inbox(s.emp.cookie, "?limit=2");
    expect(page1.notifications).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await inbox(s.emp.cookie, `?limit=2&cursor=${page1.nextCursor}`);
    expect(page2.notifications.map((n) => n.body)).toEqual(["One"]);
    expect(page2.nextCursor).toBeNull();
    expect((await post(t.app, "/api/notifications/read-all", undefined, s.emp.cookie)).body.data).toMatchObject({ marked: 2, unreadCount: 0 });
  });

  it("preferences switch a kind off for that person only, and an unknown kind is refused", async () => {
    const s = await setup();
    const prefs = (await get(t.app, "/api/preferences", s.emp.cookie)).body.data.types as { type: string; inApp: boolean }[];
    expect(prefs.map((p) => p.type)).toEqual(["task.assigned", "task.blocked", "task.completed", "task.comment", "task.due_soon", "task.overdue", "task.reviewed"]);
    expect(prefs.every((p) => p.inApp)).toBe(true);
    const off = await send(t.app, "put", "/api/preferences", { types: [{ type: "task.assigned", inApp: false }] }, s.emp.cookie);
    expect(off.body.data.types.find((p: { type: string }) => p.type === "task.assigned").inApp).toBe(false);
    expect(code(await send(t.app, "put", "/api/preferences", { types: [{ type: "task.nonsense", inApp: false }] }, s.emp.cookie))).toBe("unknown_type");
    await created("/api/tasks", { title: "Muted", assigneeIds: [s.emp.membershipId] }, s.mgr.cookie);
    await created("/api/tasks", { title: "Heard", assigneeIds: [s.mgr.membershipId] }, s.owner);
    expect((await inbox(s.emp.cookie)).notifications).toHaveLength(0); // switched off for Emma
    expect((await inbox(s.mgr.cookie)).notifications.map((n) => n.type)).toEqual(["task.assigned"]); // the manager's own setting is untouched
  });
});

describe("overdue and due-soon reminders (the tick)", () => {
  const tick = () => t.tick.run();
  it("tells the people doing an overdue task, and its creator, once; a second run repeats nothing", async () => {
    const s = await setup();
    const late = await created("/api/tasks", { title: "Late report", assigneeIds: [s.emp.membershipId], dueAt: dayOffset(-2) }, s.mgr.cookie);
    await task(s.emp.cookie, { title: "Not due", dueAt: dayOffset(10) });
    const done = await task(s.emp.cookie, { title: "Done late", dueAt: dayOffset(-5) });
    await post(t.app, `/api/tasks/${done}/updates`, { type: "status_change", toStatus: "in_progress" }, s.emp.cookie);
    await post(t.app, `/api/tasks/${done}/updates`, { type: "status_change", toStatus: "completed" }, s.emp.cookie);
    const run = await tick();
    expect(run.ran).toContain("tasks.reminders");
    const emma = (await inbox(s.emp.cookie)).notifications.filter((n) => n.type === "task.overdue");
    expect(emma.map((n) => n.title)).toEqual(["Overdue: Late report"]);
    expect(emma[0]).toMatchObject({ entityId: late });
    expect(emma[0]!.body).toBe(`This was due on ${dayOffset(-2)} (2 days ago).`);
    expect((await inbox(s.mgr.cookie)).notifications.filter((n) => n.type === "task.overdue").map((n) => n.title)).toEqual(["Overdue: Late report"]); // the creator too
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM automation_events WHERE event_type = 'task.overdue'").n).toBe(1);
    // run again (the job's own interval is bypassed by clearing its last run): nothing is repeated
    t.db.prepare("DELETE FROM scheduled_job_runs WHERE job_name = 'tasks.reminders'").run();
    await tick();
    expect((await inbox(s.emp.cookie)).notifications.filter((n) => n.type === "task.overdue")).toHaveLength(1);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM automation_events WHERE event_type = 'task.overdue'").n).toBe(1);
  });

  it("due today and due tomorrow are 'due soon' for the doers only; moving the due date announces it again; finishing stops it", async () => {
    const s = await setup();
    const a = await created("/api/tasks", { title: "Due today", assigneeIds: [s.emp.membershipId], dueAt: dayOffset(0) }, s.mgr.cookie);
    await created("/api/tasks", { title: "Due tomorrow", assigneeIds: [s.emp.membershipId], dueAt: dayOffset(1) }, s.mgr.cookie);
    await created("/api/tasks", { title: "Due next week", assigneeIds: [s.emp.membershipId], dueAt: dayOffset(7) }, s.mgr.cookie);
    await tick();
    const soon = (await inbox(s.emp.cookie)).notifications.filter((n) => n.type === "task.due_soon").map((n) => n.title).sort();
    expect(soon).toEqual(["Due today: Due today", "Due tomorrow: Due tomorrow"]);
    expect((await inbox(s.mgr.cookie)).notifications.filter((n) => n.type === "task.due_soon")).toHaveLength(0); // the creator is told only when it is late
    // the due date moves: a new notice for the new date
    await send(t.app, "patch", `/api/tasks/${a}`, { dueAt: dayOffset(1) }, s.mgr.cookie);
    t.db.prepare("DELETE FROM scheduled_job_runs WHERE job_name = 'tasks.reminders'").run();
    await tick();
    expect((await inbox(s.emp.cookie)).notifications.filter((n) => n.type === "task.due_soon")).toHaveLength(3);
    // finishing it: tomorrow it would be overdue, but a finished task is never reminded
    await post(t.app, `/api/tasks/${a}/updates`, { type: "status_change", toStatus: "in_progress" }, s.emp.cookie);
    await post(t.app, `/api/tasks/${a}/updates`, { type: "status_change", toStatus: "completed" }, s.emp.cookie);
    t.db.prepare("UPDATE tasks SET due_at = ? WHERE id = ?").run(dayOffset(-4), a);
    t.db.prepare("DELETE FROM scheduled_job_runs WHERE job_name = 'tasks.reminders'").run();
    await tick();
    expect((await inbox(s.emp.cookie)).notifications.filter((n) => n.type === "task.overdue")).toHaveLength(0);
  });

  it("respects preferences, does not tell people who left, and keeps organizations apart", async () => {
    const s = await setup();
    await send(t.app, "put", "/api/preferences", { types: [{ type: "task.overdue", inApp: false }] }, s.emp.cookie);
    await created("/api/tasks", { title: "Late", assigneeIds: [s.emp.membershipId], dueAt: dayOffset(-1) }, s.mgr.cookie);
    const ownerB = await signUpWithOrg(t.app, "b-owner@example.com", "Beta Co");
    const bTask = await task(ownerB, { title: "Beta late", dueAt: dayOffset(-1) });
    await tick();
    expect((await inbox(s.emp.cookie)).notifications.filter((n) => n.type === "task.overdue")).toHaveLength(0); // switched off
    expect((await inbox(s.mgr.cookie)).notifications.filter((n) => n.type === "task.overdue")).toHaveLength(1); // the creator did not
    const betaIn = await inbox(ownerB);
    expect(betaIn.notifications.map((n) => n.title)).toEqual(["Overdue: Beta late"]);
    expect(betaIn.notifications[0]!.entityId).toBe(bTask);
    expect(JSON.stringify(betaIn)).not.toMatch(/Late\b(?! )|Acme|Emma/);
  });
});

describe("tasks and deleting an account", () => {
  it("the last person deleting an otherwise empty organization takes its tasks, updates, comments, notifications and events with it", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const id = await task(owner, { title: "Gone" });
    await post(t.app, `/api/tasks/${id}/comments`, { body: "bye" }, owner);
    await post(t.app, `/api/tasks/${id}/updates`, { type: "time_log", minutesLogged: 5 }, owner);
    await post(t.app, "/api/daily-updates", { summary: "x" }, owner);
    await send(t.app, "put", "/api/preferences", { types: [{ type: "task.assigned", inApp: false }] }, owner);
    const del = await post(t.app, "/api/auth/delete-account", { password: "correct horse battery", confirmEmail: "owner@example.com", confirmOrganizationName: "Acme" }, owner);
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    for (const table of ["tasks", "task_assignments", "task_updates", "task_comments", "daily_updates", "notifications", "notification_preferences", "automation_events"]) expect(one<{ n: number }>(`SELECT COUNT(*) n FROM ${table}`).n, table).toBe(0);
  });
});
