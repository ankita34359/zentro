import { afterEach, describe, expect, it, vi } from "vitest";
import type { Response } from "supertest";
import request from "supertest";
import { ORIGIN, type TestApp } from "./helpers/app.js";
import { get, makeAuthApp, post, signUpWithOrg } from "./helpers/auth.js";
import { roleIds } from "./helpers/roles.js";

let t: TestApp;
afterEach(() => { vi.useRealTimers(); t?.cleanup(); });

const send = (method: "patch" | "delete", path: string, body: Record<string, unknown> | undefined, cookie: string) => {
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
    expect(c.objectives).toBeGreaterThanOrEqual(12);
    expect(flagged.objectives).toBe(c.objectives);
    expect(flagged.key_results).toBe(c.keyResults);
    expect(code(await post(t.app, "/api/demo/load", undefined, owner))).toBe("demo_loaded");
    expect((await audit(owner))[0]!.summary).toMatch(/^Loaded demo data: \d+ people, 6 departments, 12 teams, \d+ tasks, \d+ objectives, \d+ KPIs$/);
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
    // the company is drawn from the organization's id, so pick an engineer who really has open work (the page for someone with none is empty by design)
    const withOpenWork = new Set((t.db.prepare("SELECT DISTINCT a.assignee_membership_id AS id FROM task_assignments a JOIN tasks tk ON tk.id = a.task_id WHERE tk.is_demo = 1 AND tk.status NOT IN ('completed', 'cancelled') AND a.unassigned_at IS NULL").all() as { id: string }[]).map((r) => r.id));
    const emp = personaBy(list, (p) => p.designation === "Software Engineer" && p.roles.includes("Employee") && withOpenWork.has(p.id));
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

describe("Demo objectives, key results and linked tasks (stages 3.1 and 4.2)", () => {
  it("loads company, department, team and personal objectives with recorded values, an honest 'no data' key result, linked tasks, outcomes and dependencies", async () => {
    const { owner } = await setup();
    await post(t.app, "/api/demo/load", undefined, owner);
    const list = (await get(t.app, "/api/objectives", owner)).body.data as { id: string; level: string; lifecycle: string; attainmentPct: number | null; dataState: string; isDemo: boolean; published: boolean; title: string }[];
    expect(new Set(list.map((o) => o.level))).toEqual(new Set(["company", "department", "team", "individual"]));
    expect(list.every((o) => o.isDemo)).toBe(true);
    expect(list.filter((o) => o.published).length).toBeGreaterThanOrEqual(2);
    expect(list.some((o) => o.lifecycle === "draft")).toBe(true);
    expect(list.some((o) => o.lifecycle === "completed")).toBe(true);
    expect(list.some((o) => o.attainmentPct !== null && o.attainmentPct > 0)).toBe(true);
    // a key result with nothing recorded shows null, never 0
    const second = (await get(t.app, `/api/objectives/${list.find((o) => o.title.startsWith("Make Zentro"))!.id}`, owner)).body.data;
    const none = second.keyResults.find((k: { title: string }) => k.title === "Self-serve activation rate");
    expect(none).toMatchObject({ currentValue: null, attainmentPct: null });
    expect(second.attainmentPct).not.toBeNull(); // the others still count: the objective is computed from the key results that have data
    // linked tasks, outcomes (some reviewed by a manager, never by the person who did the work) and dependencies exist
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM tasks WHERE is_demo = 1 AND objective_id IS NOT NULL").n).toBeGreaterThan(30);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM tasks WHERE is_demo = 1 AND outcome_summary IS NOT NULL AND status = 'completed'").n).toBeGreaterThan(3);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM tasks t WHERE t.outcome_reviewed_by IS NOT NULL AND EXISTS (SELECT 1 FROM task_assignments a WHERE a.task_id = t.id AND a.assignee_membership_id = t.outcome_reviewed_by)").n).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM task_dependencies").n).toBeGreaterThan(0);
    // no open task waits for a task that depends on it (the seed cannot create a loop), and no finished task waits for an unfinished one
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM task_dependencies d JOIN tasks a ON a.id = d.task_id JOIN tasks b ON b.id = d.depends_on_task_id WHERE a.status IN ('completed', 'cancelled') AND b.status NOT IN ('completed', 'cancelled')").n).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM objective_progress_history WHERE source <> 'demo'").n).toBe(0);
  });

  it("view as a department head: they see their department's objectives and the published company ones, not other departments' drafts", async () => {
    const { owner } = await setup();
    await post(t.app, "/api/demo/load", undefined, owner);
    const personas = (await get(t.app, "/api/demo/personas", owner)).body.data as { id: string; designation: string; department: string }[];
    const vp = personas.find((p) => p.designation === "Vice President" && p.department === "Product & Design")!;
    const r = await post(t.app, `/api/demo/view-as/${vp.id}`, undefined, owner);
    const cookie = ([] as string[]).concat((r.headers["set-cookie"] as unknown as string[]) ?? []).map((c) => c.split(";")[0]).join("; ");
    const titles = ((await get(t.app, "/api/objectives", cookie)).body.data as { title: string }[]).map((o) => o.title);
    expect(titles).toContain("Redesign the first-run experience");
    expect(titles).toContain("Reach $12M in annual recurring revenue"); // published
    expect(titles).not.toContain("Build a team people want to stay in"); // a company objective that is not published
  });

  it("removal removes every objective, key result, recorded value and dependency of the demo, and leaves real ones untouched; real data pointing at demo objectives blocks it", async () => {
    const { owner } = await setup();
    const real = await created("/api/objectives", { level: "company", title: "My real objective", startDate: "2026-01-01", endDate: "2026-12-31", keyResults: [{ title: "Real KR", targetValue: 10 }] }, owner);
    await post(t.app, "/api/demo/load", undefined, owner);
    // a real task linked to a demo objective stops the removal
    const demoObjective = ((await get(t.app, "/api/objectives", owner)).body.data as { id: string; isDemo: boolean }[]).find((o) => o.isDemo)!;
    const task = await created("/api/tasks", { title: "Real task for a demo goal" }, owner);
    expect((await send("patch", `/api/tasks/${task}`, { objectiveId: demoObjective.id }, owner)).status).toBe(200);
    const blocked = await post(t.app, "/api/demo/remove", undefined, owner);
    expect(code(blocked)).toBe("demo_blocked");
    expect((blocked.body.error.details.blockers as { kind: string }[]).map((b) => b.kind)).toContain("objective_tasks");
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM objectives WHERE is_demo = 1").n).toBeGreaterThan(0); // nothing changed
    await send("patch", `/api/tasks/${task}`, { objectiveId: null }, owner);
    expect((await post(t.app, "/api/demo/remove", undefined, owner)).status).toBe(200);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM objective_progress_history").n).toBe(0); // the real objective has none recorded
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM task_dependencies").n).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM objectives").n).toBe(1);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM key_results").n).toBe(1);
    expect((await get(t.app, `/api/objectives/${real}`, owner)).body.data.title).toBe("My real objective");
  });
});

