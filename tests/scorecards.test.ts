import { afterEach, describe, expect, it } from "vitest";
import type { TestApp } from "./helpers/app.js";
import { get, makeAuthApp, post, send, signUpWithOrg } from "./helpers/auth.js";
import { addPerson, roleIds } from "./helpers/roles.js";

let t: TestApp;
afterEach(() => t?.cleanup());

const one = <T>(sql: string, ...p: unknown[]) => t.db.prepare(sql).get(...p) as T;
const code = (r: { body: { error?: { code?: string } } }) => r.body.error?.code;
const year = new Date().getUTCFullYear();
const Y = String(year);

/** An organization with an owner, a manager, two employees, one open yearly period and real work for Emma. */
async function setup() {
  t = makeAuthApp();
  const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
  const ids = await roleIds(t.app, owner);
  const mgr = await addPerson(t.app, owner, "mgr@example.com", ids.manager, "Max Manager");
  const emma = await addPerson(t.app, owner, "emma@example.com", ids.employee, "Emma Employee");
  const eli = await addPerson(t.app, owner, "eli@example.com", ids.employee, "Eli Employee");
  const nobody = await addPerson(t.app, owner, "nobody@example.com", undefined, "No Role");
  const period = await post(t.app, "/api/performance/periods", { name: `Year ${Y}`, periodType: "year", startDate: `${Y}-01-01`, endDate: `${Y}-12-31` }, owner);
  expect(period.status, JSON.stringify(period.body)).toBe(201);
  return { owner, mgr, emma, eli, nobody, periodId: period.body.data.id as string };
}

/** Emma: a yearly objective at 80 %, and a monthly KPI (target 10) with six months of 9. */
async function work(owner: string, emma: string) {
  const o = await post(t.app, "/api/objectives", { level: "individual", ownerId: emma, title: "Ship the onboarding", startDate: `${Y}-01-01`, endDate: `${Y}-12-31`, lifecycle: "active", keyResults: [{ title: "Activated accounts", targetValue: 100 }] }, owner);
  expect(o.status, JSON.stringify(o.body)).toBe(201);
  const kr = one<{ id: string }>("SELECT id FROM key_results WHERE objective_id = ?", o.body.data.id).id;
  expect((await post(t.app, `/api/key-results/${kr}/progress`, { value: 80 }, owner)).status).toBe(201);
  const k = await post(t.app, "/api/kpis", { name: "Qualified leads", aggregation: "avg", frequency: "monthly", defaultTarget: 10 }, owner);
  expect(k.status, JSON.stringify(k.body)).toBe(201);
  expect((await post(t.app, `/api/kpis/${k.body.data.id}/assignments`, { assigneeId: emma, targetValue: 10, effectiveFrom: `${Y}-01-01` }, owner)).status).toBe(201);
  for (let m = 1; m <= 6; m += 1) {
    const r = await post(t.app, `/api/kpis/${k.body.data.id}/measurements`, { subject: { type: "person", id: emma }, periodStart: `${Y}-${String(m).padStart(2, "0")}-01`, value: 9 }, owner);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  }
  return { objectiveId: o.body.data.id as string, keyResultId: kr, kpiId: k.body.data.id as string };
}
const recalc = (cookie: string, periodId: string, subjectId?: string) => post(t.app, "/api/performance/scorecards/recalculate", { periodId, ...(subjectId ? { subjectId } : {}) }, cookie);
const cardFor = (cookie: string, periodId: string, subjectId?: string) => get(t.app, `/api/performance/scorecards/for?periodId=${periodId}${subjectId ? `&subjectId=${subjectId}` : ""}`, cookie);

