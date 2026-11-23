import { afterEach, describe, expect, it } from "vitest";
import type { TestApp } from "./helpers/app.js";
import { get, makeAuthApp, post, send, signUpWithOrg } from "./helpers/auth.js";
import { addPerson, roleIds } from "./helpers/roles.js";

let t: TestApp;
afterEach(() => t?.cleanup());

const one = <T>(sql: string, ...p: unknown[]) => t.db.prepare(sql).get(...p) as T;
const code = (r: { body: { error?: { code?: string } } }) => r.body.error?.code;
const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const created = async (path: string, body: Record<string, unknown>, cookie: string): Promise<string> => {
  const r = await post(t.app, path, body, cookie);
  expect(r.status, `${path} ${JSON.stringify(r.body)}`).toBe(201);
  return r.body.data.id as string;
};

/**
 * One organization, two role families. Engineers: Emma (a login) 80 and seven others 60 to 95. Designers: two people.
 * The default model is a single component (OKR achievement), so a person's total is the value recorded on their objective.
 */
async function setup() {
  t = makeAuthApp();
  const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
  const ids = await roleIds(t.app, owner);
  const models = (await get(t.app, "/api/performance/models", owner)).body.data as { id: string; name: string }[];
  const draft = await send(t.app, "patch", `/api/performance/models/${models.find((m) => m.name === "Employee")!.id}`, { components: [{ key: "okr", label: "OKR achievement", weight: 100, providerKey: "okr.attainment", minSample: 1 }] }, owner);
  await post(t.app, `/api/performance/models/${draft.body.data.id}/activate`, undefined, owner);
  const famE = await created("/api/role-families", { name: "Engineers" }, owner);
  const famD = await created("/api/role-families", { name: "Designers" }, owner);
  const desE = await created("/api/designations", { name: "Software Engineer", roleFamilyId: famE }, owner);
  const desD = await created("/api/designations", { name: "Product Designer", roleFamilyId: famD }, owner);
  const emma = await addPerson(t.app, owner, "emma@example.com", ids.employee, "Emma Engineer");
  const mgr = await addPerson(t.app, owner, "mgr@example.com", ids.manager, "Max Manager");
  const mgr2 = await addPerson(t.app, owner, "mgr2@example.com", ids.manager, "Mia Manager");
  for (const m of [emma.membershipId]) expect((await post(t.app, `/api/employees/${m}/designation`, { designationId: desE, startDate: day(-200) }, owner)).status).toBe(200);
  const person = async (name: string, designationId: string, extra: Record<string, unknown> = {}) => created("/api/employees", { name, designationId, startDate: day(-200), ...extra }, owner);
  const others: Record<string, string> = {};
  for (const [name, v] of [["Ben", 60], ["Cy", 65], ["Dee", 70], ["Eve", 75], ["Fay", 85], ["Gus", 90], ["Hal", 95]] as const) others[name] = await person(`${name} Engineer`, desE, name === "Ben" || name === "Cy" ? { managerId: mgr.membershipId } : {});
  const des1 = await person("Ida Designer", desD);
  const des2 = await person("Jo Designer", desD);
  const period = (await post(t.app, "/api/performance/periods", { name: "Now", startDate: day(-100), endDate: day(40) }, owner)).body.data.id as string;
  const score = async (who: string, value: number) => {
    const o = await post(t.app, "/api/objectives", { level: "individual", ownerId: who, title: `Goal ${value}`, startDate: day(-200), endDate: day(200), lifecycle: "active", keyResults: [{ title: "Result", targetValue: 100 }] }, owner);
    expect(o.status, JSON.stringify(o.body)).toBe(201);
    const kr = one<{ id: string }>("SELECT id FROM key_results WHERE objective_id = ?", o.body.data.id).id;
    expect((await post(t.app, `/api/key-results/${kr}/progress`, { value }, owner)).status).toBe(201);
  };
  await score(emma.membershipId, 80);
  for (const [name, v] of [["Ben", 60], ["Cy", 65], ["Dee", 70], ["Eve", 75], ["Fay", 85], ["Gus", 90], ["Hal", 95]] as const) await score(others[name]!, v);
  await score(des1, 70);
  await score(des2, 90);
  expect((await post(t.app, "/api/performance/scorecards/recalculate", { periodId: period }, owner)).status).toBe(200);
  return { owner, emma, mgr, mgr2, famE, famD, desE, desD, others, des1, des2, period };
}
const compare = (cookie: string, q: string) => get(t.app, `/api/performance/compare?${q}`, cookie);

