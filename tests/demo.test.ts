import { afterEach, describe, expect, it } from "vitest";
import type { Response } from "supertest";
import request from "supertest";
import { ORIGIN, type TestApp } from "./helpers/app.js";
import { get, makeAuthApp, post, signUpWithOrg } from "./helpers/auth.js";
import { roleIds } from "./helpers/roles.js";

let t: TestApp;
afterEach(() => t?.cleanup());

const one = <T>(sql: string, ...p: unknown[]) => t.db.prepare(sql).get(...p) as T;
const code = (r: { body: { error?: { code?: string } } }) => r.body.error?.code;
const created = async (path: string, body: Record<string, unknown>, cookie: string): Promise<string> => {
  const r = await post(t.app, path, body, cookie);
  expect(r.status, `${path} ${JSON.stringify(r.body)}`).toBe(201);
  return r.body.data.id as string;
};
const cookieOf = (res: Response, name: string): string | undefined => ([] as string[]).concat((res.headers["set-cookie"] as unknown as string[]) ?? []).find((c) => c.startsWith(`${name}=`))?.split(";")[0];
const audit = async (cookie: string) => (await get(t.app, "/api/audit-logs?limit=100", cookie)).body.data as { action: string; summary: string }[];

async function setup() {
  t = makeAuthApp();
  const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
  return { owner };
}
/** Every table that has an `is_demo` column, and how many flagged rows it holds. */
const demoRows = (): Record<string, number> => {
  const out: Record<string, number> = {};
  const tables = t.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
  for (const { name } of tables) {
    const cols = t.db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[];
    if (cols.some((c) => c.name === "is_demo")) out[name] = (t.db.prepare(`SELECT COUNT(*) n FROM ${name} WHERE is_demo = 1`).get() as { n: number }).n;
  }
  return out;
};
const personas = async (owner: string) => (await get(t.app, "/api/demo/personas", owner)).body.data as { id: string; name: string; designation: string | null; department: string | null; roles: string[] }[];
const viewAs = (owner: string, id: string) => post(t.app, `/api/demo/view-as/${id}`, undefined, owner);
const asCookie = async (owner: string, id: string): Promise<string> => {
  const r = await viewAs(owner, id);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return `${cookieOf(r, "zentro_session")}; ${cookieOf(r, "zentro_admin_session")}`;
};
const personaBy = (list: Awaited<ReturnType<typeof personas>>, pred: (p: Awaited<ReturnType<typeof personas>>[number]) => boolean) => list.find(pred)!;

