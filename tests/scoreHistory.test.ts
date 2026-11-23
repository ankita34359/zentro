import { afterEach, describe, expect, it } from "vitest";
import type { TestApp } from "./helpers/app.js";
import { get, makeAuthApp, post, send, signUpWithOrg } from "./helpers/auth.js";
import { addPerson, roleIds } from "./helpers/roles.js";

let t: TestApp;
afterEach(() => t?.cleanup());

const one = <T>(sql: string, ...p: unknown[]) => t.db.prepare(sql).get(...p) as T;
const code = (r: { body: { error?: { code?: string } } }) => r.body.error?.code;
const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const runJob = async () => {
  t.db.prepare("DELETE FROM scheduled_job_runs WHERE job_name = 'scores.recalculate'").run();
  await t.tick.run();
};

/**
 * An organization whose default model is ONE component (OKR achievement, weight 100), so a score is simply the objective's
 * attainment and the numbers are easy to check. Emma has an objective with two key results (80 and 60 → 70).
 */
async function setup() {
  t = makeAuthApp();
  const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
  const ids = await roleIds(t.app, owner);
  const emma = await addPerson(t.app, owner, "emma@example.com", ids.employee, "Emma Employee");
  const eli = await addPerson(t.app, owner, "eli@example.com", ids.employee, "Eli Employee");
  const models = (await get(t.app, "/api/performance/models", owner)).body.data as { id: string; name: string }[];
  const emp = models.find((m) => m.name === "Employee")!;
  const draft = await send(t.app, "patch", `/api/performance/models/${emp.id}`, { components: [{ key: "okr", label: "OKR achievement", weight: 100, providerKey: "okr.attainment", minSample: 1 }] }, owner);
  expect(draft.status, JSON.stringify(draft.body)).toBe(200);
  expect((await post(t.app, `/api/performance/models/${draft.body.data.id}/activate`, undefined, owner)).status).toBe(200);
  const o = await post(t.app, "/api/objectives", { level: "individual", ownerId: emma.membershipId, title: "Ship the onboarding", startDate: day(-200), endDate: day(200), lifecycle: "active", keyResults: [{ title: "Activated accounts", targetValue: 100 }, { title: "Reviews passed", targetValue: 100 }] }, owner);
  expect(o.status, JSON.stringify(o.body)).toBe(201);
  const krs = t.db.prepare("SELECT id FROM key_results WHERE objective_id = ? ORDER BY rowid").all(o.body.data.id) as { id: string }[];
  for (const [i, v] of [80, 60].entries()) expect((await post(t.app, `/api/key-results/${krs[i]!.id}/progress`, { value: v }, owner)).status).toBe(201);
  // the first values were recorded 80 days ago
  t.db.prepare("UPDATE objective_progress_history SET recorded_at = ?").run(`${day(-80)}T10:00:00.000Z`);
  const mk = async (name: string, from: number, to: number) => (await post(t.app, "/api/performance/periods", { name, startDate: day(from), endDate: day(to) }, owner)).body.data.id as string;
  const a = await mk("Earlier", -100, -50);
  const b = await mk("Current", -49, 40);
  return { owner, emma, eli, a, b, krs: krs.map((k) => k.id) };
}
const calc = (cookie: string, periodId: string, subjectId?: string) => post(t.app, "/api/performance/scorecards/recalculate", { periodId, ...(subjectId ? { subjectId } : {}) }, cookie);
const card = async (cookie: string, periodId: string, subjectId?: string) => (await get(t.app, `/api/performance/scorecards/for?periodId=${periodId}${subjectId ? `&subjectId=${subjectId}` : ""}`, cookie)).body.data;