describe("Peer comparison (stage 5.4)", () => {
  it("the owner sees the Engineers ranked with names: eight people, rank, mid-rank percentile and a z-score, with context beside the numbers", async () => {
    const { owner, emma, famE, period } = await setup();
    const r = await compare(owner, `periodId=${period}&roleFamilyId=${famE}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = r.body.data;
    expect(d).toMatchObject({ cohortSize: 8, normalization: "percentile_z", canSeeNames: true, hiddenCount: 0, roleFamily: { name: "Engineers" } });
    expect(d.entries.map((e: { subject: { name: string }; total: number; rank: number }) => [e.subject.name, e.total, e.rank])).toEqual([["Hal Engineer", 95, 1], ["Gus Engineer", 90, 2], ["Fay Engineer", 85, 3], ["Emma Engineer", 80, 4], ["Eve Engineer", 75, 5], ["Dee Engineer", 70, 6], ["Cy Engineer", 65, 7], ["Ben Engineer", 60, 8]]);
    const emmaRow = d.entries.find((e: { subject: { id: string } }) => e.subject.id === emma.membershipId);
    expect(emmaRow).toMatchObject({ rank: 4, percentile: 56.3 }); // (4 below + half of 1) / 8
    expect(emmaRow.zScore).toBeCloseTo(0.22, 2);
    expect(emmaRow.context).toMatchObject({ tenureDays: expect.any(Number), dataCoverage: 1 });
    expect(emmaRow.context.tenureDays).toBeGreaterThanOrEqual(199);
    expect(d.notes.join(" ")).toMatch(/shown beside the scores, not applied to them/);
  });

  it("an employee sees only their own position: rank, percentile, z-score; no names and no other scores", async () => {
    const { emma, period, famE } = await setup();
    const r = await compare(emma.cookie, `periodId=${period}`); // no family given: their own
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.roleFamily.id).toBe(famE);
    expect(d).toMatchObject({ canSeeNames: false, cohortSize: 8, you: { rank: 4, of: 8, percentile: 56.3, total: 80 }, hiddenCount: 7 });
    expect(d.entries).toHaveLength(1);
    expect(d.entries[0]).toMatchObject({ isYou: true, total: 80 });
    const text = JSON.stringify(d);
    for (const name of ["Hal", "Gus", "Ben", "Cy", "Ida", "Max Manager"]) expect(text).not.toContain(name);
    // and the scores of others never appear as numbers beside names, only their own
    expect(d.entries.every((e: { isYou: boolean }) => e.isYou)).toBe(true);
  });

  it("a manager sees names and scores only for people inside their scope; everyone else is counted, not named", async () => {
    const { mgr, famE, period, others } = await setup();
    const d = (await compare(mgr.cookie, `periodId=${period}&roleFamilyId=${famE}`)).body.data;
    expect(d.entries.map((e: { subject: { id: string } }) => e.subject.id).sort()).toEqual([others.Ben, others.Cy].sort());
    expect(d).toMatchObject({ canSeeNames: true, cohortSize: 8, hiddenCount: 6 });
    expect(d.entries.find((e: { subject: { id: string } }) => e.subject.id === others.Ben)).toMatchObject({ total: 60, rank: 8, percentile: 6.3 }); // their position among ALL eight
    expect(JSON.stringify(d)).not.toContain("Hal Engineer");
  });

  it("different role families are refused (422 cohort_mismatch), in a comparison and when explaining a difference", async () => {
    const { owner, emma, des1, period, famD } = await setup();
    const bad = await compare(owner, `periodId=${period}&subjectIds=${emma.membershipId},${des1}`);
    expect(bad.status).toBe(422);
    expect(code(bad)).toBe("cohort_mismatch");
    expect(code(await compare(owner, `periodId=${period}&roleFamilyId=${famD}&subjectIds=${emma.membershipId}`))).toBe("cohort_mismatch");
    const diff = await get(t.app, `/api/performance/compare/difference?periodId=${period}&a=${emma.membershipId}&b=${des1}`, owner);
    expect(code(diff)).toBe("cohort_mismatch");
  });

  it("a cohort of fewer than 3 shows the raw numbers with no rank, and says so", async () => {
    const { owner, famD, period } = await setup();
    const d = (await compare(owner, `periodId=${period}&roleFamilyId=${famD}`)).body.data;
    expect(d).toMatchObject({ cohortSize: 2, normalization: "raw" });
    expect(d.entries.map((e: { subject: { name: string }; total: number; rank: number | null; percentile: number | null }) => [e.subject.name, e.total, e.rank, e.percentile])).toEqual([["Jo Designer", 90, null, null], ["Ida Designer", 70, null, null]]);
    expect(d.notes[0]).toMatch(/Too few peers to rank \(2 of 3 needed\)/);
  });

  it("someone who joined the role recently is left out (default 30 days), and one with no data is left out unless asked for, never counted as zero", async () => {
    const { owner, famE, desE, period } = await setup();
    const fresh = await created("/api/employees", { name: "Newbie Engineer", designationId: desE, startDate: day(-5) }, owner);
    const empty = await created("/api/employees", { name: "Blank Engineer", designationId: desE, startDate: day(-200) }, owner);
    await post(t.app, "/api/performance/scorecards/recalculate", { periodId: period }, owner);
    const d = (await compare(owner, `periodId=${period}&roleFamilyId=${famE}`)).body.data;
    expect(d.cohortSize).toBe(8);
    expect(d.excluded).toEqual({ insufficient: 1, tenure: 1 });
    expect(d.entries.map((e: { subject: { id: string } }) => e.subject.id)).not.toContain(fresh);
    expect(d.notes.join(" ")).toMatch(/less than 30 days/);
    expect(d.notes.join(" ")).toMatch(/not enough data for a score/);
    const wide = (await compare(owner, `periodId=${period}&roleFamilyId=${famE}&minTenureDays=0&includeInsufficient=true`)).body.data;
    expect(wide.cohortSize).toBe(8); // still eight ranked: a person with no score is shown, never ranked
    const row = wide.entries.find((e: { subject: { id: string } }) => e.subject.id === empty);
    expect(row).toMatchObject({ total: null, status: "insufficient", rank: null, percentile: null });
    expect(wide.entries.map((e: { subject: { id: string } }) => e.subject.id)).toContain(fresh);
  });

  it("the cohort is resolved as of the period: someone who later became a designer still counts as an engineer in an earlier, closed period", async () => {
    const { owner, others, desD, famE, famD } = await setup();
    const past = (await post(t.app, "/api/performance/periods", { name: "Earlier", startDate: day(-150), endDate: day(-60) }, owner)).body.data.id as string;
    expect((await post(t.app, `/api/performance/periods/${past}/close`, undefined, owner)).status).toBe(200);
    expect((await post(t.app, `/api/employees/${others.Dee}/designation`, { designationId: desD, startDate: day(-20) }, owner)).status).toBe(200);
    const early = (await compare(owner, `periodId=${past}&roleFamilyId=${famE}&includeInsufficient=true`)).body.data;
    expect(early.entries.map((e: { subject: { id: string } }) => e.subject.id)).toContain(others.Dee);
    expect((await compare(owner, `periodId=${past}&roleFamilyId=${famD}&includeInsufficient=true`)).body.data.entries.map((e: { subject: { id: string } }) => e.subject.id)).not.toContain(others.Dee);
  });

  it("explains a difference part by part, and only for people the caller may compare", async () => {
    const { owner, mgr, emma, others, period } = await setup();
    const d = (await get(t.app, `/api/performance/compare/difference?periodId=${period}&a=${emma.membershipId}&b=${others.Ben}`, owner)).body.data;
    expect(d).toMatchObject({ totalDifference: 20, a: { name: "Emma Engineer", total: 80 }, b: { name: "Ben Engineer", total: 60 } });
    expect(d.parts).toEqual([{ key: "okr", label: "OKR achievement", a: 80, b: 60, contribution: 20, note: null }]);
    expect((await get(t.app, `/api/performance/compare/difference?periodId=${period}&a=${others.Ben}&b=${others.Cy}`, mgr.cookie)).status).toBe(200); // both are the manager's reports
    expect((await get(t.app, `/api/performance/compare/difference?periodId=${period}&a=${others.Ben}&b=${others.Hal}`, mgr.cookie)).status).toBe(404); // one is not
    expect((await get(t.app, `/api/performance/compare/difference?periodId=${period}&a=${emma.membershipId}&b=${emma.membershipId}`, owner)).status).toBe(400);
    expect((await get(t.app, `/api/performance/compare/difference?periodId=${period}&a=${others.Ben}&b=${others.Cy}`, emma.cookie)).status).toBe(403);
  });
});

describe("Saved comparisons (stage 5.4)", () => {
  it("a saved comparison is a snapshot: later score changes do not alter it; it is audited; the creator and people with compare over everyone can open it, others cannot", async () => {
    const { owner, mgr, mgr2, emma, famE, period, others } = await setup();
    const saved = await post(t.app, "/api/performance/comparisons", { name: "Engineers, now", periodId: period, roleFamilyId: famE }, owner);
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    expect(saved.body.data).toMatchObject({ name: "Engineers, now", cohortSize: 8, normalization: "percentile_z", createdBy: { name: "Test Person" } });
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs WHERE action = 'performance.comparison_save'").n).toBe(1);
    // Hal's score changes afterwards
    const kr = one<{ id: string }>("SELECT k.id FROM key_results k JOIN objectives o ON o.id = k.objective_id WHERE o.owner_membership_id = ?", others.Hal).id;
    await post(t.app, `/api/key-results/${kr}/progress`, { value: 20 }, owner);
    await post(t.app, "/api/performance/scorecards/recalculate", { periodId: period }, owner);
    const again = (await get(t.app, `/api/performance/comparisons/${saved.body.data.id}`, owner)).body.data;
    expect(again.result.entries[0]).toMatchObject({ total: 95, rank: 1 }); // as it was
    expect((await compare(owner, `periodId=${period}&roleFamilyId=${famE}`)).body.data.entries[0].total).not.toBe(95); // live data moved on
    expect((await get(t.app, "/api/performance/comparisons", owner)).body.data).toHaveLength(1);
    // a manager saves their own; another manager cannot open it
    const mine = await post(t.app, "/api/performance/comparisons", { name: "My reports", periodId: period, roleFamilyId: famE }, mgr.cookie);
    expect(mine.status, JSON.stringify(mine.body)).toBe(201);
    expect(mine.body.data.result.entries).toHaveLength(2); // only what the manager may see
    expect((await get(t.app, `/api/performance/comparisons/${mine.body.data.id}`, mgr2.cookie)).status).toBe(404);
    expect((await get(t.app, `/api/performance/comparisons/${saved.body.data.id}`, mgr.cookie)).status).toBe(404); // not theirs, and they do not hold compare over everyone
    expect((await get(t.app, "/api/performance/comparisons", mgr.cookie)).body.data.map((c: { name: string }) => c.name)).toEqual(["My reports"]);
    expect((await get(t.app, "/api/performance/comparisons", owner)).body.data).toHaveLength(2); // the owner reads both
    // an employee has no compare permission at all
    expect((await post(t.app, "/api/performance/comparisons", { name: "x", periodId: period }, emma.cookie)).status).toBe(403);
    expect((await get(t.app, "/api/performance/comparisons", emma.cookie)).status).toBe(403);
  });

  it("refuses an empty name, and a mismatched cohort saves nothing", async () => {
    const { owner, emma, des1, period } = await setup();
    const before = one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs").n;
    expect((await post(t.app, "/api/performance/comparisons", { name: "  ", periodId: period }, owner)).status).toBe(400);
    expect(code(await post(t.app, "/api/performance/comparisons", { name: "Mixed", periodId: period, subjectIds: [emma.membershipId, des1] }, owner))).toBe("cohort_mismatch");
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM performance_comparisons").n).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs").n).toBe(before);
  });
});