describe("Load demo data", () => {
  it("loads about 60 people, six departments, teams and tasks as flagged rows; says what was loaded; a second load is refused", async () => {
    const { owner } = await setup();
    expect((await get(t.app, "/api/demo/status", owner)).body.data).toMatchObject({ loaded: false, counts: {}, realPeople: 1 });
    const r = await post(t.app, "/api/demo/load", undefined, owner);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.loaded).toBe(true);
    const c = r.body.data.counts as Record<string, number>;
    expect(c.people).toBeGreaterThanOrEqual(55);
    expect(c.people).toBeLessThanOrEqual(70);
    expect(c.departments).toBe(6);
    expect(c.teams).toBe(12);
    expect(c.tasks).toBeGreaterThan(120);
    expect(r.body.data.realPeople).toBe(1); // the Owner is not touched
    const flagged = demoRows();
    expect(flagged.organization_memberships).toBe(c.people);
    expect(flagged.tasks).toBe(c.tasks);
    expect(flagged.users).toBe(c.people);
    expect(code(await post(t.app, "/api/demo/load", undefined, owner))).toBe("demo_loaded");
    expect((await audit(owner))[0]!.summary).toMatch(/^Loaded demo data: \d+ people, 6 departments, 12 teams, \d+ tasks$/);
    // the company is real data the rest of the app reads
    const dirs = (await get(t.app, "/api/employees?limit=500", owner)).body.data;
    expect(dirs.total).toBe(c.people! + 1);
    const tree = (await get(t.app, "/api/hierarchy/tree?depth=2", owner)).body.data.nodes as { name: string; childCount: number }[];
    expect(tree.find((n) => n.childCount >= 6)).toBeTruthy(); // the CEO with the vice presidents and the chief of staff below
  });

  it("loads next to the organization's own structure even when the names collide (the demo ones are called \"... (demo)\"), and removes cleanly", async () => {
    const { owner } = await setup();
    const dept = await created("/api/departments", { name: "Engineering" }, owner);
    const fam = await created("/api/role-families", { name: "Sales" }, owner);
    await created("/api/designations", { name: "Mentor", roleFamilyId: fam }, owner);
    await created("/api/designations", { name: "Software Engineer" }, owner);
    const r = await post(t.app, "/api/demo/load", undefined, owner);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const s = (await get(t.app, "/api/organization/structure", owner)).body.data as { departments: { id: string; name: string; isDemo: boolean }[]; roleFamilies: { name: string; isDemo: boolean }[]; designations: { name: string; isDemo: boolean }[] };
    expect(s.departments.find((d) => d.id === dept)).toMatchObject({ name: "Engineering", isDemo: false });
    expect(s.departments.filter((d) => d.name === "Engineering (demo)" && d.isDemo)).toHaveLength(1);
    expect(s.roleFamilies.filter((f) => f.name === "Sales (demo)" && f.isDemo)).toHaveLength(1);
    expect(s.designations.filter((d) => d.name === "Mentor (demo)" && d.isDemo)).toHaveLength(1);
    expect(s.designations.filter((d) => d.name === "Software Engineer (demo)" && d.isDemo)).toHaveLength(1);
    expect((await post(t.app, "/api/demo/remove", undefined, owner)).status).toBe(200);
    const after = (await get(t.app, "/api/organization/structure", owner)).body.data as { departments: { name: string }[]; designations: { name: string }[] };
    expect(after.departments.map((d) => d.name)).toEqual(["Engineering"]);
    expect(after.designations.map((d) => d.name).sort()).toEqual(["Mentor", "Software Engineer"]);
  });

  it("is the same company for the same organization, with unique harmless logins that can never sign in", async () => {
    const { owner } = await setup();
    await post(t.app, "/api/demo/load", undefined, owner);
    const emails = (t.db.prepare("SELECT email, password_hash, status FROM users WHERE is_demo = 1").all() as { email: string; password_hash: string | null; status: string }[]);
    expect(emails.length).toBeGreaterThan(55);
    expect(new Set(emails.map((e) => e.email)).size).toBe(emails.length);
    expect(emails.every((e) => e.password_hash === null && e.email.endsWith("@demo.invalid") && e.status === "active")).toBe(true);
    const login = await post(t.app, "/api/auth/login", { email: emails[0]!.email, password: "anything at all 123" });
    expect(login.status).toBe(401);
    // another organization gets its own copy (different logins), and removing one leaves the other whole
    const ownerB = await signUpWithOrg(t.app, "b-owner@example.com", "Beta Co");
    expect((await post(t.app, "/api/demo/load", undefined, ownerB)).status).toBe(201);
    expect(one<{ n: number }>("SELECT COUNT(DISTINCT email) n FROM users WHERE is_demo = 1").n).toBe(one<{ n: number }>("SELECT COUNT(*) n FROM users WHERE is_demo = 1").n);
    const bTasks = one<{ n: number }>("SELECT COUNT(*) n FROM tasks WHERE organization_id = (SELECT id FROM organizations WHERE name = 'Beta Co')").n;
    expect((await post(t.app, "/api/demo/remove", undefined, owner)).status).toBe(200);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM tasks WHERE organization_id = (SELECT id FROM organizations WHERE name = 'Beta Co')").n).toBe(bTasks);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM tasks WHERE organization_id = (SELECT id FROM organizations WHERE name = 'Acme')").n).toBe(0);
  });

  it("only someone who holds demo.manage can use it", async () => {
    const { owner } = await setup();
    const ids = await roleIds(t.app, owner);
    const { addPerson } = await import("./helpers/roles.js");
    const emp = await addPerson(t.app, owner, "emp@example.com", ids.employee, "Emma");
    for (const [m, p] of [["get", "/api/demo/status"], ["post", "/api/demo/load"], ["post", "/api/demo/remove"], ["get", "/api/demo/personas"]] as const) {
      const r = m === "get" ? await get(t.app, p, emp.cookie) : await post(t.app, p, undefined, emp.cookie);
      expect(r.status, p).toBe(403);
    }
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM tasks").n).toBe(0);
  });
});

