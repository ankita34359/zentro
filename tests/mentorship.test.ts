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
 * Mo (a login, with the Mentor role) mentors Nia and Omar; the default model is one component (OKR achievement) so a score is the value
 * recorded on the objective. Period A (closed, 100 to 50 days ago): Nia 50, Omar 60. Period B (open, now): Nia 70, Omar 55.
 */
async function setup() {
  t = makeAuthApp();
  const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
  const ids = await roleIds(t.app, owner);
  const mo = await addPerson(t.app, owner, "mo@example.com", ids.mentor, "Mo Mentor");
  const mgr = await addPerson(t.app, owner, "mgr@example.com", ids.manager, "Max Manager");
  const other = await addPerson(t.app, owner, "other@example.com", ids.employee, "Olive Other");
  const nia = await created("/api/employees", { name: "Nia Mentee", startDate: day(-300) }, owner);
  const omar = await created("/api/employees", { name: "Omar Mentee", startDate: day(-300) }, owner);
  const models = (await get(t.app, "/api/performance/models", owner)).body.data as { id: string; name: string }[];
  const draft = await send(t.app, "patch", `/api/performance/models/${models.find((m) => m.name === "Employee")!.id}`, { components: [{ key: "okr", label: "OKR achievement", weight: 100, providerKey: "okr.attainment", minSample: 1 }] }, owner);
  await post(t.app, `/api/performance/models/${draft.body.data.id}/activate`, undefined, owner);
  const krOf = async (who: string, v: number) => {
    const o = await post(t.app, "/api/objectives", { level: "individual", ownerId: who, title: "Grow", startDate: day(-200), endDate: day(200), lifecycle: "active", keyResults: [{ title: "Result", targetValue: 100 }] }, owner);
    const kr = one<{ id: string }>("SELECT id FROM key_results WHERE objective_id = ?", o.body.data.id).id;
    await post(t.app, `/api/key-results/${kr}/progress`, { value: v }, owner);
    return kr;
  };
  const kn = await krOf(nia, 50);
  const ko = await krOf(omar, 60);
  t.db.prepare("UPDATE objective_progress_history SET recorded_at = ?").run(`${day(-80)}T10:00:00.000Z`);
  const periodA = (await post(t.app, "/api/performance/periods", { name: "Earlier", startDate: day(-100), endDate: day(-50) }, owner)).body.data.id as string;
  const periodB = (await post(t.app, "/api/performance/periods", { name: "Now", startDate: day(-49), endDate: day(40) }, owner)).body.data.id as string;
  expect((await post(t.app, `/api/performance/periods/${periodA}/close`, undefined, owner)).status).toBe(200);
  await post(t.app, `/api/key-results/${kn}/progress`, { value: 70 }, owner);
  await post(t.app, `/api/key-results/${ko}/progress`, { value: 55 }, owner);
  return { owner, mo, mgr, other, nia, omar, periodA, periodB };
}
const assign = (cookie: string, mentorId: string, menteeId: string, extra: Record<string, unknown> = {}) => post(t.app, "/api/mentorship/assignments", { mentorId, menteeId, startDate: day(-110), ...extra }, cookie);