describe("Demo alignment and health (stage 3.2)", () => {
  it("the demo objectives are aligned company → department → team → person with health computed, one is left unaligned for the gaps report, and the first sweep announces nothing", async () => {
    const { owner } = await setup();
    await post(t.app, "/api/demo/load", undefined, owner);
    const tree = (await get(t.app, "/api/objectives/tree", owner)).body.data as { roots: { level: string; title: string; children: { children: unknown[] }[] }[] };
    expect(tree.roots.filter((r) => r.level === "company")).toHaveLength(3);
    const depth = (n: { children: { children: unknown[] }[] }): number => 1 + Math.max(0, ...n.children.map((c) => depth(c as never)));
    expect(Math.max(...tree.roots.map((r) => depth(r as never)))).toBe(4); // company → department → team → personal
    const gaps = (await get(t.app, "/api/objectives/alignment-gaps", owner)).body.data;
    expect(gaps.unaligned.map((g: { title: string }) => g.title)).toContain("Plan next year's roadmap");
    const list = (await get(t.app, "/api/objectives", owner)).body.data as { health: string | null }[];
    expect(new Set(list.map((o) => o.health)).size).toBeGreaterThanOrEqual(3); // a believable spread
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM objectives WHERE is_demo = 1 AND health IS NULL").n).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM objective_assignments").n).toBeGreaterThanOrEqual(4);
    t.db.prepare("DELETE FROM scheduled_job_runs WHERE job_name = 'okr.health'").run();
    await t.tick.run();
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM automation_events WHERE event_type = 'objective.at_risk'").n).toBe(0);
    // removal takes the links and assignments with it
    expect((await post(t.app, "/api/demo/remove", undefined, owner)).status).toBe(200);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM objective_relationships").n).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM objective_assignments").n).toBe(0);
  });

  it("a real objective aligned with a demo one, or assigned to a demo team, stops the removal with a plain list", async () => {
    const { owner } = await setup();
    const real = await created("/api/objectives", { level: "department", departmentId: await created("/api/departments", { name: "My department" }, owner), title: "My real objective", startDate: "2026-01-01", endDate: "2026-12-31" }, owner);
    await post(t.app, "/api/demo/load", undefined, owner);
    const demoCompany = ((await get(t.app, "/api/objectives", owner)).body.data as { id: string; level: string; isDemo: boolean }[]).find((o) => o.isDemo && o.level === "company")!;
    const al = await request(t.app).put(`/api/objectives/${real}/parent`).set("Origin", ORIGIN).set("Cookie", owner).send({ parentId: demoCompany.id });
    expect(al.status, JSON.stringify(al.body)).toBe(200);
    const blocked = await post(t.app, "/api/demo/remove", undefined, owner);
    expect(code(blocked)).toBe("demo_blocked");
    expect((blocked.body.error.details.blockers as { kind: string }[]).map((b) => b.kind)).toContain("objective_links");
    await request(t.app).delete(`/api/objectives/${real}/parent`).set("Origin", ORIGIN).set("Cookie", owner);
    const demoTeam = (await get(t.app, "/api/organization/structure", owner)).body.data.teams.find((x: { isDemo?: boolean }) => x.isDemo).id as string;
    expect((await post(t.app, `/api/objectives/${real}/assignments`, { teamId: demoTeam }, owner)).status).toBe(201);
    expect((await post(t.app, "/api/demo/remove", undefined, owner)).body.error.details.blockers.map((b: { kind: string }) => b.kind)).toContain("objective_assignments");
  });
});