describe("Remove demo data", () => {
  it("removes every demo row in every table, leaves the organization's own data exactly as it was, and can load again", async () => {
    const { owner } = await setup();
    const dept = await created("/api/departments", { name: "My real department" }, owner);
    const team = await created("/api/teams", { name: "My real team", departmentId: dept }, owner);
    const person = await created("/api/employees", { name: "Real Person", teamId: team }, owner);
    await created("/api/tasks", { title: "My real task", assigneeIds: [person] }, owner);
    const snap = () => JSON.stringify([
      t.db.prepare("SELECT id, display_name, status, user_id FROM organization_memberships WHERE is_demo = 0 ORDER BY id").all(),
      t.db.prepare("SELECT id, name FROM departments WHERE is_demo = 0 ORDER BY id").all(),
      t.db.prepare("SELECT id, name FROM teams WHERE is_demo = 0 ORDER BY id").all(),
      t.db.prepare("SELECT id, title, status FROM tasks WHERE is_demo = 0 ORDER BY id").all(),
      t.db.prepare("SELECT id, task_id, assignee_membership_id FROM task_assignments ORDER BY id").all().length,
      t.db.prepare("SELECT id, role_id, membership_id FROM user_role_assignments WHERE membership_id NOT IN (SELECT id FROM organization_memberships WHERE is_demo = 1) ORDER BY id").all(),
      t.db.prepare("SELECT id, email FROM users WHERE is_demo = 0 ORDER BY id").all(),
    ]);
    const before = snap();
    await post(t.app, "/api/demo/load", undefined, owner);
    expect(Object.values(demoRows()).some((n) => n > 0)).toBe(true);
    const r = await post(t.app, "/api/demo/remove", undefined, owner);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ loaded: false, counts: {} });
    expect(demoRows()).toEqual(Object.fromEntries(Object.keys(demoRows()).map((k) => [k, 0]))); // zero is_demo rows anywhere
    expect(snap()).toBe(before);
    // nothing of the demo company is left hanging off anything: every table with an organization is consistent
    for (const [table, col] of [["task_updates", "task_id"], ["task_comments", "task_id"], ["task_assignments", "task_id"]] as const) {
      expect(one<{ n: number }>(`SELECT COUNT(*) n FROM ${table} x WHERE x.${col} NOT IN (SELECT id FROM tasks)`).n, table).toBe(0);
    }
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM reporting_relationships WHERE subordinate_membership_id NOT IN (SELECT id FROM organization_memberships) OR manager_membership_id NOT IN (SELECT id FROM organization_memberships)").n).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM notifications WHERE recipient_membership_id NOT IN (SELECT id FROM organization_memberships)").n).toBe(0);
    expect((await audit(owner)).map((e) => e.action).filter((a) => a.startsWith("demo."))).toEqual(["demo.remove", "demo.load"]);
    expect(code(await post(t.app, "/api/demo/remove", undefined, owner))).toBe("demo_not_loaded");
    expect((await post(t.app, "/api/demo/load", undefined, owner)).status).toBe(201); // and again
  });

  it("is refused, with a plain list and nothing changed, while the organization's own data points at demo data", async () => {
    const { owner } = await setup();
    await post(t.app, "/api/demo/load", undefined, owner);
    const people = (await get(t.app, "/api/employees?limit=500", owner)).body.data.people as { id: string; displayName: string; teams: { id: string }[]; hasLogin: boolean }[];
    const demoPerson = people.find((p) => p.teams.length > 0)!;
    const demoTeam = demoPerson.teams[0]!.id;
    // 1. a real task given to a demo person
    const real = await created("/api/tasks", { title: "Real task for a demo person", assigneeIds: [demoPerson.id] }, owner);
    // 2. a real person added to a demo team
    const realPerson = await created("/api/employees", { name: "Real Newcomer" }, owner);
    await post(t.app, `/api/teams/${demoTeam}/members`, { membershipId: realPerson }, owner);
    const before = one<{ n: number }>("SELECT COUNT(*) n FROM organization_memberships").n;
    const r = await post(t.app, "/api/demo/remove", undefined, owner);
    expect(r.status).toBe(409);
    expect(code(r)).toBe("demo_blocked");
    const kinds = (r.body.error.details.blockers as { kind: string; count: number; message: string }[]).map((b) => b.kind).sort();
    expect(kinds).toEqual(expect.arrayContaining(["tasks", "teams"]));
    expect(r.body.error.details.blockers.find((b: { kind: string }) => b.kind === "tasks").message).toMatch(/^1 of your own task is assigned to/);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM organization_memberships").n).toBe(before); // nothing was removed
    expect((await get(t.app, "/api/demo/status", owner)).body.data.loaded).toBe(true);
    // fix both and it goes through
    const row = one<{ id: string }>("SELECT id FROM task_assignments WHERE task_id = ?", real);
    await post(t.app, `/api/tasks/${real}/assignments/${row.id}/end`, undefined, owner);
    const teamRow = one<{ id: string }>("SELECT id FROM team_memberships WHERE membership_id = ?", realPerson);
    const deptRow = one<{ id: string; department_id: string }>("SELECT id, department_id FROM department_memberships WHERE membership_id = ?", realPerson);
    const end = (path: string) => request(t.app).patch(path).set("Origin", ORIGIN).set("Cookie", owner).send({ endDate: new Date().toISOString().slice(0, 10) });
    expect((await end(`/api/teams/${demoTeam}/members/${teamRow.id}`)).status).toBe(200);
    expect((await end(`/api/departments/${deptRow.department_id}/members/${deptRow.id}`)).status).toBe(200); // joining a team also put them in its department
    const again = await post(t.app, "/api/demo/remove", undefined, owner);
    expect(again.status, JSON.stringify(again.body)).toBe(200);
  });

  it("Delete my account: demo people count as people until the demo data is removed", async () => {
    const { owner } = await setup();
    await post(t.app, "/api/demo/load", undefined, owner);
    const del = { password: "correct horse battery", confirmEmail: "owner@example.com", confirmOrganizationName: "Acme" };
    expect(code(await post(t.app, "/api/auth/delete-account", del, owner))).toBe("last_admin");
    await post(t.app, "/api/demo/remove", undefined, owner);
    const res = await post(t.app, "/api/auth/delete-account", del, owner);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM demo_data_batches").n).toBe(0);
  });
});

