import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { ORIGIN, type TestApp } from "./helpers/app.js";
import { get, makeAuthApp, post, signUpWithOrg } from "./helpers/auth.js";
import { addPerson, roleIds } from "./helpers/roles.js";

let t: TestApp;
afterEach(() => t?.cleanup());

const send = (method: "patch" | "delete", path: string, body: Record<string, unknown> | undefined, cookie: string) => {
  const r = request(t.app)[method](path).set("Origin", ORIGIN).set("Cookie", cookie);
  return body ? r.send(body) : r;
};
const created = async (path: string, body: Record<string, unknown>, cookie: string): Promise<string> => {
  const r = await post(t.app, path, body, cookie);
  expect(r.status, `${path} ${JSON.stringify(r.body)}`).toBe(201);
  return r.body.data.id as string;
};
const year = { startDate: "2026-01-01", endDate: "2026-12-31" };
const finish = async (id: string, cookie: string) => {
  await post(t.app, `/api/tasks/${id}/updates`, { type: "status_change", toStatus: "in_progress" }, cookie);
  return post(t.app, `/api/tasks/${id}/updates`, { type: "status_change", toStatus: "completed" }, cookie);
};

describe("task links, dependencies, outcomes and review (stage 4.2)", () => {
  it("links a task to an objective and key result, shows them in the task, filters by them and finds the unaligned ones", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const o = (await post(t.app, "/api/objectives", { level: "company", title: "Win customers", ...year, keyResults: [{ title: "Signed deals", targetValue: 10 }] }, owner)).body.data;
    const kr = o.keyResults[0].id as string;
    const a = await created("/api/tasks", { title: "Call leads" }, owner);
    const b = await created("/api/tasks", { title: "Tidy desk" }, owner);
    // a key result implies its objective
    const linked = await send("patch", `/api/tasks/${a}`, { keyResultId: kr }, owner);
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect(linked.body.data).toMatchObject({ objectiveId: o.id, keyResultId: kr, links: { objective: { id: o.id, title: "Win customers" }, keyResult: { id: kr, title: "Signed deals" }, hidden: false } });
    expect((await get(t.app, `/api/tasks?objectiveId=${o.id}`, owner)).body.data.tasks.map((x: { title: string }) => x.title)).toEqual(["Call leads"]);
    expect((await get(t.app, "/api/tasks?unaligned=true", owner)).body.data.tasks.map((x: { title: string }) => x.title)).toEqual(["Tidy desk"]);
    expect((await get(t.app, `/api/objectives/${o.id}`, owner)).body.data.tasks).toEqual({ total: 1, open: 1 });
    // a key result of another objective cannot be paired with this one; unlinking works; the change is audited
    const o2 = (await post(t.app, "/api/objectives", { level: "company", title: "Other", ...year, keyResults: [{ title: "k2", targetValue: 5 }] }, owner)).body.data;
    expect((await send("patch", `/api/tasks/${b}`, { objectiveId: o.id, keyResultId: o2.keyResults[0].id }, owner)).body.error.code).toBe("link_mismatch");
    expect((await send("patch", `/api/tasks/${a}`, { objectiveId: null }, owner)).body.data).toMatchObject({ objectiveId: null, keyResultId: null });
    expect(t.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action = 'task.update'").get()).toEqual({ n: 2 });
  });

  it("a person cannot link a task to an objective they cannot see, and the task never reveals a hidden objective's title", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ids = await roleIds(t.app, owner);
    const emp = await addPerson(t.app, owner, "emp@example.com", ids.employee, "Emma Employee");
    const secret = (await post(t.app, "/api/objectives", { level: "company", title: "Secret restructuring", ...year, lifecycle: "draft" }, owner)).body.data;
    const mine = await created("/api/tasks", { title: "Emma's task" }, emp.cookie);
    expect((await send("patch", `/api/tasks/${mine}`, { objectiveId: secret.id }, emp.cookie)).status).toBe(404);
    // the Owner links Emma's task to the secret objective; Emma sees the task but only that it is linked
    expect((await send("patch", `/api/tasks/${mine}`, { objectiveId: secret.id }, owner)).status).toBe(200);
    const seen = (await get(t.app, `/api/tasks/${mine}`, emp.cookie)).body.data;
    expect(seen.links).toEqual({ objective: null, keyResult: null, hidden: true });
    expect(JSON.stringify(seen)).not.toContain("Secret restructuring");
  });

  it("dependencies: a loop is refused, a task cannot finish before what it waits for, and removing the dependency frees it", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const a = await created("/api/tasks", { title: "Design" }, owner);
    const b = await created("/api/tasks", { title: "Build" }, owner);
    const c = await created("/api/tasks", { title: "Ship" }, owner);
    expect((await post(t.app, `/api/tasks/${b}/dependencies`, { dependsOnId: a }, owner)).status).toBe(201);
    expect((await post(t.app, `/api/tasks/${c}/dependencies`, { dependsOnId: b }, owner)).status).toBe(201);
    expect((await post(t.app, `/api/tasks/${b}/dependencies`, { dependsOnId: a }, owner)).body.error.code).toBe("already_dependent");
    expect((await post(t.app, `/api/tasks/${a}/dependencies`, { dependsOnId: c }, owner)).body.error.code).toBe("dependency_loop"); // a → c → b → a
    expect((await post(t.app, `/api/tasks/${a}/dependencies`, { dependsOnId: a }, owner)).body.error.code).toBe("self_dependency");
    const detail = (await get(t.app, `/api/tasks/${b}`, owner)).body.data;
    expect(detail).toMatchObject({ waitingOn: 1, dependsOn: [{ id: a, title: "Design", visible: true }], blocking: [{ id: c, title: "Ship" }] });
    // Build cannot be completed while Design is open
    await post(t.app, `/api/tasks/${b}/updates`, { type: "status_change", toStatus: "in_progress" }, owner);
    const refused = await post(t.app, `/api/tasks/${b}/updates`, { type: "status_change", toStatus: "completed" }, owner);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("waiting_on_tasks");
    expect((await get(t.app, "/api/tasks?waiting=true", owner)).body.data.tasks.map((x: { title: string }) => x.title).sort()).toEqual(["Build", "Ship"]);
    // finishing Design lets Build finish
    expect((await finish(a, owner)).status).toBe(201);
    expect((await get(t.app, `/api/tasks/${b}`, owner)).body.data.waitingOn).toBe(0);
    expect((await post(t.app, `/api/tasks/${b}/updates`, { type: "status_change", toStatus: "completed" }, owner)).status).toBe(201);
    // removal: Ship no longer waits for Build
    expect((await send("delete", `/api/tasks/${c}/dependencies/${b}`, undefined, owner)).body.data.dependsOn).toEqual([]);
    expect((await send("delete", `/api/tasks/${c}/dependencies/${b}`, undefined, owner)).status).toBe(404);
    expect(t.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action LIKE 'task.dependency_%'").get()).toEqual({ n: 3 });
  });

  it("the suggested order puts waiting work behind workable work", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const first = await created("/api/tasks", { title: "Waiting", priority: "critical" }, owner);
    const dep = await created("/api/tasks", { title: "Prerequisite", priority: "low" }, owner);
    await post(t.app, `/api/tasks/${first}/dependencies`, { dependsOnId: dep }, owner);
    const mw = (await get(t.app, "/api/my-work", owner)).body.data;
    const order = (mw.suggested ?? mw.order ?? []) as { task?: { title: string }; reasons?: string[] }[];
    const titles = order.map((x) => x.task?.title);
    expect(titles.indexOf("Prerequisite")).toBeLessThan(titles.indexOf("Waiting"));
    expect(order.find((x) => x.task?.title === "Waiting")!.reasons).toEqual(["Waiting for another task to finish first"]);
  });

  it("an outcome needs a finished task; with a value it can also record the key result's actual value in the same step; finishing alone moves nothing", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const o = (await post(t.app, "/api/objectives", { level: "company", title: "Win", ...year, keyResults: [{ title: "Deals", targetValue: 10 }] }, owner)).body.data;
    const kr = o.keyResults[0].id as string;
    const task = await created("/api/tasks", { title: "Close ACME" }, owner);
    await send("patch", `/api/tasks/${task}`, { keyResultId: kr }, owner);
    expect((await post(t.app, `/api/tasks/${task}/outcome`, { summary: "early" }, owner)).body.error.code).toBe("not_finished");
    await finish(task, owner);
    expect((await get(t.app, `/api/objectives/${o.id}`, owner)).body.data.attainmentPct).toBeNull(); // completing a task never moves an objective
    expect((await post(t.app, `/api/tasks/${task}/outcome`, { summary: "Signed", recordOnKeyResult: true }, owner)).body.error.code).toBe("value_required");
    const r = await post(t.app, `/api/tasks/${task}/outcome`, { summary: "Signed the contract", value: 4, recordOnKeyResult: true }, owner);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.outcome).toMatchObject({ summary: "Signed the contract", value: 4, quality: null });
    const obj = (await get(t.app, `/api/objectives/${o.id}`, owner)).body.data;
    expect(obj.keyResults[0]).toMatchObject({ currentValue: 4, attainmentPct: 40 });
    expect(t.db.prepare("SELECT source FROM objective_progress_history WHERE key_result_id = ?").get(kr)).toEqual({ source: "task_outcome" });
    expect(t.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action = 'task.outcome'").get()).toEqual({ n: 1 });
  });

  it("a reviewer rates finished work from 1 to 5, never their own, and the person is told", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ids = await roleIds(t.app, owner);
    const mgr = await addPerson(t.app, owner, "mgr@example.com", ids.manager, "Max Manager");
    const emp = await addPerson(t.app, owner, "emp@example.com", ids.employee, "Emma Employee");
    await post(t.app, "/api/hierarchy/reporting", { subordinateId: emp.membershipId, managerId: mgr.membershipId }, owner);
    const task = await created("/api/tasks", { title: "Write the report", assigneeIds: [emp.membershipId] }, mgr.cookie);
    expect((await post(t.app, `/api/tasks/${task}/review`, { quality: 4 }, mgr.cookie)).body.error.code).toBe("not_finished");
    await finish(task, emp.cookie);
    expect((await post(t.app, `/api/tasks/${task}/review`, { quality: 4 }, emp.cookie)).status).toBe(403); // the employee has no task.review
    expect((await post(t.app, `/api/tasks/${task}/review`, { quality: 6 }, mgr.cookie)).status).toBe(400);
    const r = await post(t.app, `/api/tasks/${task}/review`, { quality: 4, note: "Clear and on time" }, mgr.cookie);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.outcome).toMatchObject({ quality: 4, reviewedBy: { name: "Max Manager" } });
    const inbox = (await get(t.app, "/api/notifications", emp.cookie)).body.data.notifications as { type: string; body: string }[];
    expect(inbox.filter((n) => n.type === "task.reviewed").map((n) => n.body)).toEqual(["Write the report: 4 of 5"]);
    // a manager who did the task alone cannot rate it
    const own = await created("/api/tasks", { title: "Manager's own" }, mgr.cookie);
    await finish(own, mgr.cookie);
    expect((await post(t.app, `/api/tasks/${own}/review`, { quality: 5 }, mgr.cookie)).status).toBe(403);
    expect(t.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action = 'task.review'").get()).toEqual({ n: 1 });
  });
});