describe("Demo KPIs (stages 3.3 and 3.4)", () => {
  it("the demo company has KPIs assigned to a role family, teams, a department and the organization, with months of values, gaps, a correction and alerts already raised", async () => {
    const { owner } = await setup();
    const load = await post(t.app, "/api/demo/load", undefined, owner);
    expect(load.body.data.counts.kpis).toBeGreaterThanOrEqual(9);
    const kpis = (await get(t.app, "/api/kpis", owner)).body.data as { id: string; name: string; isDemo: boolean; assignmentCount: number }[];
    expect(kpis.every((k) => k.isDemo)).toBe(true);
    const leads = kpis.find((k) => k.name === "Qualified leads")!;
    const detail = (await get(t.app, `/api/kpis/${leads.id}`, owner)).body.data;
    expect(detail.assignments[0]).toMatchObject({ subject: { kind: "role_family", name: "Sales" }, targetValue: 40 });
    expect(detail.assignments[0].appliesTo).toBeGreaterThan(5);
    expect(detail.thresholds.map((x: { level: string }) => x.level)).toEqual(["critical", "warning"]);
    // the first seller has a corrected value: both rows stay
    const subjects = (await get(t.app, `/api/kpis/${leads.id}/subjects`, owner)).body.data as { subject: { kind: string; id: string }; missing: number }[];
    expect(subjects.length).toBeGreaterThan(5);
    expect(subjects.some((s) => s.missing > 0)).toBe(true);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM kpi_measurements WHERE kpi_id = ? AND supersedes_measurement_id IS NOT NULL", leads.id).n).toBe(1);
    // organization-level KPIs use the KPI's own target
    const arr = kpis.find((k) => k.name === "Annual recurring revenue")!;
    const h = (await get(t.app, `/api/kpis/${arr.id}/history?subject=organization`, owner)).body.data;
    expect(h.target).toMatchObject({ targetValue: 12 });
    expect(h.periods.filter((p: { state: string }) => p.state === "recorded").length).toBe(6);
    // the overview shows the platform team's failing change-failure rate as critical, and the missing months
    const ov = (await get(t.app, "/api/kpis/overview", owner)).body.data;
    expect(ov.totals.byStatus.critical).toBeGreaterThanOrEqual(1);
    expect(ov.totals.missingPeriods).toBeGreaterThan(0);
    expect(ov.attention.some((a: { kpiName: string; status: string }) => a.kpiName === "Change failure rate" && a.status === "critical")).toBe(true);
    // alerts were raised once at load: the first hourly pass adds none
    const before = one<{ n: number }>("SELECT COUNT(*) n FROM automation_events WHERE event_type IN ('kpi.threshold', 'kpi.measurement_missed')").n;
    expect(before).toBeGreaterThan(0);
    t.db.prepare("DELETE FROM scheduled_job_runs WHERE job_name = 'kpi.thresholds'").run();
    await t.tick.run();
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM automation_events WHERE event_type IN ('kpi.threshold', 'kpi.measurement_missed')").n).toBe(before);
  });

  it("a demo seller sees only their own series; removal leaves no KPI row of any kind, and a real KPI assigned to a demo team blocks it", async () => {
    const { owner } = await setup();
    const real = await created("/api/kpis", { name: "My real KPI", defaultTarget: 10 }, owner);
    await post(t.app, "/api/demo/load", undefined, owner);
    const ps = await personas(owner);
    const seller = ps.find((p) => p.designation === "Account Executive")!;
    const as = await asCookie(owner, seller.id);
    const ov = (await get(t.app, "/api/kpis/overview", as)).body.data;
    const all = (await get(t.app, "/api/kpis/overview", owner)).body.data;
    expect(ov.totals.series).toBeGreaterThan(0);
    expect(ov.totals.series).toBeLessThan(all.totals.series / 2); // their own series, their teammates' and their team's: never the whole company's
    expect(JSON.stringify(ov)).not.toContain("Annual recurring revenue"); // the organization total is not theirs
    // a real KPI given to a demo team stops the removal
    const demoTeam = (await get(t.app, "/api/organization/structure", owner)).body.data.teams.find((x: { isDemo?: boolean }) => x.isDemo).id as string;
    expect((await post(t.app, `/api/kpis/${real}/assignments`, { teamId: demoTeam }, owner)).status).toBe(201);
    const blocked = await post(t.app, "/api/demo/remove", undefined, owner);
    expect(code(blocked)).toBe("demo_blocked");
    expect((blocked.body.error.details.blockers as { kind: string }[]).map((b) => b.kind)).toContain("kpi_assignments");
    const aid = (await get(t.app, `/api/kpis/${real}`, owner)).body.data.assignments[0].id as string;
    await request(t.app).delete(`/api/kpis/${real}/assignments/${aid}`).set("Origin", ORIGIN).set("Cookie", owner);
    expect((await post(t.app, "/api/demo/remove", undefined, owner)).status).toBe(200);
    for (const table of ["kpi_measurements", "kpi_thresholds"]) expect(one<{ n: number }>(`SELECT COUNT(*) n FROM ${table}`).n, table).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM kpis").n).toBe(1); // only the real one
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM kpi_assignments").n).toBe(0); // the real assignment to the (now gone) demo team was ended and went with it
    expect(Object.values(demoRows()).every((n) => n === 0)).toBe(true);
  });
});

