import { afterEach, describe, expect, it } from "vitest";
import type { Response } from "supertest";
import type { TestApp } from "./helpers/app.js";
import { get, makeAuthApp, post, signUpWithOrg } from "./helpers/auth.js";
import { addPerson, roleIds } from "./helpers/roles.js";
import request from "supertest";
import { ORIGIN } from "./helpers/app.js";

let t: TestApp;
afterEach(() => t?.cleanup());

const dayOffset = (n: number): string => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const created = async (path: string, body: Record<string, unknown>, cookie: string): Promise<string> => {
  const r = await post(t.app, path, body, cookie);
  expect(r.status, `${path} ${JSON.stringify(r.body)}`).toBe(201);
  return r.body.data.id as string;
};
const overview = async (cookie: string) => (await get(t.app, "/api/overview", cookie)).body.data;
const cookieOf = (res: Response, name: string): string | undefined => ([] as string[]).concat((res.headers["set-cookie"] as unknown as string[]) ?? []).find((c) => c.startsWith(`${name}=`))?.split(";")[0];

describe("Overview (stage 6.1)", () => {
  it("an empty organization: nothing counted, nothing invented, and the checklist is all undone", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const o = await overview(owner);
    expect(o.preset).toBe("executive");
    expect(o.personal).toMatchObject({ open: 0, overdue: 0, dueToday: 0, blocked: 0, completedRecently: 0, unreadNotifications: 0, next: null });
    expect(o.organization).toMatchObject({ people: 1, departments: 0, teams: 0, tasksByStatus: {}, overdueTasks: 0, openTasks: 0, departmentLoad: [] });
    expect(o.organization.completedByDay).toHaveLength(14);
    expect(o.organization.completedByDay.every((d: { count: number }) => d.count === 0)).toBe(true);
    expect(o.checklist.map((c: { key: string; done: boolean }) => [c.key, c.done])).toEqual([["departments", false], ["people", false], ["reporting", false], ["objective", false], ["kpi", false], ["tasks", false]]);
    expect(o.flags).toEqual({ demoLoaded: false, canManageDemo: true, canSetUp: true });
  });

  it("the checklist ticks by itself as real data appears", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const state = async () => Object.fromEntries((await overview(owner)).checklist.map((c: { key: string; done: boolean }) => [c.key, c.done]));
    await created("/api/departments", { name: "Engineering" }, owner);
    expect(await state()).toMatchObject({ departments: true, people: false });
    const a = await created("/api/employees", { name: "Ann" }, owner);
    expect(await state()).toMatchObject({ people: true, reporting: false });
    const b = await created("/api/employees", { name: "Bo", managerId: a }, owner);
    expect(await state()).toMatchObject({ reporting: true, tasks: false });
    await created("/api/tasks", { title: "First", assigneeIds: [b] }, owner);
    expect(await state()).toMatchObject({ tasks: true, objective: false, kpi: false });
    await created("/api/objectives", { level: "company", title: "Grow", startDate: "2026-01-01", endDate: "2026-12-31" }, owner);
    expect(await state()).toMatchObject({ objective: true, kpi: false });
    await created("/api/kpis", { name: "Qualified leads" }, owner);
    expect(await state()).toMatchObject({ kpi: true });
  });

  it("shows company objectives with their real attainment, 'no data' as null, and how many of my open tasks support none", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const o = (await post(t.app, "/api/objectives", { level: "company", title: "Grow", startDate: "2026-01-01", endDate: "2026-12-31", keyResults: [{ title: "Deals", targetValue: 10 }] }, owner)).body.data;
    await created("/api/tasks", { title: "Unlinked" }, owner);
    const linked = await created("/api/tasks", { title: "Linked" }, owner);
    await request(t.app).patch(`/api/tasks/${linked}`).set("Origin", ORIGIN).set("Cookie", owner).send({ objectiveId: o.id });
    let ov = await overview(owner);
    expect(ov.objectives.items).toEqual([expect.objectContaining({ id: o.id, title: "Grow", attainmentPct: null, dataState: "none" })]);
    expect(ov.personal.unalignedOpen).toBe(1);
    await post(t.app, `/api/key-results/${o.keyResults[0].id}/progress`, { value: 5 }, owner);
    ov = await overview(owner);
    expect(ov.objectives.items[0]).toMatchObject({ attainmentPct: 50, dataState: "ok" });
  });

  it("shows KPI health from the series the caller may see (nothing when there is none, and nothing without kpi.view)", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    expect((await overview(owner)).kpis).toEqual({ totals: { series: 0, byStatus: {}, missingPeriods: 0, kpis: 0 }, attention: [] });
    const none = await addPerson(t.app, owner, "none@example.com", undefined, "No Role");
    expect((await overview(none.cookie)).kpis).toBeNull();
  });

  it("counts what is really there: statuses, overdue work, completions by day, and the load of each department", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const eng = await created("/api/departments", { name: "Engineering" }, owner);
    const sales = await created("/api/departments", { name: "Sales" }, owner);
    const a = await created("/api/employees", { name: "Ann", departmentId: eng }, owner);
    const b = await created("/api/employees", { name: "Bo", departmentId: sales }, owner);
    await created("/api/tasks", { title: "Late", assigneeIds: [a], dueAt: dayOffset(-2) }, owner);
    await created("/api/tasks", { title: "Fine", assigneeIds: [a], dueAt: dayOffset(5) }, owner);
    const done = await created("/api/tasks", { title: "Done", assigneeIds: [b] }, owner);
    await post(t.app, `/api/tasks/${done}/updates`, { type: "status_change", toStatus: "in_progress" }, owner);
    await post(t.app, `/api/tasks/${done}/updates`, { type: "status_change", toStatus: "completed" }, owner);
    await created("/api/tasks", { title: "Mine", dueAt: dayOffset(0) }, owner);
    const o = await overview(owner);
    expect(o.organization.tasksByStatus).toEqual({ not_started: 3, completed: 1 });
    expect(o.organization).toMatchObject({ openTasks: 3, overdueTasks: 1, people: 3, departments: 2 });
    expect(o.organization.completedByDay.at(-1)).toEqual({ date: dayOffset(0), count: 1 });
    expect(o.organization.departmentLoad).toEqual(expect.arrayContaining([{ id: eng, name: "Engineering", people: 1, open: 2, overdue: 1 }, { id: sales, name: "Sales", people: 1, open: 0, overdue: 0 }]));
    expect(o.personal).toMatchObject({ open: 1, dueToday: 1, next: { title: "Mine" } });
  });

  it("adapts to what each person may see: an employee gets their own work, a manager adds their people, the Owner sees everything", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ids = await roleIds(t.app, owner);
    const dept = await created("/api/departments", { name: "Engineering" }, owner);
    const team = await created("/api/teams", { name: "Core", departmentId: dept }, owner);
    const mgr = await addPerson(t.app, owner, "mgr@example.com", ids.manager, "Max Manager");
    const emp = await addPerson(t.app, owner, "emp@example.com", ids.employee, "Emma Employee");
    const stranger = await addPerson(t.app, owner, "stranger@example.com", ids.employee, "Sam Stranger");
    await post(t.app, `/api/teams/${team}/members`, { membershipId: emp.membershipId }, owner);
    await post(t.app, "/api/hierarchy/reporting", { subordinateId: emp.membershipId, managerId: mgr.membershipId }, owner);
    await created("/api/tasks", { title: "Late invoice", assigneeIds: [emp.membershipId], dueAt: dayOffset(-3) }, mgr.cookie);
    const blocked = await created("/api/tasks", { title: "Stuck", assigneeIds: [emp.membershipId] }, mgr.cookie);
    await post(t.app, `/api/tasks/${blocked}/updates`, { type: "status_change", toStatus: "blocked", note: "Waiting" }, emp.cookie);
    await created("/api/tasks", { title: "Sam's secret task" }, stranger.cookie);

    const e = await overview(emp.cookie);
    expect(e.preset).toBe("personal");
    expect(e.organization).toBeNull();
    expect(e.personal).toMatchObject({ open: 2, overdue: 1, blocked: 1 });

    const m = await overview(mgr.cookie);
    expect(m.preset).toBe("team");
    expect(m.organization).toBeNull();
    expect(m.team).toMatchObject({ label: "Your people", people: 1, openTasks: 2, overdueTasks: 1, blockedTasks: 1 });
    expect(m.team.needsAttention).toEqual([{ id: emp.membershipId, name: "Emma Employee", overdue: 1, blocked: 1 }]);
    expect(JSON.stringify(m)).not.toContain("Sam");

    const o = await overview(owner);
    expect(o.preset).toBe("executive");
    expect(o.organization.openTasks).toBe(3);
  });

  it("a person with no role gets their own (empty) work and nothing else; another organization's numbers never appear", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    await created("/api/tasks", { title: "Acme only" }, owner);
    const none = await addPerson(t.app, owner, "none@example.com", undefined, "No Role");
    const o = await overview(none.cookie);
    expect(o).toMatchObject({ preset: "personal", team: null, organization: null, objectives: null, personal: { open: 0 } }); // no okr.view: no objectives widget
    expect(o.flags.canManageDemo).toBe(false);
    const ownerB = await signUpWithOrg(t.app, "b-owner@example.com", "Beta Co");
    const b = await overview(ownerB);
    expect(b.organization).toMatchObject({ people: 1, openTasks: 0, tasksByStatus: {} });
    expect(JSON.stringify(b)).not.toContain("Acme");
  });

  it("with demo data loaded the page is full, and each persona gets a different page from the same rows", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    await post(t.app, "/api/demo/load", undefined, owner);
    const exec = await overview(owner);
    expect(exec.flags.demoLoaded).toBe(true);
    expect(exec.organization.people).toBeGreaterThan(55);
    expect(exec.organization.departmentLoad.length).toBeGreaterThanOrEqual(5);
    expect(exec.organization.tasksByStatus.completed).toBeGreaterThan(20);
    expect(exec.organization.completedByDay.reduce((n: number, d: { count: number }) => n + d.count, 0)).toBeGreaterThan(5);
    expect(exec.checklist.filter((c: { done: boolean }) => c.done).map((c: { key: string }) => c.key)).toEqual(["departments", "people", "reporting", "objective", "kpi", "tasks"]);
    expect(exec.kpis.totals.series).toBeGreaterThan(10);
    expect(exec.kpis.attention.length).toBeGreaterThan(0);
    expect(exec.objectives.items.some((i: { health: string | null }) => i.health !== null)).toBe(true);
    expect(exec.objectives.total).toBeGreaterThanOrEqual(3);
    expect(exec.objectives.items.length).toBeGreaterThanOrEqual(3);
    expect(exec.objectives.items.some((i: { attainmentPct: number | null }) => i.attainmentPct !== null && i.attainmentPct > 0)).toBe(true);
    const personas = (await get(t.app, "/api/demo/personas", owner)).body.data as { id: string; designation: string; roles: string[] }[];
    const view = async (id: string) => {
      const r = await post(t.app, `/api/demo/view-as/${id}`, undefined, owner);
      return overview(`${cookieOf(r, "zentro_session")}; ${cookieOf(r, "zentro_admin_session")}`);
    };
    const ceo = await view(personas.find((p) => p.designation === "Chief Executive Officer")!.id);
    expect(ceo.preset).toBe("executive");
    const vp = await view(personas.find((p) => p.designation === "Vice President")!.id);
    expect(vp.preset).toBe("team");
    expect(vp.team.label).toBe("Your department");
    // among the employees at least one has work open (the company has about forty of them); each sees only their own page
    const employees = personas.filter((p) => p.roles.includes("Employee"));
    expect(employees.length).toBeGreaterThan(20);
    let withWork = 0;
    for (const e of employees.slice(0, 12)) {
      const emp = await view(e.id);
      expect(emp.organization).toBeNull();
      if (emp.personal.open > 0) withWork += 1;
    }
    expect(withWork).toBeGreaterThan(0);
    expect(vp.personal.unreadNotifications + ceo.personal.unreadNotifications).toBeGreaterThanOrEqual(0);
  });
});
