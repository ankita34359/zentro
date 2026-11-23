import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { objectiveHealth } from "../backend/src/modules/okr/health.js";
import { ORIGIN, type TestApp } from "./helpers/app.js";
import { get, makeAuthApp, post, signUpWithOrg } from "./helpers/auth.js";
import { addPerson, roleIds } from "./helpers/roles.js";

let t: TestApp;
afterEach(() => t?.cleanup());

const send = (method: "patch" | "put" | "delete", path: string, body: Record<string, unknown> | undefined, cookie: string) => {
  const r = request(t.app)[method](path).set("Origin", ORIGIN).set("Cookie", cookie);
  return body ? r.send(body) : r;
};
const one = <T>(sql: string, ...p: unknown[]) => t.db.prepare(sql).get(...p) as T;
const created = async (path: string, body: Record<string, unknown>, cookie: string): Promise<string> => {
  const r = await post(t.app, path, body, cookie);
  expect(r.status, `${path} ${JSON.stringify(r.body)}`).toBe(201);
  return r.body.data.id as string;
};
const dayOffset = (n: number): string => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe("objective health (golden values)", () => {
  const h = (over: Partial<Parameters<typeof objectiveHealth>[0]>) => objectiveHealth({ lifecycle: "active", startDate: "2026-01-01", endDate: "2026-01-11", today: "2026-01-06", progress: 0.5, ...over });
  it("on track, at risk and delayed by the ratio of progress to the time that has passed", () => {
    expect(h({ progress: 0.5 })).toMatchObject({ health: "on_track", elapsed: 0.5 });
    expect(h({ progress: 0.45 }).health).toBe("on_track"); // ratio 0.90 exactly
    expect(h({ progress: 0.35 })).toMatchObject({ health: "at_risk" }); // ratio 0.70
    expect(h({ progress: 0.2 }).health).toBe("delayed"); // ratio 0.40
    expect(h({ progress: 0.3 }).health).toBe("at_risk"); // ratio 0.60 exactly
    expect(h({ progress: 0.35 }).reason).toBe("Behind pace: progress 35% vs 50% expected (ratio 0.70).");
  });
  it("completed, not started, delayed after the end, and no data", () => {
    expect(h({ progress: 1 }).health).toBe("completed");
    expect(h({ lifecycle: "completed", progress: 0.3 }).health).toBe("completed");
    expect(h({ today: "2025-12-30" }).health).toBe("not_started");
    expect(h({ lifecycle: "draft" }).health).toBe("not_started");
    expect(h({ today: "2026-01-12", progress: 0.9 })).toMatchObject({ health: "delayed" });
    expect(h({ today: "2026-01-06", progress: null })).toMatchObject({ health: "no_data" });
    expect(h({ today: "2026-01-01", progress: null }).health).toBe("not_started"); // too early to say
    expect(h({ today: "2026-01-01", progress: 0.1 }).health).toBe("on_track"); // under 5% elapsed: nothing to compare with
    expect(h({ lifecycle: "cancelled" }).health).toBeNull();
  });
  it("a one-day objective never divides by zero", () => {
    expect(Number.isFinite(h({ startDate: "2026-01-06", endDate: "2026-01-06", today: "2026-01-06", progress: 0.2 }).elapsed)).toBe(true);
  });
});