describe("Archived people and demo data (bug fix)", () => {
  /** A real person who holds a demo designation (the owner reported this) with a demo manager. */
  async function realPersonWithDemoDesignation(owner: string) {
    await post(t.app, "/api/demo/load", undefined, owner);
    const demoDesignation = ((await get(t.app, "/api/organization/structure", owner)).body.data.designations as { id: string; name: string; isDemo?: boolean }[]).find((d) => d.isDemo && d.name === "Account Executive")!;
    const demoManager = (await personas(owner)).find((p) => p.designation === "Sales Manager")!;
    const id = await created("/api/employees", { name: "Testing", designationId: demoDesignation.id, managerId: demoManager.id }, owner);
    return { id, demoDesignation, demoManager };
  }

  it("archiving a person ends their open designation, team and department placements and reporting lines on that day; the history keeps them", async () => {
    const { owner } = await setup();
    const { id } = await realPersonWithDemoDesignation(owner);
    expect((await post(t.app, `/api/employees/${id}/archive`, undefined, owner)).status).toBe(200);
    const today = new Date().toISOString().slice(0, 10);
    const h = (await get(t.app, `/api/employees/${id}/history`, owner)).body.data as { designations: { label: string; startDate: string; endDate: string | null }[]; managers: { endDate: string | null }[] };
    expect(h.designations).toEqual([expect.objectContaining({ label: "Account Executive", startDate: today, endDate: today })]); // ended, not still "now"
    expect(h.managers.every((m) => m.endDate !== null)).toBe(true);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM designation_assignments WHERE membership_id = ? AND end_date IS NULL", id).n).toBe(0);
    expect(one<{ designation_id: string | null }>("SELECT designation_id FROM organization_memberships WHERE id = ?", id).designation_id).toBeNull(); // nothing says they still hold it
  });

  it("an archived real person who held a demo designation no longer stops Remove demo data (their history of it goes with the designation)", async () => {
    const { owner } = await setup();
    const { id } = await realPersonWithDemoDesignation(owner);
    const line = (await get(t.app, `/api/employees/${id}/history`, owner)).body.data.managers[0] as { id: string };
    expect((await request(t.app).patch(`/api/hierarchy/reporting/${line.id}`).set("Origin", ORIGIN).set("Cookie", owner).send({})).status).toBe(200); // the owner ends the line first, as in the report
    expect((await post(t.app, `/api/employees/${id}/archive`, undefined, owner)).status).toBe(200);
    const removed = await post(t.app, "/api/demo/remove", undefined, owner);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(Object.values(demoRows()).every((n) => n === 0)).toBe(true);
    expect(one<{ display_name: string; archived_at: string | null; designation_id: string | null }>("SELECT display_name, archived_at, designation_id FROM organization_memberships WHERE id = ?", id)).toMatchObject({ display_name: "Testing", designation_id: null }); // the real person is still there
  });

  it("an archived person archived BEFORE this fix (their designation still open) does not stop the removal either", async () => {
    const { owner } = await setup();
    const { id } = await realPersonWithDemoDesignation(owner);
    await post(t.app, `/api/employees/${id}/archive`, undefined, owner);
    // put the old shape back: archived, designation still open and cached
    const row = one<{ designation_id: string }>("SELECT designation_id FROM designation_assignments WHERE membership_id = ?", id);
    t.db.prepare("UPDATE designation_assignments SET end_date = NULL WHERE membership_id = ?").run(id);
    t.db.prepare("UPDATE organization_memberships SET designation_id = ? WHERE id = ?").run(row.designation_id, id);
    const removed = await post(t.app, "/api/demo/remove", undefined, owner);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM designations WHERE is_demo = 1").n).toBe(0);
  });

  it("a person who is NOT archived and holds a demo designation still stops the removal, and the message names them", async () => {
    const { owner } = await setup();
    const { id } = await realPersonWithDemoDesignation(owner);
    await post(t.app, "/api/employees", { name: "Second Person", designationId: (await get(t.app, `/api/employees/${id}`, owner)).body.data.designation.id }, owner);
    const blocked = await post(t.app, "/api/demo/remove", undefined, owner);
    expect(code(blocked)).toBe("demo_blocked");
    const b = (blocked.body.error.details.blockers as { kind: string; count: number; message: string }[]).find((x) => x.kind === "designations")!;
    expect(b.count).toBe(2);
    expect(b.message).toBe("2 of your real people hold demo designations: Second Person, Testing. Give them another designation first.");
    // one person: singular
    await post(t.app, `/api/employees/${(await get(t.app, "/api/employees?search=Second", owner)).body.data.people[0].id}/archive`, undefined, owner);
    const again = await post(t.app, "/api/demo/remove", undefined, owner);
    expect((again.body.error.details.blockers as { kind: string; message: string }[]).find((x) => x.kind === "designations")!.message).toBe("1 of your real people holds a demo designation: Testing. Give them another designation first.");
  });
});