describe("Scorecards from real data (stage 5.2)", () => {
  it("scores a person from their real OKRs and KPIs: 80 and 90 over the 70 % that has data → 84.3, provisional, with every missing part named", async () => {
    const { owner, emma, periodId } = await setup();
    await work(owner, emma.membershipId);
    const r = await recalc(owner, periodId, emma.membershipId);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ scored: 1, unchanged: 0 });
    const card = (await cardFor(owner, periodId, emma.membershipId)).body.data;
    const s = card.latest;
    expect(s).toMatchObject({ total: 84.3, status: "provisional", runNumber: 1, modelName: "Employee", band: "On target" });
    expect(s.weightCoverage).toBeCloseTo(0.7);
    const by = (k: string) => s.components.find((c: { key: string }) => c.key === k);
    expect(by("okr")).toMatchObject({ state: "ok", score: 80, weight: 0.4, effectiveWeight: expect.closeTo(0.5714, 3), points: 45.7 });
    expect(by("kpi")).toMatchObject({ state: "ok", score: 90, weight: 0.3, points: 38.6 });
    expect(by("delivery").state).toBe("missing"); // no tasks: shown as missing, never as a zero
    expect(by("quality").state).not.toBe("ok");
    expect(by("okr").contributors.length).toBeGreaterThan(0); // the records behind the number
    expect(s.explanation.formula).toMatch(/= 84\.3$/);
    expect(s.explanation.dataQuality.join(" ")).toMatch(/Delivery and reliability/);
    // the audit trail has the calculation, written in the same transaction as the run
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs WHERE action = 'performance.recalculate'").n).toBe(1);
  });

  it("is idempotent, and a change in the data adds run 2 while run 1 stays exactly as it was", async () => {
    const { owner, emma, periodId } = await setup();
    const w = await work(owner, emma.membershipId);
    await recalc(owner, periodId, emma.membershipId);
    const again = await recalc(owner, periodId, emma.membershipId);
    expect(again.body.data).toMatchObject({ scored: 0, unchanged: 1 });
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM performance_scores").n).toBe(1);
    expect((await post(t.app, `/api/key-results/${w.keyResultId}/progress`, { value: 100 }, owner)).status).toBe(201);
    const third = await recalc(owner, periodId, emma.membershipId);
    expect(third.body.data).toMatchObject({ scored: 1, unchanged: 0 });
    const card = (await cardFor(owner, periodId, emma.membershipId)).body.data;
    expect(card.runs.map((x: { runNumber: number; total: number }) => [x.runNumber, x.total])).toEqual([[2, 95.7], [1, 84.3]]); // newest first: (100×0.4 + 90×0.3)/0.7
    expect(card.latest.runNumber).toBe(2);
    const first = card.runs[1];
    const old = (await get(t.app, `/api/performance/scores/${first.scoreId}`, owner)).body.data;
    expect(old).toMatchObject({ total: 84.3, isLatest: false });
  });

  it("Verify recomputes a run from its stored inputs and model and says matches; a tampered total is caught", async () => {
    const { owner, emma, periodId } = await setup();
    await work(owner, emma.membershipId);
    await recalc(owner, periodId, emma.membershipId);
    const id = (await cardFor(owner, periodId, emma.membershipId)).body.data.latest.scoreId as string;
    const ok = await post(t.app, `/api/performance/scores/${id}/verify`, undefined, owner);
    expect(ok.body.data).toMatchObject({ matches: true, mismatches: [], expected: { total: 84.3 }, actual: { total: 84.3 } });
    t.db.prepare("UPDATE performance_scores SET total_score = 99 WHERE id = ?").run(id);
    const bad = await post(t.app, `/api/performance/scores/${id}/verify`, undefined, owner);
    expect(bad.body.data.matches).toBe(false);
    expect(bad.body.data.mismatches[0]).toMatch(/total: stored 99, recomputed 84.3/);
  });

  it("a person with no data at all gets an 'insufficient' scorecard with every component missing, not a zero", async () => {
    const { owner, eli, periodId } = await setup();
    await recalc(owner, periodId, eli.membershipId);
    const s = (await cardFor(owner, periodId, eli.membershipId)).body.data.latest;
    expect(s).toMatchObject({ total: null, status: "insufficient" });
    expect(s.components.every((c: { state: string; points: number | null }) => c.state !== "ok" && c.points === null)).toBe(true);
  });

  it("the standard models are added the first time anything is scored, and everyone in the organization is scored by 'calculate for everyone'", async () => {
    const { owner, periodId } = await setup();
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM scoring_models").n).toBe(0);
    const r = await recalc(owner, periodId);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM scoring_models").n).toBe(8);
    expect(r.body.data.scored + r.body.data.unchanged + r.body.data.skipped).toBe(5); // owner, manager, two employees and the person without a role
    const list = (await get(t.app, `/api/performance/scorecards?periodId=${periodId}`, owner)).body.data as { subject: { name: string } }[];
    expect(list).toHaveLength(5);
  });

  it("visibility: you always read your own scorecard and its components, even with no role; nobody else's without permission", async () => {
    const { owner, mgr, emma, eli, nobody, periodId } = await setup();
    await work(owner, emma.membershipId);
    await recalc(owner, periodId);
    // Emma (an employee role holds no performance grant): her own, with components
    const mine = await cardFor(emma.cookie, periodId);
    expect(mine.status).toBe(200);
    expect(mine.body.data.latest.components).toHaveLength(4);
    expect(mine.body.data.latest.explanation.formula).toBeTruthy();
    const own = await post(t.app, `/api/performance/scores/${mine.body.data.latest.scoreId}/verify`, undefined, emma.cookie);
    expect(own.body.data.matches).toBe(true);
    // a peer's: not found, never "forbidden" (existence is not revealed)
    expect((await cardFor(eli.cookie, periodId, emma.membershipId)).status).toBe(404);
    expect((await get(t.app, `/api/performance/scorecards/${mine.body.data.scorecardId}`, eli.cookie)).status).toBe(404);
    expect((await get(t.app, `/api/performance/scores/${mine.body.data.latest.scoreId}`, eli.cookie)).status).toBe(404);
    expect((await post(t.app, `/api/performance/scores/${mine.body.data.latest.scoreId}/verify`, undefined, eli.cookie)).status).toBe(404);
    // the list holds only their own card; the period shows how many THEY may open
    const list = (await get(t.app, `/api/performance/scorecards?periodId=${periodId}`, eli.cookie)).body.data as { subject: { id: string } }[];
    expect(list.map((x) => x.subject.id)).toEqual([eli.membershipId]);
    expect((await get(t.app, "/api/performance/periods", eli.cookie)).body.data[0].scorecards).toBe(1);
    expect((await get(t.app, "/api/performance/periods", owner)).body.data[0].scorecards).toBe(5);
    // a manager with no reporting line to Emma sees only their own
    expect((await cardFor(mgr.cookie, periodId, emma.membershipId)).status).toBe(404);
    expect((await cardFor(mgr.cookie, periodId)).status).toBe(200);
    // a person with no role at all still reads their own
    expect((await cardFor(nobody.cookie, periodId)).status).toBe(200);
    expect((await cardFor(nobody.cookie, periodId, emma.membershipId)).status).toBe(404);
  });

  it("permissions: only people allowed to calculate can; only administrators manage periods; nothing is written on a refusal", async () => {
    const { owner, emma, eli, periodId } = await setup();
    const before = one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs").n;
    expect((await recalc(emma.cookie, periodId, emma.membershipId)).status).toBe(403);
    expect((await recalc(emma.cookie, periodId, eli.membershipId)).status).toBe(403);
    expect((await post(t.app, "/api/performance/periods", { name: "Mine", startDate: `${Y}-01-01`, endDate: `${Y}-03-31` }, emma.cookie)).status).toBe(403);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs").n).toBe(before);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM performance_scores").n).toBe(0);
    expect((await recalc(owner, periodId, "00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });

  it("periods: names are unique, dates must be real and ordered, and a period can be renamed while open", async () => {
    const { owner, periodId } = await setup();
    expect(code(await post(t.app, "/api/performance/periods", { name: `year ${Y}`, startDate: `${Y}-01-01`, endDate: `${Y}-12-31` }, owner))).toBe("name_taken");
    expect(code(await post(t.app, "/api/performance/periods", { name: "Backwards", startDate: `${Y}-06-01`, endDate: `${Y}-05-01` }, owner))).toBe("invalid_date");
    expect(code(await post(t.app, "/api/performance/periods", { name: "Odd", startDate: "2026-02-31", endDate: "2026-03-31" }, owner))).toBe("invalid_date");
    const q = await post(t.app, "/api/performance/periods", { name: `Q1 ${Y}`, periodType: "quarter", startDate: `${Y}-01-01`, endDate: `${Y}-03-31` }, owner);
    expect(q.status).toBe(201);
    const renamed = await send(t.app, "patch", `/api/performance/periods/${q.body.data.id}`, { name: `First quarter ${Y}` }, owner);
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(renamed.body.data.name).toBe(`First quarter ${Y}`);
    expect((await send(t.app, "patch", `/api/performance/periods/${q.body.data.id}`, { name: `Year ${Y}` }, owner)).status).toBe(409);
    expect((await get(t.app, "/api/performance/periods", owner)).body.data.map((p: { id: string }) => p.id)).toContain(periodId);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs WHERE action = 'performance.period_create'").n).toBe(2);
  });
});