describe("alignment and health (stage 3.2)", () => {
  const year = { startDate: dayOffset(-100), endDate: dayOffset(100) };

  it("shows the health and the reason on an objective, from the recorded values and the time that has passed", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const o = (await post(t.app, "/api/objectives", { level: "company", title: "Grow", ...year, keyResults: [{ title: "Deals", targetValue: 100 }] }, owner)).body.data;
    expect(o.health).toBe("no_data");
    expect(o.healthReason).toMatch(/no key result has a recorded value/);
    const behind = (await post(t.app, `/api/key-results/${o.keyResults[0].id}/progress`, { value: 10 }, owner)).body.data;
    expect(behind).toMatchObject({ health: "delayed", attainmentPct: 10 });
    expect(behind.healthReason).toMatch(/Well behind pace: progress 10% vs 50% expected/);
    const mid = (await post(t.app, `/api/key-results/${o.keyResults[0].id}/progress`, { value: 40 }, owner)).body.data;
    expect(mid.health).toBe("at_risk");
    const good = (await post(t.app, `/api/key-results/${o.keyResults[0].id}/progress`, { value: 60 }, owner)).body.data;
    expect(good.health).toBe("on_track");
  });

  it("tells the owner once when an objective falls behind (event and notice with a dedupe key), and the hourly sweep catches an objective that slipped by itself", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ids = await roleIds(t.app, owner);
    const lead = await addPerson(t.app, owner, "lead@example.com", ids.manager, "Lena Lead");
    const o = (await post(t.app, "/api/objectives", { level: "individual", ownerId: lead.membershipId, title: "Lena's goal", ...year, keyResults: [{ title: "k", targetValue: 100 }] }, owner)).body.data;
    await post(t.app, `/api/key-results/${o.keyResults[0].id}/progress`, { value: 20 }, owner);
    const notices = async () => ((await get(t.app, "/api/notifications", lead.cookie)).body.data.notifications as { type: string; title: string }[]).filter((n) => n.type === "objective.at_risk");
    expect((await notices()).map((n) => n.title)).toEqual(["Delayed: Lena's goal"]);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM automation_events WHERE event_type = 'objective.at_risk'").n).toBe(1);
    // recording the same state again repeats nothing
    await post(t.app, `/api/key-results/${o.keyResults[0].id}/progress`, { value: 21 }, owner);
    expect(await notices()).toHaveLength(1);
    // the sweep: an objective with data that was fine, then time passes (its end date moves into the past by editing the row directly: nobody touched the objective)
    const o2 = (await post(t.app, "/api/objectives", { level: "company", title: "Quiet one", ...year, keyResults: [{ title: "k", targetValue: 100 }] }, owner)).body.data;
    await post(t.app, `/api/key-results/${o2.keyResults[0].id}/progress`, { value: 50 }, owner);
    expect(one<{ health: string }>("SELECT health FROM objectives WHERE id = ?", o2.id).health).toBe("on_track");
    t.db.prepare("UPDATE objectives SET end_date = ? WHERE id = ?").run(dayOffset(-1), o2.id);
    t.db.prepare("DELETE FROM scheduled_job_runs WHERE job_name = 'okr.health'").run();
    const run = await t.tick.run();
    expect(run.ran).toContain("okr.health");
    expect(one<{ health: string; health_reason: string }>("SELECT health, health_reason FROM objectives WHERE id = ?", o2.id)).toMatchObject({ health: "delayed" });
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM automation_events WHERE event_type = 'objective.at_risk' AND entity_id = ?", o2.id).n).toBe(1);
    // a second sweep changes nothing
    t.db.prepare("DELETE FROM scheduled_job_runs WHERE job_name = 'okr.health'").run();
    await t.tick.run();
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM automation_events WHERE event_type = 'objective.at_risk'").n).toBe(2);
  });

  it("aligns a department objective to a company one: the tree shows the contribution; levels, loops and permissions are enforced", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ids = await roleIds(t.app, owner);
    const emp = await addPerson(t.app, owner, "emp@example.com", ids.employee, "Emma Employee");
    const dept = await created("/api/departments", { name: "Engineering" }, owner);
    const company = (await post(t.app, "/api/objectives", { level: "company", title: "Company goal", ...year, keyResults: [{ title: "k", targetValue: 10 }] }, owner)).body.data;
    const d1 = (await post(t.app, "/api/objectives", { level: "department", departmentId: dept, title: "Dept one", ...year, keyResults: [{ title: "k", targetValue: 10 }] }, owner)).body.data;
    const d2 = (await post(t.app, "/api/objectives", { level: "department", departmentId: dept, title: "Dept two", ...year, keyResults: [{ title: "k", targetValue: 10 }] }, owner)).body.data;
    await post(t.app, `/api/key-results/${d1.keyResults[0].id}/progress`, { value: 8 }, owner);
    await post(t.app, `/api/key-results/${d2.keyResults[0].id}/progress`, { value: 4 }, owner);
    expect((await send("put", `/api/objectives/${d1.id}/parent`, { parentId: company.id, weight: 3 }, owner)).status).toBe(200);
    expect((await send("put", `/api/objectives/${d2.id}/parent`, { parentId: company.id, weight: 1 }, owner)).status).toBe(200);
    const tree = (await get(t.app, "/api/objectives/tree", owner)).body.data;
    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0]).toMatchObject({ title: "Company goal", unaligned: false });
    const kids = tree.roots[0].children as { title: string; weight: number; contributionPct: number | null }[];
    expect(kids.map((k) => [k.title, k.weight, k.contributionPct])).toEqual([["Dept one", 3, 60], ["Dept two", 1, 10]]); // share 3/4 × 80% and 1/4 × 40%
    // a company objective cannot contribute to a department one; a loop is refused; a self link is refused
    expect((await send("put", `/api/objectives/${company.id}/parent`, { parentId: d1.id }, owner)).body.error.code).toBe("wrong_level");
    expect((await send("put", `/api/objectives/${d1.id}/parent`, { parentId: d1.id }, owner)).body.error.code).toBe("self_link");
    // detail of the alignment
    const al = (await get(t.app, `/api/objectives/${d1.id}/alignment`, owner)).body.data;
    expect(al.parent).toMatchObject({ weight: 3, objective: { title: "Company goal" } });
    expect((await get(t.app, `/api/objectives/${company.id}/alignment`, owner)).body.data.children.map((c: { objective: { title: string } }) => c.objective.title)).toEqual(["Dept one", "Dept two"]);
    // replacing the parent ends the old link (kept), and un-aligning ends it too
    expect((await send("delete", `/api/objectives/${d2.id}/parent`, undefined, owner)).status).toBe(200);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM objective_relationships WHERE ended_at IS NOT NULL").n).toBe(1);
    expect((await send("delete", `/api/objectives/${d2.id}/parent`, undefined, owner)).status).toBe(404);
    // an employee has no okr.assign: refused; and the audit has both actions
    expect((await send("put", `/api/objectives/${d2.id}/parent`, { parentId: company.id }, emp.cookie)).status).toBe(403);
    const actions = one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs WHERE action IN ('objective.align', 'objective.unalign')").n;
    expect(actions).toBe(3);
  });

  it("a published company objective is readable by a non-manager employee and read only; assignments give visibility and are scoped", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ids = await roleIds(t.app, owner);
    const emp = await addPerson(t.app, owner, "emp@example.com", ids.employee, "Emma Employee");
    const other = await addPerson(t.app, owner, "other@example.com", ids.employee, "Olly Other");
    const dept = await created("/api/departments", { name: "Engineering" }, owner);
    const team = await created("/api/teams", { name: "Core", departmentId: dept }, owner);
    await post(t.app, `/api/teams/${team}/members`, { membershipId: emp.membershipId }, owner);
    const pub = (await post(t.app, "/api/objectives", { level: "company", title: "Published goal", ...year, keyResults: [{ title: "k", targetValue: 10 }] }, owner)).body.data;
    await post(t.app, `/api/objectives/${pub.id}/publish`, { published: true }, owner);
    const seen = (await get(t.app, `/api/objectives/${pub.id}`, emp.cookie)).body.data;
    expect(seen.can).toMatchObject({ edit: false, updateProgress: false });
    expect((await post(t.app, `/api/key-results/${pub.keyResults[0].id}/progress`, { value: 5 }, emp.cookie)).status).toBe(403);
    // an unpublished team objective: invisible to Emma until the team is assigned to it
    const teamObj = (await post(t.app, "/api/objectives", { level: "team", teamId: team, title: "Core goal", ...year }, owner)).body.data;
    expect((await get(t.app, `/api/objectives/${teamObj.id}`, other.cookie)).status).toBe(404);
    const withTeam = await post(t.app, `/api/objectives/${pub.id}/assignments`, { teamId: team, role: "contributor" }, owner);
    expect(withTeam.status, JSON.stringify(withTeam.body)).toBe(201);
    const secret = (await post(t.app, "/api/objectives", { level: "company", title: "Secret company goal", ...year }, owner)).body.data;
    expect((await get(t.app, `/api/objectives/${secret.id}`, emp.cookie)).status).toBe(404);
    expect((await post(t.app, `/api/objectives/${secret.id}/assignments`, { teamId: team }, owner)).status).toBe(201);
    expect((await get(t.app, `/api/objectives/${secret.id}`, emp.cookie)).status).toBe(200); // Emma is in the assigned team
    expect((await get(t.app, `/api/objectives/${secret.id}`, other.cookie)).status).toBe(404);
    expect((await post(t.app, `/api/objectives/${secret.id}/assignments`, { teamId: team }, owner)).body.error.code).toBe("already_assigned");
    expect((await post(t.app, `/api/objectives/${secret.id}/assignments`, { teamId: team, assigneeId: emp.membershipId }, owner)).status).toBe(400);
    // the employee cannot assign
    expect((await post(t.app, `/api/objectives/${secret.id}/assignments`, { assigneeId: other.membershipId }, emp.cookie)).status).toBe(403);
    // end it: visibility goes away again, the row stays
    const aid = (await get(t.app, `/api/objectives/${secret.id}/alignment`, owner)).body.data.assignments[0].id as string;
    expect((await send("delete", `/api/objectives/${secret.id}/assignments/${aid}`, undefined, owner)).status).toBe(200);
    expect((await get(t.app, `/api/objectives/${secret.id}`, emp.cookie)).status).toBe(404);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM objective_assignments WHERE end_date IS NOT NULL").n).toBe(1);
  });

  it("the gaps report lists what is not aligned, not broken down, not measurable, without data, behind pace, or overdue; and counts unaligned tasks", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const dept = await created("/api/departments", { name: "Engineering" }, owner);
    await post(t.app, "/api/objectives", { level: "company", title: "Lonely company goal", ...year, keyResults: [{ title: "k", targetValue: 10 }] }, owner);
    await post(t.app, "/api/objectives", { level: "department", departmentId: dept, title: "Orphan department goal", ...year }, owner);
    await post(t.app, "/api/objectives", { level: "company", title: "Past its end", startDate: dayOffset(-60), endDate: dayOffset(-5), keyResults: [{ title: "k", targetValue: 10 }] }, owner);
    await created("/api/tasks", { title: "Unlinked work" }, owner);
    const g = (await get(t.app, "/api/objectives/alignment-gaps", owner)).body.data;
    expect(g.unaligned.map((x: { title: string }) => x.title)).toEqual(["Orphan department goal"]);
    expect(g.notBrokenDown.map((x: { title: string }) => x.title).sort()).toEqual(["Lonely company goal", "Orphan department goal", "Past its end"]);
    expect(g.behindPace.map((x: { title: string }) => x.title)).toEqual(["Past its end"]);
    expect(g.unmeasurable.map((x: { title: string }) => x.title)).toEqual(["Orphan department goal"]);
    expect(g.noData.map((x: { title: string }) => x.title).sort()).toEqual(["Lonely company goal", "Orphan department goal"]);
    expect(g.overdue.map((x: { title: string }) => x.title)).toEqual(["Past its end"]);
    expect(g.unalignedTasks).toBe(1);
  });
});