describe("Demo scores (stage 5.2)", () => {
  it("the demo company arrives with two periods and a scorecard for every demo person, all flagged as demo, with real explanations", async () => {
    const { owner } = await setup();
    const load = await post(t.app, "/api/demo/load", undefined, owner);
    expect(load.status, JSON.stringify(load.body)).toBe(201);
    const periods = (await get(t.app, "/api/performance/periods", owner)).body.data as { id: string; isDemo: boolean; status: string; scorecards: number }[];
    expect(periods.filter((p) => p.isDemo)).toHaveLength(2);
    expect(periods.filter((p) => p.isDemo).map((p) => p.status).sort()).toEqual(["closed", "open"]); // last quarter is closed, this one is open
    const cur = periods.find((p) => p.isDemo && p.scorecards > 0)!;
    const cards = (await get(t.app, `/api/performance/scorecards?periodId=${cur.id}`, owner)).body.data as { isDemo: boolean; total: number | null; status: string }[];
    expect(cards.length).toBeGreaterThanOrEqual(50);
    expect(cards.every((c) => c.isDemo)).toBe(true);
    expect(cards.filter((c) => c.total !== null).length).toBeGreaterThan(20); // most have data
    expect(new Set(cards.map((c) => c.status)).size).toBeGreaterThan(1); // and the data gaps show as provisional or insufficient, not as zeros
    expect(cards.some((c) => c.status === "insufficient" && c.total === null)).toBe(true);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM performance_scores s WHERE NOT EXISTS (SELECT 1 FROM performance_score_components c WHERE c.score_id = s.id)").n).toBe(0);
  });

  it("view as a demo employee: their own scorecard opens with its components; a teammate's does not", async () => {
    const { owner } = await setup();
    await post(t.app, "/api/demo/load", undefined, owner);
    const ps = await personas(owner);
    const seller = ps.find((p) => p.designation === "Account Executive")!;
    const other = ps.find((p) => p.designation === "Account Executive" && p.id !== seller.id)!;
    const as = await asCookie(owner, seller.id);
    const periods = (await get(t.app, "/api/performance/periods", as)).body.data as { id: string; isDemo: boolean; scorecards: number }[];
    const cur = periods.find((p) => p.scorecards > 0)!;
    const mine = await get(t.app, `/api/performance/scorecards/for?periodId=${cur.id}`, as);
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(mine.body.data.latest.components.length).toBeGreaterThan(0);
    expect((await get(t.app, `/api/performance/scorecards/for?periodId=${cur.id}&subjectId=${other.id}`, as)).status).toBe(404);
  });

  it("compare the demo's Engineering people: the administrator sees names and ranks; a demo engineer sees only their own position; a manager sees their team", async () => {
    const { owner } = await setup();
    await post(t.app, "/api/demo/load", undefined, owner);
    const fam = ((await get(t.app, "/api/organization/structure", owner)).body.data.roleFamilies as { id: string; name: string }[]).find((f) => f.name === "Engineering")!;
    const periods = (await get(t.app, "/api/performance/periods", owner)).body.data as { id: string; status: string }[];
    const cur = periods.find((p) => p.status === "open")!;
    const all = (await get(t.app, `/api/performance/compare?periodId=${cur.id}&roleFamilyId=${fam.id}&minTenureDays=0`, owner)).body.data;
    expect(all.cohortSize).toBeGreaterThanOrEqual(8);
    expect(all.normalization).toBe("percentile_z");
    expect(all.entries.length).toBe(all.cohortSize);
    expect(all.entries[0].rank).toBe(1);
    const ps = await personas(owner);
    const engineer = ps.find((p) => p.designation === "Software Engineer" && all.entries.some((e: { subject: { id: string } }) => e.subject.id === p.id))!;
    const as = await asCookie(owner, engineer.id);
    const mine = (await get(t.app, `/api/performance/compare?periodId=${cur.id}&minTenureDays=0`, as)).body.data;
    expect(mine.canSeeNames).toBe(false);
    expect(mine.entries).toHaveLength(1);
    expect(mine.you.of).toBe(all.cohortSize);
    // a department head compares inside their own department only
    const vp = (dept: string) => ps.find((p) => p.department === dept && p.designation === "Vice President")!;
    const own = (await get(t.app, `/api/performance/compare?periodId=${cur.id}&roleFamilyId=${fam.id}&minTenureDays=0`, await asCookie(owner, vp("Engineering").id))).body.data;
    expect(own.entries.length).toBeGreaterThan(5);
    expect(own.cohortSize).toBe(all.cohortSize); // they are ranked among everyone...
    const other = (await get(t.app, `/api/performance/compare?periodId=${cur.id}&roleFamilyId=${fam.id}&minTenureDays=0`, await asCookie(owner, vp("Sales").id))).body.data;
    expect(other.entries).toHaveLength(0); // ...but another department's head sees no engineer's name or score
    expect(other.hiddenCount).toBe(all.cohortSize);
  });

  // The cause of the old flake (it was neither timing nor test order). Two things made "one mentor logs far less than the other" unreliable:
  // 1. the demo company is generated from a random stream seeded with the ORGANIZATION'S ID, which is a new random id in every test, and each mentoring
  //    session was logged by a coin toss (18% for the sparse mentor, 88% for the others). So the gap between the two mentors' activity scores differed
  //    from run to run (19 and 11 points were seen, against a bar of 20). The seed now logs a fixed pattern (one in five, and all but one in eight).
  // 2. the sessions are seeded a fixed number of days before TODAY, but scores belong to a calendar quarter, so on some days of a quarter the
  //    figures move (early in a quarter there is no activity score at all). The test fixes the clock in the middle of a quarter, and the second test
  //    below checks that on any day the numbers are honest.
  it("the demo has mentors with mentees, activities and a measured effect; a real assignment involving a demo person stops the removal; removal takes the rest", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-24T10:00:00Z") });
    const { owner } = await setup();
    const load = await post(t.app, "/api/demo/load", undefined, owner);
    expect(load.body.data.counts.mentorships).toBeGreaterThanOrEqual(5);
    const periods = (await get(t.app, "/api/performance/periods", owner)).body.data as { id: string; status: string }[];
    const cur = periods.find((p) => p.status === "open")!;
    const e = (await get(t.app, `/api/mentorship/effectiveness?periodId=${cur.id}`, owner)).body.data;
    expect(e.mentors.length).toBeGreaterThanOrEqual(2);
    expect(e.mentors.every((m: { development: { state: string; value: number } }) => m.development.state === "ok")).toBe(true);
    const acts = e.mentors.map((m: { activity: { value: number } }) => m.activity.value) as number[];
    expect(Math.max(...acts) - Math.min(...acts)).toBeGreaterThan(20); // one mentor logs far less than the other
    expect(e.mentors.some((m: { mentees: { mentorCount: number }[] }) => m.mentees.some((x) => x.mentorCount > 1))).toBe(true); // a shared mentee
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM scoring_models WHERE is_demo = 1 AND template_key = 'model_mentor'").n).toBe(1);
    // a real assignment that involves a demo person
    const real = await created("/api/employees", { name: "Real Mentor" }, owner);
    const demoMentee = (await get(t.app, "/api/mentorship/assignments", owner)).body.data[0].mentee.id as string;
    expect((await post(t.app, "/api/mentorship/assignments", { mentorId: real, menteeId: demoMentee }, owner)).status).toBe(201);
    const blocked = await post(t.app, "/api/demo/remove", undefined, owner);
    expect(code(blocked)).toBe("demo_blocked");
    expect((blocked.body.error.details.blockers as { kind: string; message: string }[]).find((b) => b.kind === "mentorship")!.message).toMatch(/1 of your own mentorship assignment involves a demo person/);
    const row = one<{ id: string }>("SELECT id FROM mentorship_assignments WHERE is_demo = 0");
    expect((await request(t.app).patch(`/api/mentorship/assignments/${row.id}`).set("Origin", ORIGIN).set("Cookie", owner).send({ status: "ended", endDate: new Date().toISOString().slice(0, 10) })).status).toBe(400); // ended on the day it started is refused: it must end after it started
    t.db.prepare("UPDATE mentorship_assignments SET status = 'ended', end_date = date('now') WHERE id = ?").run(row.id);
    const removed = await post(t.app, "/api/demo/remove", undefined, owner);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    for (const table of ["mentorship_activities", "mentorship_progress"]) expect(one<{ n: number }>(`SELECT COUNT(*) n FROM ${table}`).n, table).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM mentorship_assignments WHERE is_demo = 1").n).toBe(0);
    expect(Object.values(demoRows()).every((n) => n === 0)).toBe(true);
  });

  it("the demo's leaders have their own models: the CEO has no task component; a department head's contribution and a manager's review duty are scored; a reviewed employee never sees the private note", async () => {
    const { owner } = await setup();
    await post(t.app, "/api/demo/load", undefined, owner);
    const periods = (await get(t.app, "/api/performance/periods", owner)).body.data as { id: string; status: string }[];
    const open = periods.find((p) => p.status === "open")!;
    const closed = periods.find((p) => p.status === "closed")!;
    const ps = await personas(owner);
    const cardOf = async (person: { id: string }, periodId: string) => (await get(t.app, `/api/performance/scorecards/for?periodId=${periodId}&subjectId=${person.id}`, owner)).body.data.latest;
    const ceo = ps.find((p) => p.designation === "Chief Executive Officer")!;
    const ceoCard = await cardOf(ceo, open.id);
    expect(ceoCard.modelName).toMatch(/^CEO/);
    expect(ceoCard.components.map((c: { providerKey: string }) => c.providerKey)).not.toContain("tasks.delivery");
    expect(ceoCard.components.find((c: { key: string }) => c.key === "company_okr").state).toBe("ok");
    const vp = ps.find((p) => p.designation === "Vice President" && p.department === "Engineering")!;
    const vpCard = await cardOf(vp, open.id);
    expect(vpCard.modelName).toMatch(/^Department head/);
    const contribution = vpCard.components.find((c: { key: string }) => c.key === "contribution");
    expect(contribution.state).toBe("ok");
    expect(contribution.contributors[0].label).toMatch(/ → /); // the chain: department objective → company objective
    // the managers' review duty for last quarter: scored from the reviews they wrote, on time or late
    const duties = t.db.prepare("SELECT c.data_state AS state, c.normalized_score AS score FROM performance_score_components c JOIN performance_scores s ON s.id = c.score_id JOIN performance_scorecards k ON k.latest_score_id = s.id WHERE c.provider_key = 'mgmt.responsibilities' AND k.period_id = ?").all(closed.id) as { state: string; score: number | null }[];
    expect(duties.length).toBeGreaterThan(0);
    expect(duties.some((d) => d.state === "ok" && d.score !== null && d.score > 0)).toBe(true);
    expect(duties.every((d) => d.state !== "ok" || (d.score !== null && d.score >= 0 && d.score <= 100))).toBe(true);
    // a reviewed demo employee reads the shared part and never the private note
    const subject = t.db.prepare("SELECT subject_membership_id AS id FROM performance_reviews WHERE is_demo = 1 AND status <> 'draft' LIMIT 1").get() as { id: string };
    const as = await asCookie(owner, subject.id);
    const mine = (await get(t.app, `/api/performance/reviews?periodId=${closed.id}&subjectId=${subject.id}`, as)).body.data as { sharedSummary: string }[]; // about them (a manager also sees the reviews they wrote, with their own private notes)
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => !("privateNotes" in r) && r.sharedSummary.length > 0)).toBe(true);
    expect(JSON.stringify(mine)).not.toMatch(/Not for sharing|Candid note|stretch assignment|Strong candidate|visibly stretched/);
    // removal takes the reviews too
    expect((await post(t.app, "/api/demo/remove", undefined, owner)).status).toBe(200);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM performance_reviews").n).toBe(0);
  });

  it("removal takes every demo period, scorecard, run and component, even a real person's scorecard inside a demo period, and works with an archived real person", async () => {
    const { owner } = await setup();
    await post(t.app, "/api/demo/load", undefined, owner);
    const demoDesignation = ((await get(t.app, "/api/organization/structure", owner)).body.data.designations as { id: string; name: string; isDemo?: boolean }[]).find((d) => d.isDemo && d.name === "Account Executive")!;
    const manager = (await personas(owner)).find((p) => p.designation === "Sales Manager")!;
    const id = await created("/api/employees", { name: "Testing", designationId: demoDesignation.id, managerId: manager.id }, owner);
    const periods = (await get(t.app, "/api/performance/periods", owner)).body.data as { id: string; isDemo: boolean }[];
    expect((await post(t.app, "/api/performance/scorecards/recalculate", { periodId: periods.find((p) => p.isDemo)!.id, subjectId: id }, owner)).status).toBe(200);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM performance_scorecards WHERE subject_membership_id = ?", id).n).toBe(1);
    const line = (await get(t.app, `/api/employees/${id}/history`, owner)).body.data.managers[0] as { id: string };
    expect((await request(t.app).patch(`/api/hierarchy/reporting/${line.id}`).set("Origin", ORIGIN).set("Cookie", owner).send({})).status).toBe(200);
    expect((await post(t.app, `/api/employees/${id}/archive`, undefined, owner)).status).toBe(200);
    const removed = await post(t.app, "/api/demo/remove", undefined, owner);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    for (const table of ["performance_periods", "performance_scorecards", "performance_scores", "performance_score_components"]) expect(one<{ n: number }>(`SELECT COUNT(*) n FROM ${table}`).n, table).toBe(0);
    expect(Object.values(demoRows()).every((n) => n === 0)).toBe(true);
    expect(one<{ archived_at: string | null }>("SELECT archived_at FROM organization_memberships WHERE id = ?", id).archived_at).not.toBeNull(); // the real person stays
  });

  it("whatever day the demo is loaded (every week of two quarters), mentoring activity is a real score between 0 and 100 or 'no data', never NaN or an invented zero", async () => {
    for (const d of ["2026-10-01", "2026-10-15", "2026-11-01", "2026-12-01", "2027-01-05", "2027-02-10", "2027-03-30"]) {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date(`${d}T10:00:00Z`) });
      const { owner } = await setup();
      expect((await post(t.app, "/api/demo/load", undefined, owner)).status, d).toBe(201);
      const periods = (await get(t.app, "/api/performance/periods", owner)).body.data as { id: string; status: string }[];
      const cur = periods.find((p) => p.status === "open");
      if (!cur) continue;
      const e = (await get(t.app, `/api/mentorship/effectiveness?periodId=${cur.id}`, owner)).body.data;
      for (const m of e.mentors as { activity: { value: number | null; state: string } }[]) {
        if (m.activity.value === null) expect(m.activity.state, d).not.toBe("ok");
        else {
          expect(Number.isFinite(m.activity.value), d).toBe(true);
          expect(m.activity.value, d).toBeGreaterThan(0);
          expect(m.activity.value, d).toBeLessThanOrEqual(100);
        }
      }
      t.cleanup();
      vi.useRealTimers();
    }
  }, 120_000);
});
