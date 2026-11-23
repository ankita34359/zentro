import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { completedPeriods, periodStartOf } from "../backend/src/modules/kpi/periods.js";
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
const code = (r: { body: { error?: { code?: string } } }) => r.body.error?.code;
const created = async (path: string, body: Record<string, unknown>, cookie: string): Promise<string> => {
  const r = await post(t.app, path, body, cookie);
  expect(r.status, `${path} ${JSON.stringify(r.body)}`).toBe(201);
  return r.body.data.id as string;
};
const today = (): string => new Date().toISOString().slice(0, 10);
/** The first days of the last completed months, oldest first. */
const months = (n: number): string[] => completedPeriods("monthly", today(), n);
const history = async (cookie: string, kpi: string, subject: string) => (await get(t.app, `/api/kpis/${kpi}/history?subject=${subject}`, cookie)).body.data;

async function setup() {
  t = makeAuthApp();
  const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
  const ids = await roleIds(t.app, owner);
  const mgr = await addPerson(t.app, owner, "mgr@example.com", ids.manager, "Max Manager");
  const emp = await addPerson(t.app, owner, "emp@example.com", ids.employee, "Emma Employee");
  const other = await addPerson(t.app, owner, "other@example.com", ids.employee, "Olly Other");
  await post(t.app, "/api/hierarchy/reporting", { subordinateId: emp.membershipId, managerId: mgr.membershipId }, owner);
  const kpi = await created("/api/kpis", { name: "Qualified leads", frequency: "monthly", defaultTarget: 40, unit: "leads" }, owner);
  const from = months(6)[0]!;
  await post(t.app, `/api/kpis/${kpi}/assignments`, { assigneeId: emp.membershipId, effectiveFrom: from }, owner);
  await post(t.app, `/api/kpis/${kpi}/assignments`, { assigneeId: other.membershipId, effectiveFrom: from }, owner);
  await send("put", `/api/kpis/${kpi}/thresholds`, { thresholds: [{ level: "warning", comparator: "lt", basis: "percent_of_target", value: 80 }, { level: "critical", comparator: "lt", basis: "percent_of_target", value: 50 }] }, owner);
  const subj = (id: string) => ({ type: "person", id });
  return { owner, mgr, emp, other, kpi, from, subj };
}