describe("Mentorship assignments (stage 5.5)", () => {
  it("creates, validates and audits: same person, duplicates, two people mentoring each other, a start in the future", async () => {
    const { owner, mo, nia } = await setup();
    const a = await assign(owner, mo.membershipId, nia, { goals: "Take on bigger work", cadenceDays: 7 });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body.data).toMatchObject({ mentor: { name: "Mo Mentor" }, mentee: { name: "Nia Mentee" }, status: "active", cadenceDays: 7, goals: "Take on bigger work", activityCount: 0, can: { manage: true, log: true } });
    expect(code(await assign(owner, mo.membershipId, mo.membershipId))).toBe("same_person");
    expect(code(await assign(owner, mo.membershipId, nia))).toBe("duplicate");
    expect(code(await assign(owner, nia, mo.membershipId))).toBe("loop");
    expect(code(await post(t.app, "/api/mentorship/assignments", { mentorId: mo.membershipId, menteeId: nia, startDate: day(5) }, owner))).toBe("future_date");
    expect(code(await assign(owner, mo.membershipId, nia, { cadenceDays: 0 }))).toBeDefined();
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs WHERE action = 'mentorship.assign'").n).toBe(1);
  });

  it("permissions: employees cannot assign; a manager only for people in their scope; nothing is written on a refusal", async () => {
    const { owner, mo, mgr, other, nia } = await setup();
    expect((await assign(other.cookie, mo.membershipId, nia)).status).toBe(403);
    const r = await assign(mgr.cookie, mo.membershipId, nia); // Nia does not report to Max
    expect(r.status).toBe(403);
    expect(code(r)).toBe("outside_scope");
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM mentorship_assignments").n).toBe(0);
    const reportee = await created("/api/employees", { name: "Rae Report", managerId: mgr.membershipId, startDate: day(-100) }, owner);
    expect((await assign(mgr.cookie, mo.membershipId, reportee)).status).toBe(201);
  });

  it("who sees what: the mentor and the mentee see their own; an unrelated employee sees none and gets 404; the owner sees all", async () => {
    const { owner, mo, other, nia } = await setup();
    const id = (await assign(owner, mo.membershipId, nia)).body.data.id as string;
    const mine = (await get(t.app, "/api/mentorship/assignments", mo.cookie)).body.data as { id: string; can: { manage: boolean; log: boolean } }[];
    expect(mine.map((x) => x.id)).toEqual([id]);
    expect(mine[0]!.can).toEqual({ manage: false, log: true }); // the mentor logs, but does not manage
    expect((await get(t.app, "/api/mentorship/assignments", other.cookie)).body.data).toEqual([]);
    expect((await get(t.app, `/api/mentorship/assignments/${id}`, other.cookie)).status).toBe(404);
    expect((await get(t.app, `/api/mentorship/assignments/${id}/activities`, other.cookie)).status).toBe(404);
    expect((await get(t.app, "/api/mentorship/assignments", owner)).body.data).toHaveLength(1);
  });

  it("pause, resume and end: a paused assignment takes no activity; an ended one cannot change; the end day must come after the start", async () => {
    const { owner, mo, nia } = await setup();
    const id = (await assign(owner, mo.membershipId, nia)).body.data.id as string;
    const url = `/api/mentorship/assignments/${id}`;
    expect((await send(t.app, "patch", url, { status: "paused" }, owner)).body.data.status).toBe("paused");
    expect(code(await post(t.app, `${url}/activities`, { type: "feedback", summary: "x" }, mo.cookie))).toBe("paused");
    expect((await send(t.app, "patch", url, { status: "active" }, owner)).body.data.status).toBe("active");
    expect(code(await send(t.app, "patch", url, { status: "ended", endDate: day(-110) }, owner))).toBe("before_start");
    expect(code(await send(t.app, "patch", url, { endDate: day(-3) }, owner))).toBe("invalid_value");
    const ended = await send(t.app, "patch", url, { status: "ended", endDate: day(-20) }, owner);
    expect(ended.body.data).toMatchObject({ status: "ended", endDate: day(-20), can: { manage: false, log: false } });
    expect(code(await send(t.app, "patch", url, { goals: "More" }, owner))).toBe("ended");
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs WHERE action LIKE 'mentorship.%'").n).toBe(4); // assign, pause, resume, end
  });
});