describe("View as a demo person", () => {
  it("shows each person their own view with their own permissions: CEO sees everyone, a department head their department, an employee only teammates", async () => {
    const { owner } = await setup();
    await post(t.app, "/api/demo/load", undefined, owner);
    const list = await personas(owner);
    expect(list.length).toBeGreaterThan(55);
    const ceo = personaBy(list, (p) => p.designation === "Chief Executive Officer");
    const vp = personaBy(list, (p) => p.designation === "Vice President" && p.department === "Engineering");
    const emp = personaBy(list, (p) => p.designation === "Software Engineer" && p.roles.includes("Employee"));
    const total = (await get(t.app, "/api/employees?limit=500", owner)).body.data.total as number;

    const asCeo = await asCookie(owner, ceo.id);
    const meCeo = (await get(t.app, "/api/auth/me", asCeo)).body.data;
    expect(meCeo.viewingAs).toMatchObject({ personName: ceo.name, adminName: "Test Person" });
    expect(meCeo.capabilities["leadership.view"]).toEqual(["all_in_scope"]);
    expect((await get(t.app, "/api/employees?limit=500", asCeo)).body.data.total).toBe(total);

    const asVp = await asCookie(owner, vp.id);
    const vpSees = (await get(t.app, "/api/employees?limit=500", asVp)).body.data;
    expect(vpSees.total).toBeGreaterThan(15);
    expect(vpSees.total).toBeLessThan(30);
    expect((vpSees.people as { departments: { name: string }[] }[]).every((p) => p.departments.some((d) => d.name === "Engineering"))).toBe(true);

    const asEmp = await asCookie(owner, emp.id);
    const empSees = (await get(t.app, "/api/employees?limit=500", asEmp)).body.data;
    expect(empSees.total).toBeGreaterThanOrEqual(2);
    expect(empSees.total).toBeLessThan(12);
    expect((await get(t.app, "/api/my-work", asEmp)).body.data.counts.open).toBeGreaterThan(0);
    expect((await get(t.app, "/api/demo/status", asEmp)).status).toBe(403); // a demo employee cannot manage demo data
  });

  it("is read only: every write is refused with read_only_session, reads work, and the audit says who looked at whom", async () => {
    const { owner } = await setup();
    await post(t.app, "/api/demo/load", undefined, owner);
    const ceo = personaBy(await personas(owner), (p) => p.designation === "Chief Executive Officer");
    const asCeo = await asCookie(owner, ceo.id);
    for (const [path, body] of [["/api/departments", { name: "Nope" }], ["/api/tasks", { title: "Nope" }], ["/api/daily-updates", { summary: "Nope" }], ["/api/notifications/read-all", undefined], ["/api/demo/remove", undefined]] as [string, unknown][]) {
      const r = await post(t.app, path, body, asCeo);
      expect(r.status, path).toBe(403);
      expect(code(r), path).toBe("read_only_session");
    }
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM departments WHERE name = 'Nope'").n).toBe(0);
    expect((await get(t.app, "/api/my-work", asCeo)).status).toBe(200);
    const log = await audit(owner);
    expect(log.find((e) => e.action === "demo.view_as")!.summary).toBe(`Started viewing as the demo person ${ceo.name} (read only)`);
  });

  it("cannot target a real person or another organization's person, nor nest; stopping gives the administrator's own session back", async () => {
    const { owner } = await setup();
    await post(t.app, "/api/demo/load", undefined, owner);
    const ownerB = await signUpWithOrg(t.app, "b-owner@example.com", "Beta Co");
    await post(t.app, "/api/demo/load", undefined, ownerB);
    const ceoA = personaBy(await personas(owner), (p) => p.designation === "Chief Executive Officer");
    const realMembership = (await get(t.app, "/api/auth/me", owner)).body.data.membership.id;
    expect((await viewAs(owner, realMembership)).status).toBe(404); // a real person can never be viewed as
    expect((await viewAs(ownerB, ceoA.id)).status).toBe(404); // another organization's demo person
    const r = await viewAs(owner, ceoA.id);
    const demoCookie = cookieOf(r, "zentro_session")!;
    const both = `${demoCookie}; ${cookieOf(r, "zentro_admin_session")}`;
    expect(code(await viewAs(both, ceoA.id))).toBe("read_only_session"); // no nesting (it is a write)
    expect((await get(t.app, "/api/auth/me", both)).body.data.user.name).toBe(ceoA.name);
    const stop = await post(t.app, "/api/demo/stop-viewing", undefined, both);
    expect(stop.status, JSON.stringify(stop.body)).toBe(200);
    const back = cookieOf(stop, "zentro_session")!;
    expect(back).toBeTruthy();
    expect((await get(t.app, "/api/auth/me", back)).body.data).toMatchObject({ user: { email: "owner@example.com" }, viewingAs: null });
    expect((await get(t.app, "/api/auth/me", both)).status).toBe(401); // the demo session is revoked
    expect(code(await post(t.app, "/api/demo/stop-viewing", undefined, back))).toBe("not_viewing");
    expect((await audit(owner)).map((e) => e.action)).toEqual(expect.arrayContaining(["demo.view_as", "demo.view_as_stop"]));
  });

  it("a demo session expires after an hour and dies with the demo data", async () => {
    const { owner } = await setup();
    await post(t.app, "/api/demo/load", undefined, owner);
    const p = personaBy(await personas(owner), (x) => x.designation === "Chief Executive Officer");
    const cookie = await asCookie(owner, p.id);
    const session = one<{ absolute_expires_at: string; impersonated_by_user_id: string }>("SELECT absolute_expires_at, impersonated_by_user_id FROM sessions WHERE impersonated_by_user_id IS NOT NULL");
    expect(Date.parse(session.absolute_expires_at) - Date.now()).toBeLessThanOrEqual(60 * 60_000);
    expect(session.impersonated_by_user_id).toBeTruthy();
    await post(t.app, "/api/demo/remove", undefined, owner);
    expect((await get(t.app, "/api/auth/me", cookie)).status).toBe(401);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM sessions WHERE impersonated_by_user_id IS NOT NULL").n).toBe(0);
  });
});