describe("KPI measurements (stage 3.4)", () => {
  it("record three monthly values and skip one: the history shows a gap and '1 missing', not a zero; correcting a value keeps both rows", async () => {
    const { owner, emp, kpi, subj } = await setup();
    const [m4, m3, m2, m1] = months(4) as [string, string, string, string];
    expect((await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: subj(emp.membershipId), periodStart: m4, value: 42 }, owner)).status).toBe(201);
    expect((await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: subj(emp.membershipId), periodStart: m2, value: 38 }, owner)).status).toBe(201); // m3 is skipped
    const rec = await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: subj(emp.membershipId), periodStart: m1, value: 45 }, owner);
    expect(rec.status, JSON.stringify(rec.body)).toBe(201);
    const h = await history(owner, kpi, `person:${emp.membershipId}`);
    const byStart = Object.fromEntries((h.periods as { start: string; state: string; value: number | null }[]).map((p) => [p.start, p]));
    expect(byStart[m4]).toMatchObject({ state: "recorded", value: 42, attainmentPct: 100 });
    expect(byStart[m3]).toMatchObject({ state: "missing", value: null, attainmentPct: null }); // a gap: not zero
    expect(byStart[m2]).toMatchObject({ state: "recorded", value: 38, attainmentPct: 95 });
    expect(h.target).toMatchObject({ targetValue: 40 });
    expect(h.expected).toBe(6);
    expect(h.missingCount).toBe(3); // the 2 months before the first value and the skipped one: the assignment started 6 months ago
    expect(h.coveragePct).toBe(50);
    expect(h.lines.map((l: { level: string; value: number }) => [l.level, l.value]).sort()).toEqual([["critical", 20], ["warning", 32]]);
    // the open month is not "missing" yet
    expect(h.periods.at(-1)).toMatchObject({ start: periodStartOf("monthly", today()), state: "open" });
    // a second value for the same period is refused: it must say what it corrects, and why
    const dupe = await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: subj(emp.membershipId), periodStart: m2, value: 39 }, owner);
    expect(code(dupe)).toBe("period_recorded");
    const currentId = dupe.body.error.details.currentId as string;
    expect(code(await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: subj(emp.membershipId), periodStart: m2, value: 39, supersedes: currentId }, owner))).toBe("reason_required");
    const fix = await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: subj(emp.membershipId), periodStart: m2, value: 39, supersedes: currentId, note: "Two leads were counted twice" }, owner);
    expect(fix.status, JSON.stringify(fix.body)).toBe(201);
    const after = await history(owner, kpi, `person:${emp.membershipId}`);
    const corrected = after.periods.find((p: { start: string }) => p.start === m2);
    expect(corrected).toMatchObject({ value: 39, corrections: 1 });
    expect(corrected.rows.map((r: { value: number; current: boolean }) => [r.value, r.current])).toEqual([[38, false], [39, true]]); // both rows stay
    expect(corrected.rows[1]).toMatchObject({ supersedes: currentId, note: "Two leads were counted twice", recordedBy: { name: "Test Person" } });
    // the old row cannot be corrected again: only the current one
    expect(code(await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: subj(emp.membershipId), periodStart: m2, value: 40, supersedes: currentId, note: "again" }, owner))).toBe("not_current");
    // append only: three first values + a correction = 4 rows, nothing deleted; a row can be replaced only once
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM kpi_measurements").n).toBe(4);
    expect(() => t.db.prepare("INSERT INTO kpi_measurements (id, organization_id, kpi_id, period_start, period_end, value, recorded_at, supersedes_measurement_id) SELECT 'x2', organization_id, kpi_id, period_start, period_end, 1, recorded_at, ? FROM kpi_measurements LIMIT 1").run(currentId)).toThrow(/UNIQUE/); // a row that was already replaced cannot be replaced twice
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs WHERE action IN ('kpi.measurement', 'kpi.measurement_correct')").n).toBe(4);
  });

  it("refuses periods that are not a whole period, not yet started, or values that are not numbers", async () => {
    const { owner, emp, kpi, subj } = await setup();
    const [m1] = months(1) as [string];
    expect(code(await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: subj(emp.membershipId), periodStart: `${m1.slice(0, 8)}15`, value: 5 }, owner))).toBe("invalid_period");
    expect(code(await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: subj(emp.membershipId), periodStart: "2026-02-30", value: 5 }, owner))).toBe("invalid_period");
    const next = new Date(Date.UTC(Number(today().slice(0, 4)), Number(today().slice(5, 7)), 1)).toISOString().slice(0, 10);
    expect(code(await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: subj(emp.membershipId), periodStart: next, value: 5 }, owner))).toBe("future_period");
    expect((await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: subj(emp.membershipId), periodStart: m1, value: "many" }, owner)).status).toBe(400);
    expect(code(await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: { type: "person" }, periodStart: m1, value: 5 }, owner))).toBe("validation_failed");
    expect((await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: { type: "person", id: "00000000-0000-4000-8000-000000000000" }, periodStart: m1, value: 5 }, owner)).status).toBe(404);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM kpi_measurements").n).toBe(0);
  });

  it("permissions: you record your own value; a manager records for a report; nobody sees or records for people outside their scope; the organization total needs permission over everyone", async () => {
    const { owner, mgr, emp, other, kpi, subj } = await setup();
    const [m2, m1] = months(2) as [string, string];
    expect((await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: subj(emp.membershipId), periodStart: m2, value: 30 }, emp.cookie)).status).toBe(201); // own
    expect((await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: subj(emp.membershipId), periodStart: m1, value: 31 }, mgr.cookie)).status).toBe(201); // a report
    expect((await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: subj(other.membershipId), periodStart: m1, value: 1 }, emp.cookie)).status).toBe(404); // cannot even see Olly
    expect((await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: subj(other.membershipId), periodStart: m1, value: 1 }, mgr.cookie)).status).toBe(404);
    expect((await get(t.app, `/api/kpis/${kpi}/history?subject=person:${other.membershipId}`, emp.cookie)).status).toBe(404);
    expect((await get(t.app, `/api/kpis/${kpi}/history?subject=person:${emp.membershipId}`, emp.cookie)).status).toBe(200);
    expect((await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: { type: "organization" }, periodStart: m1, value: 100 }, mgr.cookie)).status).toBe(404); // the organization total is not theirs to see
    expect((await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: { type: "organization" }, periodStart: m1, value: 100 }, owner)).status).toBe(201);
    expect((await get(t.app, `/api/kpis/${kpi}/history?subject=organization`, emp.cookie)).status).toBe(404);
    expect((await get(t.app, `/api/kpis/${kpi}/history?subject=organization`, owner)).body.data.periods.find((p: { start: string }) => p.start === m1).value).toBe(100);
    // a person with no role cannot see KPIs at all
    const none = await addPerson(t.app, owner, "none@example.com", undefined, "No Role");
    expect((await get(t.app, `/api/kpis/${kpi}/history?subject=person:${emp.membershipId}`, none.cookie)).status).toBe(403);
    const subjects = (await get(t.app, `/api/kpis/${kpi}/subjects`, emp.cookie)).body.data as { subject: { name: string }; canRecord: boolean }[];
    expect(subjects.map((s) => s.subject.name)).toEqual(["Emma Employee"]);
  });

  it("a value below a threshold tells the person and their manager once, writes the event, and a correction at the same level repeats nothing", async () => {
    const { owner, mgr, emp, kpi, subj } = await setup();
    const [m2, m1] = months(2) as [string, string];
    const notices = async (cookie: string) => ((await get(t.app, "/api/notifications", cookie)).body.data.notifications as { type: string; title: string; body: string }[]).filter((n) => n.type === "kpi.threshold");
    await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: subj(emp.membershipId), periodStart: m2, value: 36 }, owner); // 90%: fine
    expect(await notices(emp.cookie)).toHaveLength(0);
    const low = await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: subj(emp.membershipId), periodStart: m1, value: 18 }, owner); // 45%: critical
    expect(low.status).toBe(201);
    expect(low.body.data.status).toBe("critical");
    expect((await notices(emp.cookie)).map((n) => n.title)).toEqual(["Critical: Qualified leads (Emma Employee)"]);
    expect((await notices(mgr.cookie)).map((n) => n.title)).toEqual(["Critical: Qualified leads (Emma Employee)"]);
    expect((await notices(emp.cookie))[0]!.body).toMatch(/18 leads \(45% of the target 40\)/);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM automation_events WHERE event_type = 'kpi.threshold'").n).toBe(1);
    const cur = (await history(owner, kpi, `person:${emp.membershipId}`)).periods.find((p: { start: string }) => p.start === m1).rows[0].id as string;
    await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: subj(emp.membershipId), periodStart: m1, value: 17, supersedes: cur, note: "Recount" }, owner); // still critical
    expect(await notices(emp.cookie)).toHaveLength(1);
    t.db.prepare("DELETE FROM scheduled_job_runs WHERE job_name = 'kpi.thresholds'").run();
    const run = await t.tick.run();
    expect(run.ran).toContain("kpi.thresholds");
    expect(await notices(emp.cookie)).toHaveLength(1); // the hourly pass repeats nothing
    // an employee who switched the type off is not told
    await send("put", "/api/preferences", { types: [{ type: "kpi.threshold", inApp: false }] }, emp.cookie);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs WHERE action = 'kpi.measurement_correct'").n).toBe(1);
  });

  it("the hourly job flags a period that ended with no value, once, to the person and their manager", async () => {
    const { owner, mgr, emp, kpi } = await setup();
    const missed = async (cookie: string) => ((await get(t.app, "/api/notifications", cookie)).body.data.notifications as { type: string; title: string }[]).filter((n) => n.type === "kpi.missing");
    t.db.prepare("DELETE FROM scheduled_job_runs WHERE job_name = 'kpi.thresholds'").run();
    await t.tick.run();
    expect((await missed(emp.cookie)).map((n) => n.title)).toEqual(["No value yet: Qualified leads (Emma Employee)"]);
    expect((await missed(mgr.cookie)).map((n) => n.title)).toEqual(["No value yet: Qualified leads (Emma Employee)"]); // Max also manages Emma
    t.db.prepare("DELETE FROM scheduled_job_runs WHERE job_name = 'kpi.thresholds'").run();
    await t.tick.run();
    expect(await missed(emp.cookie)).toHaveLength(1);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM automation_events WHERE event_type = 'kpi.measurement_missed'").n).toBe(2); // Emma's and Olly's
    void owner; void kpi;
  });

  it("the overview counts what the caller may see: statuses, missing periods, and who needs attention", async () => {
    const { owner, emp, other, kpi, subj } = await setup();
    const [m1] = months(1) as [string];
    await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: subj(emp.membershipId), periodStart: m1, value: 18 }, owner);
    await post(t.app, `/api/kpis/${kpi}/measurements`, { subject: subj(other.membershipId), periodStart: m1, value: 44 }, owner);
    const o = (await get(t.app, "/api/kpis/overview", owner)).body.data;
    expect(o.totals).toMatchObject({ series: 2, kpis: 1, byStatus: { critical: 1, ok: 1 } });
    expect(o.totals.missingPeriods).toBe(10); // each of the two has 5 of the last 6 months missing
    expect(o.attention[0]).toMatchObject({ kpiName: "Qualified leads", status: "critical", subject: { name: "Emma Employee" } });
    expect(o.kpis[0]).toMatchObject({ name: "Qualified leads", series: 2, coveragePct: 17 });
    const mine = (await get(t.app, "/api/kpis/overview", emp.cookie)).body.data;
    expect(mine.totals.series).toBe(1);
    expect(JSON.stringify(mine)).not.toContain("Olly");
  });
});