describe("Activities and ratings (stage 5.5)", () => {
  it("the mentor logs what happened; the mentee cannot; days must be inside the mentoring and not in the future", async () => {
    const { owner, mo, nia } = await setup();
    const id = (await assign(owner, mo.membershipId, nia)).body.data.id as string;
    const url = `/api/mentorship/assignments/${id}/activities`;
    const ok = await post(t.app, url, { type: "one_on_one", occurredOn: day(-10), durationMinutes: 45, summary: "Weekly check-in", outcome: "Agreed next steps" }, mo.cookie);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.data).toMatchObject({ type: "one_on_one", occurredOn: day(-10), durationMinutes: 45, by: { name: "Mo Mentor" } });
    expect(code(await post(t.app, url, { type: "one_on_one", occurredOn: day(2), summary: "Plan" }, mo.cookie))).toBe("future_date");
    expect(code(await post(t.app, url, { type: "one_on_one", occurredOn: day(-200), summary: "Too early" }, mo.cookie))).toBe("outside_assignment");
    expect(code(await post(t.app, url, { type: "one_on_one", summary: "  " }, mo.cookie))).toBe("invalid_text");
    expect((await post(t.app, url, { type: "bogus", summary: "x" }, mo.cookie)).status).toBe(400);
    expect((await get(t.app, url, owner)).body.data).toHaveLength(1);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs WHERE action = 'mentorship.activity'").n).toBe(1);
  });

  it("only the mentor or the mentee rates (1 to 5); the ratings are listed for the period", async () => {
    const { owner, mo, nia, periodB, other } = await setup();
    const id = (await assign(owner, mo.membershipId, nia)).body.data.id as string;
    const url = `/api/mentorship/assignments/${id}/progress`;
    const r = await post(t.app, url, { periodId: periodB, value: 4, note: "Going well" }, mo.cookie);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data).toMatchObject({ value: 4, source: "mentor_entered", by: { name: "Mo Mentor" } });
    expect(code(await post(t.app, url, { periodId: periodB, value: 6 }, mo.cookie))).toBe("invalid_value");
    expect((await post(t.app, url, { periodId: periodB, value: 3 }, owner)).status).toBe(403); // the owner is neither mentor nor mentee
    expect((await post(t.app, url, { periodId: periodB, value: 3 }, other.cookie)).status).toBe(403);
    expect((await get(t.app, `${url}?periodId=${periodB}`, owner)).body.data.entered).toHaveLength(1);
  });
});