describe("Closing, reopening and locking a period (stage 5.3)", () => {
  it("closing scores everyone as of the period's end with a final run, marks the scorecards final and writes one audit line", async () => {
    const { owner, emma, a } = await setup();
    const r = await post(t.app, `/api/performance/periods/${a}/close`, undefined, owner);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ status: "closed", calculated: { scored: 3 } }); // owner, Emma, Eli
    const c = await card(owner, a, emma.membershipId);
    // the value recorded 80 days ago counts as of day -50: two key results, 80 and 60 → 70, scored with 2 samples → confidence 1 → final
    expect(c.latest).toMatchObject({ total: 70, status: "final", trigger: "period_close", runNumber: 1 });
    expect(one<{ status: string }>("SELECT status FROM performance_scorecards WHERE subject_membership_id = ? AND period_id = ?", emma.membershipId, a).status).toBe("final");
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs WHERE action = 'performance.period_close'").n).toBe(1);
    expect(code(await post(t.app, `/api/performance/periods/${a}/close`, undefined, owner))).toBe("not_open");
  });

  it("a closed period keeps its scores even when later data arrives; a manual recalculation adds a run, a recalculated closed period stays final", async () => {
    const { owner, emma, a, krs } = await setup();
    await post(t.app, `/api/performance/periods/${a}/close`, undefined, owner);
    expect((await post(t.app, `/api/key-results/${krs[0]}/progress`, { value: 100 }, owner)).status).toBe(201); // today: after the period's end
    const again = await calc(owner, a, emma.membershipId);
    expect(again.body.data).toMatchObject({ scored: 0, unchanged: 1 }); // as of the end of the period nothing changed
    expect((await card(owner, a, emma.membershipId)).latest.total).toBe(70);
  });

  it("reopening keeps every run; the next calculation of the open period uses today's records and says provisional", async () => {
    const { owner, emma, a, krs } = await setup();
    await post(t.app, `/api/performance/periods/${a}/close`, undefined, owner);
    const reopened = await post(t.app, `/api/performance/periods/${a}/reopen`, undefined, owner);
    expect(reopened.body.data.status).toBe("open");
    expect(one<{ status: string }>("SELECT status FROM performance_scorecards WHERE subject_membership_id = ? AND period_id = ?", emma.membershipId, a).status).toBe("open");
    expect(code(await post(t.app, `/api/performance/periods/${a}/reopen`, undefined, owner))).toBe("not_closed");
    expect((await post(t.app, `/api/key-results/${krs[0]}/progress`, { value: 100 }, owner)).status).toBe(201);
    await calc(owner, a, emma.membershipId);
    const c = await card(owner, a, emma.membershipId);
    expect(c.runs.map((r: { runNumber: number; total: number; status: string }) => [r.runNumber, r.total, r.status])).toEqual([[2, 80, "provisional"], [1, 70, "final"]]);
  });

  it("locking: no recalculation, no reopening, no new KPI value in the period; a correction of an existing value still works", async () => {
    const { owner, emma, a } = await setup();
    expect(code(await post(t.app, `/api/performance/periods/${a}/lock`, undefined, owner))).toBe("not_closed");
    await post(t.app, `/api/performance/periods/${a}/close`, undefined, owner);
    // a KPI value in the period, recorded before the lock
    const kpi = (await post(t.app, "/api/kpis", { name: "Leads", frequency: "daily", aggregation: "sum", defaultTarget: 5 }, owner)).body.data.id as string;
    const first = await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: { type: "person", id: emma.membershipId }, periodStart: day(-60), value: 3 }, owner);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const lock = await post(t.app, `/api/performance/periods/${a}/lock`, undefined, owner);
    expect(lock.body.data.status).toBe("locked");
    expect(code(await post(t.app, `/api/performance/periods/${a}/lock`, undefined, owner))).toBe("already_locked");
    expect(code(await post(t.app, `/api/performance/periods/${a}/reopen`, undefined, owner))).toBe("period_locked");
    expect(code(await calc(owner, a, emma.membershipId))).toBe("period_locked");
    expect(code(await send(t.app, "patch", `/api/performance/periods/${a}`, { name: "Renamed" }, owner))).toBe("period_closed");
    const blocked = await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: { type: "person", id: emma.membershipId }, periodStart: day(-61), value: 4 }, owner);
    expect(code(blocked)).toBe("period_locked");
    expect(blocked.body.error.message).toMatch(/"Earlier" is locked/);
    const fix = await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: { type: "person", id: emma.membershipId }, periodStart: day(-60), value: 4, supersedes: first.body.data.history?.[0]?.id ?? (one<{ id: string }>("SELECT id FROM kpi_measurements WHERE kpi_id = ?", kpi).id), note: "A late invoice" }, owner);
    expect(fix.status, JSON.stringify(fix.body)).toBe(201);
    // a day outside every locked period still takes a new value
    expect((await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: { type: "person", id: emma.membershipId }, periodStart: day(-5), value: 2 }, owner)).status).toBe(201);
  });

  it("a period that has not started cannot be closed; only people who manage periods may close, reopen or lock", async () => {
    const { owner, emma } = await setup();
    const future = (await post(t.app, "/api/performance/periods", { name: "Next", startDate: day(30), endDate: day(90) }, owner)).body.data.id as string;
    expect(code(await post(t.app, `/api/performance/periods/${future}/close`, undefined, owner))).toBe("not_started");
    for (const verb of ["close", "reopen", "lock"]) expect((await post(t.app, `/api/performance/periods/${future}/${verb}`, undefined, emma.cookie)).status, verb).toBe(403);
    expect(one<{ status: string }>("SELECT status FROM performance_periods WHERE id = ?", future).status).toBe("open");
  });
});

