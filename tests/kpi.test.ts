import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
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

async function setup() {
  t = makeAuthApp();
  const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
  const ids = await roleIds(t.app, owner);
  const mgr = await addPerson(t.app, owner, "mgr@example.com", ids.manager, "Max Manager");
  const emp = await addPerson(t.app, owner, "emp@example.com", ids.employee, "Emma Employee");
  const other = await addPerson(t.app, owner, "other@example.com", ids.employee, "Olly Other");
  await post(t.app, "/api/hierarchy/reporting", { subordinateId: emp.membershipId, managerId: mgr.membershipId }, owner);
  return { owner, ids, mgr, emp, other };
}

describe("KPI definitions (stage 3.3)", () => {
  it("creates a KPI with a key made from its name, lists and filters it, and refuses nonsense", async () => {
    const { owner } = await setup();
    const r = await post(t.app, "/api/kpis", { name: "Qualified leads", category: "growth", frequency: "monthly", aggregation: "sum", unit: "leads", defaultTarget: 40 }, owner);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data).toMatchObject({ key: "qualified-leads", name: "Qualified leads", direction: "higher_is_better", frequency: "monthly", defaultTarget: 40, assignmentCount: 0, can: { configure: true, assign: true, record: true } });
    expect(code(await post(t.app, "/api/kpis", { name: "Qualified Leads!" }, owner))).toBe("key_taken");
    expect(code(await post(t.app, "/api/kpis", { name: "Range KPI", direction: "target_range", defaultTarget: 10 }, owner))).toBe("range_needs_max");
    expect(code(await post(t.app, "/api/kpis", { name: "Range KPI", direction: "target_range", defaultTarget: 10, defaultTargetMax: 5 }, owner))).toBe("invalid_range");
    expect((await post(t.app, "/api/kpis", { name: "Bad", frequency: "hourly" }, owner)).status).toBe(400);
    await post(t.app, "/api/kpis", { name: "Time to hire", category: "people", frequency: "quarterly", direction: "lower_is_better", aggregation: "avg", unit: "days" }, owner);
    expect(((await get(t.app, "/api/kpis", owner)).body.data as { name: string }[]).map((k) => k.name)).toEqual(["Qualified leads", "Time to hire"]);
    expect(((await get(t.app, "/api/kpis?category=people", owner)).body.data as { name: string }[]).map((k) => k.name)).toEqual(["Time to hire"]);
    expect(((await get(t.app, "/api/kpis?search=lead", owner)).body.data as { name: string }[]).map((k) => k.name)).toEqual(["Qualified leads"]);
    const upd = await send("patch", `/api/kpis/${r.body.data.id}`, { description: "Leads that passed qualification", defaultTarget: 50 }, owner);
    expect(upd.body.data).toMatchObject({ description: "Leads that passed qualification", defaultTarget: 50, key: "qualified-leads" });
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs WHERE action IN ('kpi.create', 'kpi.update')").n).toBe(3);
  });

  it("assigns a KPI to a role family with warning and critical thresholds, and shows how many people it covers", async () => {
    const { owner } = await setup();
    const family = await created("/api/role-families", { name: "Sales" }, owner);
    const des = await created("/api/designations", { name: "Account Executive", roleFamilyId: family }, owner);
    await created("/api/employees", { name: "Ann Seller", designationId: des }, owner);
    await created("/api/employees", { name: "Bo Seller", designationId: des }, owner);
    const k = await created("/api/kpis", { name: "Qualified leads", defaultTarget: 40, frequency: "monthly" }, owner);
    const a = await post(t.app, `/api/kpis/${k}/assignments`, { roleFamilyId: family, weight: 2 }, owner); // the KPI's default target applies
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body.data.assignments[0]).toMatchObject({ subject: { kind: "role_family", name: "Sales" }, targetValue: 40, weight: 2, active: true, appliesTo: 2 });
    const th = await send("put", `/api/kpis/${k}/thresholds`, { thresholds: [{ level: "warning", comparator: "lt", basis: "percent_of_target", value: 80 }, { level: "critical", comparator: "lt", basis: "percent_of_target", value: 50 }] }, owner);
    expect(th.status, JSON.stringify(th.body)).toBe(200);
    expect(th.body.data.thresholds.map((x: { level: string }) => x.level)).toEqual(["critical", "warning"]);
    expect(code(await send("put", `/api/kpis/${k}/thresholds`, { thresholds: [{ level: "warning", comparator: "lt", value: 5 }, { level: "warning", comparator: "lt", value: 6 }] }, owner))).toBe("duplicate_level");
    // the same subject cannot hold the KPI twice at once; ending it frees the way, and an ended assignment is kept
    expect(code(await post(t.app, `/api/kpis/${k}/assignments`, { roleFamilyId: family }, owner))).toBe("already_assigned");
    expect(code(await post(t.app, `/api/kpis/${k}/assignments`, { roleFamilyId: family, assigneeId: "00000000-0000-4000-8000-000000000000" }, owner))).toBe("validation_failed");
    expect(code(await post(t.app, `/api/kpis/${k}/archive`, undefined, owner))).toBe("has_active_assignments");
    const aid = a.body.data.assignments[0].id as string;
    const ended = await send("delete", `/api/kpis/${k}/assignments/${aid}`, undefined, owner);
    expect(ended.status).toBe(200);
    expect(ended.body.data.assignments[0]).toMatchObject({ active: false, appliesTo: 0, effectiveTo: expect.any(String) }); // the end date is the first day it no longer applies: today
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM kpi_assignments").n).toBe(1); // kept, so past values stay explainable
    expect(code(await send("delete", `/api/kpis/${k}/assignments/${aid}`, undefined, owner))).toBe("already_ended");
    expect(code(await send("patch", `/api/kpis/${k}/assignments/${aid}`, { weight: 3 }, owner))).toBe("already_ended");
    // with nothing active any more the KPI can be assigned again, and archived
    expect((await post(t.app, `/api/kpis/${k}/assignments`, { roleFamilyId: family }, owner)).status).toBe(201);
    expect(code(await post(t.app, `/api/kpis/${k}/archive`, undefined, owner))).toBe("has_active_assignments");
    const actions = (t.db.prepare("SELECT action FROM audit_logs WHERE action LIKE 'kpi.%' ORDER BY rowid").all() as { action: string }[]).map((r) => r.action);
    expect(actions).toEqual(["kpi.create", "kpi.assign", "kpi.thresholds", "kpi.assignment_end", "kpi.assign"]);
  });

  it("a target range needs both ends on the assignment; a target to reach must be more than zero; weights and dates are checked", async () => {
    const { owner, emp } = await setup();
    const range = await created("/api/kpis", { name: "Utilisation", direction: "target_range", defaultTarget: 70, defaultTargetMax: 85, unit: "%" }, owner);
    const ok = await post(t.app, `/api/kpis/${range}/assignments`, { assigneeId: emp.membershipId }, owner);
    expect(ok.body.data.assignments[0]).toMatchObject({ targetValue: 70, targetMax: 85 });
    const k = await created("/api/kpis", { name: "Leads" }, owner);
    expect(code(await post(t.app, `/api/kpis/${k}/assignments`, { assigneeId: emp.membershipId }, owner))).toBe("target_required");
    expect(code(await post(t.app, `/api/kpis/${k}/assignments`, { assigneeId: emp.membershipId, targetValue: 0 }, owner))).toBe("invalid_target");
    expect(code(await post(t.app, `/api/kpis/${k}/assignments`, { assigneeId: emp.membershipId, targetValue: 5, weight: 0 }, owner))).toBe("invalid_number");
    expect(code(await post(t.app, `/api/kpis/${k}/assignments`, { assigneeId: emp.membershipId, targetValue: 5, effectiveFrom: "2026-02-30" }, owner))).toBe("invalid_date");
    expect(code(await post(t.app, `/api/kpis/${k}/assignments`, { assigneeId: emp.membershipId, targetValue: 5, effectiveFrom: "2026-05-01", effectiveTo: "2026-04-01" }, owner))).toBe("invalid_date");
  });

  it("permissions: an employee sees definitions and only their own assignments, cannot configure or assign; a manager assigns inside their scope only", async () => {
    const { owner, mgr, emp, other } = await setup();
    const k = await created("/api/kpis", { name: "Qualified leads", defaultTarget: 40 }, owner);
    await post(t.app, `/api/kpis/${k}/assignments`, { assigneeId: emp.membershipId }, owner);
    await post(t.app, `/api/kpis/${k}/assignments`, { assigneeId: other.membershipId }, owner);
    // an employee: definitions yes, assignments only their own, writes no
    expect((await get(t.app, "/api/kpis", emp.cookie)).body.data).toHaveLength(1);
    const seen = (await get(t.app, `/api/kpis/${k}`, emp.cookie)).body.data;
    expect(seen.assignments.map((a: { subject: { name: string } }) => a.subject.name)).toEqual(["Emma Employee"]);
    expect(seen.can).toMatchObject({ configure: false, assign: false });
    expect((await post(t.app, "/api/kpis", { name: "Mine" }, emp.cookie)).status).toBe(403);
    expect((await send("patch", `/api/kpis/${k}`, { name: "Hacked" }, emp.cookie)).status).toBe(403);
    expect((await send("put", `/api/kpis/${k}/thresholds`, { thresholds: [] }, emp.cookie)).status).toBe(403);
    expect((await post(t.app, `/api/kpis/${k}/assignments`, { assigneeId: emp.membershipId, targetValue: 1 }, emp.cookie)).status).toBe(403);
    // a manager sees their reports' assignments (not Olly's), assigns to a report, not to a stranger, and not to a whole family
    const m = (await get(t.app, `/api/kpis/${k}`, mgr.cookie)).body.data;
    expect(m.assignments.map((a: { subject: { name: string } }) => a.subject.name)).toEqual(["Emma Employee"]);
    const k2 = await created("/api/kpis", { name: "Response time", defaultTarget: 4, direction: "lower_is_better" }, owner);
    expect((await post(t.app, `/api/kpis/${k2}/assignments`, { assigneeId: emp.membershipId }, mgr.cookie)).status).toBe(201);
    expect(code(await post(t.app, `/api/kpis/${k2}/assignments`, { assigneeId: other.membershipId }, mgr.cookie))).toBe("outside_scope");
    const fam = await created("/api/role-families", { name: "Support" }, owner);
    expect(code(await post(t.app, `/api/kpis/${k2}/assignments`, { roleFamilyId: fam }, mgr.cookie))).toBe("outside_scope");
    expect((await send("delete", `/api/kpis/${k}/assignments/${(await get(t.app, `/api/kpis/${k}`, owner)).body.data.assignments.find((a: { subject: { name: string } }) => a.subject.name === "Olly Other").id}`, undefined, mgr.cookie)).status).toBe(404);
  });

  it("a person with no role cannot even list KPIs, and an archived KPI leaves the list but keeps its rows", async () => {
    const { owner } = await setup();
    const none = await addPerson(t.app, owner, "none@example.com", undefined, "No Role");
    expect((await get(t.app, "/api/kpis", none.cookie)).status).toBe(403);
    const k = await created("/api/kpis", { name: "Old KPI" }, owner);
    expect((await post(t.app, `/api/kpis/${k}/archive`, undefined, owner)).status).toBe(200);
    expect((await get(t.app, "/api/kpis", owner)).body.data).toEqual([]);
    expect((await get(t.app, "/api/kpis?includeArchived=true", owner)).body.data).toHaveLength(1);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM kpis").n).toBe(1);
    expect(code(await post(t.app, `/api/kpis/${k}/archive`, undefined, owner))).toBe("already_archived");
  });
});