describe("Effectiveness (stage 5.5)", () => {
  it("measures the change in the mentees: Nia +20 (index 100), Omar −5 (index 37.5); development 68.8 over the days they were mentored; every factor disclosed", async () => {
    const { owner, mo, nia, omar, periodB } = await setup();
    const a1 = (await assign(owner, mo.membershipId, nia, { cadenceDays: 14 })).body.data.id as string;
    await assign(owner, mo.membershipId, omar, { cadenceDays: 14 });
    for (const d of [-40, -20]) expect((await post(t.app, `/api/mentorship/assignments/${a1}/activities`, { type: "one_on_one", occurredOn: day(d), summary: "Check-in" }, mo.cookie)).status).toBe(201);
    await post(t.app, "/api/performance/scorecards/recalculate", { periodId: periodB }, owner);
    const e = (await get(t.app, `/api/mentorship/effectiveness?periodId=${periodB}`, owner)).body.data;
    expect(e.settings).toEqual({ minDays: 60, k: 2.5 });
    expect(e.mentors).toHaveLength(1);
    const m = e.mentors[0];
    expect(m).toMatchObject({ mentor: { name: "Mo Mentor" }, menteeCount: 2, development: { value: 68.8, state: "ok", sampleSize: 2 } });
    const n = m.mentees.find((x: { mentee: { name: string } }) => x.mentee.name === "Nia Mentee");
    expect(n).toMatchObject({ improvementIndex: 100, mentorCount: 1, creditShare: 1, detail: { baselineScore: 50, currentScore: 70, scoreDelta: 20 }, activities: 2 });
    expect(n.durationFactor).toBeCloseTo(0.83, 2); // 50 days of the 60 that count in full
    expect(m.mentees.find((x: { mentee: { name: string } }) => x.mentee.name === "Omar Mentee")).toMatchObject({ improvementIndex: 37.5, detail: { baselineScore: 60, currentScore: 55, scoreDelta: -5 }, activities: 0 });
    // activity: Nia 2 of about 3.6 expected (56 %), Omar 0 of 3.6: mean 28 %
    expect(m.activity.value).toBeCloseTo(27.8, 0);
    expect(e.caveats.join(" ")).toMatch(/many causes/);
    expect(e.caveats.join(" ")).toMatch(/still open/);
    expect(e.caveats.join(" ")).toMatch(/2 of 2 assignments ran for less than 60 days/);
  });

  it("a Mentor-model scorecard gets its development and activity components from the same maths, with the mentees scored first even in one pass", async () => {
    const { owner, mo, nia, omar, periodB } = await setup();
    await assign(owner, mo.membershipId, nia);
    await assign(owner, mo.membershipId, omar);
    const des = await created("/api/designations", { name: "Mentor" }, owner);
    expect((await post(t.app, `/api/employees/${mo.membershipId}/designation`, { designationId: des, startDate: day(-250) }, owner)).status).toBe(200);
    const mentorModel = ((await get(t.app, "/api/performance/models", owner)).body.data as { id: string; name: string }[]).find((m) => m.name === "Mentor")!;
    const draft = await send(t.app, "patch", `/api/performance/models/${mentorModel.id}`, { designationId: des }, owner);
    expect(draft.status, JSON.stringify(draft.body)).toBe(200);
    expect((await post(t.app, `/api/performance/models/${draft.body.data.id}/activate`, undefined, owner)).status).toBe(200);
    // ONE pass over everyone, in whatever order: Mo is scored after Nia and Omar
    expect((await post(t.app, "/api/performance/scorecards/recalculate", { periodId: periodB }, owner)).status).toBe(200);
    const card = (await get(t.app, `/api/performance/scorecards/for?periodId=${periodB}&subjectId=${mo.membershipId}`, owner)).body.data;
    const part = (k: string) => card.latest.components.find((c: { key: string }) => c.key === k);
    expect(card.latest.modelName).toBe("Mentor");
    expect(part("mentee_development")).toMatchObject({ state: "ok", score: 68.8 });
    expect(part("mentee_development").contributors).toHaveLength(2);
    expect(part("mentoring_activity").state).toBe("ok");
    expect(part("kpi").state).not.toBe("ok"); // no KPI: shown as missing, not zero
    // Mo can read, and Verify, their own mentor scorecard
    const mine = (await get(t.app, `/api/performance/scorecards/for?periodId=${periodB}`, mo.cookie)).body.data;
    expect((await post(t.app, `/api/performance/scores/${mine.latest.scoreId}/verify`, undefined, mo.cookie)).body.data.matches).toBe(true);
  });

  it("a paused assignment is not counted; an ended one counts only until it ended", async () => {
    const { owner, mo, nia, omar, periodB } = await setup();
    const a1 = (await assign(owner, mo.membershipId, nia)).body.data.id as string;
    const a2 = (await assign(owner, mo.membershipId, omar)).body.data.id as string;
    await post(t.app, "/api/performance/scorecards/recalculate", { periodId: periodB }, owner);
    await send(t.app, "patch", `/api/mentorship/assignments/${a1}`, { status: "paused" }, owner);
    let e = (await get(t.app, `/api/mentorship/effectiveness?periodId=${periodB}`, owner)).body.data.mentors[0];
    expect(e.menteeCount).toBe(1);
    expect(e.development).toMatchObject({ value: null, state: "insufficient", sampleSize: 1 }); // one mentee is fewer than the two that are needed
    await send(t.app, "patch", `/api/mentorship/assignments/${a1}`, { status: "active" }, owner);
    await send(t.app, "patch", `/api/mentorship/assignments/${a2}`, { status: "ended", endDate: day(-30) }, owner);
    e = (await get(t.app, `/api/mentorship/effectiveness?periodId=${periodB}`, owner)).body.data.mentors[0];
    expect(e.mentees.find((x: { mentee: { name: string } }) => x.mentee.name === "Omar Mentee").overlapDays).toBe(19); // from day -49 to day -31
  });

  it("visibility: the mentee sees their own result; an unrelated person sees nothing; mentors are listed only for those allowed to see them", async () => {
    const { owner, mo, nia, other, periodB } = await setup();
    await assign(owner, mo.membershipId, nia);
    expect((await get(t.app, `/api/mentorship/effectiveness?periodId=${periodB}`, other.cookie)).body.data.mentors).toEqual([]);
    expect((await get(t.app, `/api/mentorship/effectiveness?periodId=${periodB}&mentorId=${mo.membershipId}`, other.cookie)).status).toBe(404);
    expect((await get(t.app, `/api/mentorship/effectiveness?periodId=${periodB}`, mo.cookie)).body.data.mentors).toHaveLength(1);
    expect((await get(t.app, "/api/mentorship/effectiveness", owner)).status).toBe(400);
  });
});