describe("The nightly update (stage 5.3)", () => {
  it("adds runs to open periods only, stores nothing when nothing changed, and leaves closed periods alone", async () => {
    const { owner, emma, a, b, krs } = await setup();
    await calc(owner, b); // someone used scoring: the models exist
    await post(t.app, `/api/performance/periods/${a}/close`, undefined, owner);
    const before = one<{ n: number }>("SELECT COUNT(*) n FROM performance_scores").n;
    await runJob();
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM performance_scores").n).toBe(before); // a quiet night adds nothing
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs WHERE action = 'performance.scheduled_recalculation'").n).toBe(0);
    expect((await post(t.app, `/api/key-results/${krs[0]}/progress`, { value: 100 }, owner)).status).toBe(201);
    await runJob();
    const c = await card(owner, b, emma.membershipId);
    expect(c.latest).toMatchObject({ total: 80, trigger: "scheduled", status: "provisional" });
    expect(c.runs).toHaveLength(2);
    expect((await card(owner, a, emma.membershipId)).latest).toMatchObject({ total: 70, trigger: "period_close", runNumber: 1 }); // the closed period was not touched
    const audit = one<{ actor_type: string; actor_membership_id: string | null; summary: string }>("SELECT actor_type, actor_membership_id, summary FROM audit_logs WHERE action = 'performance.scheduled_recalculation'");
    expect(audit.actor_type).toBe("system");
    expect(audit.actor_membership_id).toBeNull();
    expect(audit.summary).toMatch(/1 new score run across 1 open period/);
    await runJob();
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs WHERE action = 'performance.scheduled_recalculation'").n).toBe(1); // running it again changes nothing
  });

  it("an organization that never used scoring is skipped (no models are added behind its back), and another organization's periods are never touched", async () => {
    t = makeAuthApp();
    const ownerA = await signUpWithOrg(t.app, "a@example.com", "Alpha");
    const ownerB = await signUpWithOrg(t.app, "b@example.com", "Beta");
    await post(t.app, "/api/performance/periods", { name: "Year", startDate: day(-30), endDate: day(300) }, ownerA);
    await runJob();
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM scoring_models").n).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM performance_scores").n).toBe(0);
    // Beta calculates once; Alpha (with a period but no models) is still left alone by the job
    const periodB = (await post(t.app, "/api/performance/periods", { name: "Year", startDate: day(-30), endDate: day(300) }, ownerB)).body.data.id as string;
    await calc(ownerB, periodB);
    await runJob();
    const perOrg = t.db.prepare("SELECT o.name AS name, COUNT(*) AS n FROM performance_scores s JOIN organizations o ON o.id = s.organization_id GROUP BY o.name").all() as { name: string; n: number }[];
    expect(perOrg.map((r) => r.name)).toEqual(["Beta"]);
  });
});

describe("Trends and comparing two periods (stage 5.3)", () => {
  it("shows each period's score oldest first with the change since the one before, and compares two periods part by part", async () => {
    const { owner, emma, a, b, krs } = await setup();
    await post(t.app, `/api/performance/periods/${a}/close`, undefined, owner);
    expect((await post(t.app, `/api/key-results/${krs[0]}/progress`, { value: 100 }, owner)).status).toBe(201);
    expect((await post(t.app, `/api/key-results/${krs[1]}/progress`, { value: 80 }, owner)).status).toBe(201);
    await calc(owner, b, emma.membershipId);
    const tr = (await get(t.app, `/api/performance/trends?subjectId=${emma.membershipId}&from=${a}&to=${b}`, owner)).body.data;
    expect(tr.points.map((p: { periodName: string; total: number; status: string; totalDelta: number | null }) => [p.periodName, p.total, p.status, p.totalDelta])).toEqual([["Earlier", 70, "final", null], ["Current", 90, "provisional", 20]]);
    expect(tr.points[1].components[0]).toMatchObject({ key: "okr", score: 90, delta: 20 });
    expect(tr.comparison).toMatchObject({ totalDelta: 20, modelChanged: false, from: { name: "Earlier", total: 70 }, to: { name: "Current", total: 90 } });
    expect(tr.comparison.components).toEqual([{ key: "okr", label: "OKR achievement", from: 70, to: 90, delta: 20, note: null }]);
  });

  it("a period with no data shows no change, never a drop to zero", async () => {
    const { owner, eli, a, b } = await setup();
    await post(t.app, `/api/performance/periods/${a}/close`, undefined, owner);
    await calc(owner, b, eli.membershipId);
    const tr = (await get(t.app, `/api/performance/trends?subjectId=${eli.membershipId}&from=${a}&to=${b}`, owner)).body.data;
    expect(tr.points.every((p: { total: number | null; totalDelta: number | null }) => p.total === null && p.totalDelta === null)).toBe(true);
    expect(tr.comparison).toMatchObject({ totalDelta: null });
    expect(tr.comparison.components[0]).toMatchObject({ from: null, to: null, delta: null, note: "No data in either period" });
  });

  it("everyone sees their own trend; a peer's is not found; asking for a period that is not in the list is not found", async () => {
    const { owner, emma, eli, a, b } = await setup();
    await calc(owner, b);
    expect((await get(t.app, "/api/performance/trends", emma.cookie)).status).toBe(200);
    expect((await get(t.app, `/api/performance/trends?subjectId=${emma.membershipId}`, eli.cookie)).status).toBe(404);
    expect((await get(t.app, `/api/performance/trends?subjectId=${emma.membershipId}&from=${a}&to=${b}`, owner)).status).toBe(404); // no scorecard in A: it is not one of the points
    expect((await get(t.app, "/api/performance/trends?from=nope", owner)).status).toBe(400);
  });
});
