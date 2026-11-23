import { afterEach, describe, expect, it } from "vitest";
import type { TestApp } from "./helpers/app.js";
import { get, makeAuthApp, post, send, signUpWithOrg } from "./helpers/auth.js";
import { addPerson, roleIds } from "./helpers/roles.js";

let t: TestApp;
afterEach(() => t?.cleanup());

const code = (r: { body: { error?: { code?: string } } }) => r.body.error?.code;
const created = async (path: string, body: Record<string, unknown>, cookie: string): Promise<string> => {
  const r = await post(t.app, path, body, cookie);
  expect(r.status, `${path} ${JSON.stringify(r.body)}`).toBe(201);
  return r.body.data.id as string;
};
const audit = async (cookie: string) => (await get(t.app, "/api/audit-logs?limit=100", cookie)).body.data as { action: string; summary: string }[];
const dayOffset = (n: number): string => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const today = dayOffset(0);

type P = { id: string; displayName: string; managers: { id: string; name: string; type: string }[]; teams: { id: string; name: string; type: string }[]; departments: { id: string; name: string; type: string }[]; designation: { name: string } | null; email: string | null; status: string; hasLogin: boolean };
const list = async (cookie: string, q = "") => (await get(t.app, `/api/employees${q}`, cookie)).body.data as { people: P[]; total: number };
const names = (xs: { displayName: string }[]) => xs.map((x) => x.displayName).sort();

async function setup() {
  t = makeAuthApp();
  const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
  const ids = await roleIds(t.app, owner);
  const eng = await created("/api/departments", { name: "Engineering" }, owner);
  const sales = await created("/api/departments", { name: "Sales" }, owner);
  const core = await created("/api/teams", { name: "Core", departmentId: eng }, owner);
  const infra = await created("/api/teams", { name: "Infra", departmentId: eng, parentTeamId: core }, owner);
  const inside = await created("/api/teams", { name: "Inside sales", departmentId: sales }, owner);
  const fam = await created("/api/role-families", { name: "Engineering roles" }, owner);
  const dev = await created("/api/designations", { name: "Developer", roleFamilyId: fam }, owner);
  const lead = await created("/api/designations", { name: "Tech Lead", roleFamilyId: fam }, owner);
  return { owner, ids, eng, sales, core, infra, inside, fam, dev, lead };
}
const add = async (cookie: string, name: string, extra: Record<string, unknown> = {}) => created("/api/employees", { name, ...extra }, cookie);

describe("adding people", () => {
  it("adds people with no login, with an optional designation, team (and so department) and manager; each is audited", async () => {
    const s = await setup();
    const ann = await add(s.owner, "Ann Boss", { designationId: s.lead, departmentId: s.eng });
    const bo = await add(s.owner, "Bo Dev", { designationId: s.dev, teamId: s.core, managerId: ann, employeeCode: "E-2", employmentType: "full_time", startDate: "2024-01-15", workEmail: "bo@acme.test" });
    const people = (await list(s.owner)).people;
    expect(names(people)).toEqual(["Ann Boss", "Bo Dev", "Test Person"]); // the owner is in the directory too
    const bob = people.find((p) => p.id === bo)!;
    expect(bob).toMatchObject({ hasLogin: false, status: "active", designation: { name: "Developer" }, managers: [{ id: ann, name: "Ann Boss", type: "primary" }], teams: [{ name: "Core", type: "member" }], departments: [{ name: "Engineering", type: "member" }], email: "bo@acme.test" });
    expect((await audit(s.owner)).filter((e) => e.action === "person.create").map((e) => e.summary)).toEqual([
      "Added Bo Dev to the organization as Developer, reporting to Ann Boss",
      "Added Ann Boss to the organization as Tech Lead",
    ]);
    // checks
    expect(code(await post(t.app, "/api/employees", { name: "  " }, s.owner))).toBe("invalid_name");
    expect(code(await post(t.app, "/api/employees", { name: "X", workEmail: "nope" }, s.owner))).toBe("invalid_email");
    expect(code(await post(t.app, "/api/employees", { name: "X", employeeCode: "E-2" }, s.owner))).toBe("employee_code_taken");
    expect(code(await post(t.app, "/api/employees", { name: "X", startDate: "2024-13-40" }, s.owner))).toBe("invalid_date");
    expect(code(await post(t.app, "/api/employees", { name: "X", employmentType: "slave" }, s.owner))).toBe("validation_failed");
    expect(code(await post(t.app, "/api/employees", { name: "X", teamId: s.core, departmentId: s.sales }, s.owner))).toBe("wrong_department");
    expect((await post(t.app, "/api/employees", { name: "X", managerId: "11111111-1111-4111-8111-111111111111" }, s.owner)).status).toBe(404);
    const noExtra = await post(t.app, "/api/employees", { name: "X", organization_id: "o" }, s.owner);
    expect(noExtra.status).toBe(400); // strict: an organization id can never be supplied
  });

  it("the directory excludes archived people unless asked, filters and searches, and pages", async () => {
    const s = await setup();
    for (let i = 1; i <= 5; i++) await add(s.owner, `Person ${i}`, { teamId: i % 2 ? s.core : s.inside, designationId: i % 2 ? s.dev : s.lead });
    expect((await list(s.owner, "?teamId=" + s.core)).total).toBe(3);
    expect((await list(s.owner, "?designationId=" + s.lead)).total).toBe(2);
    expect((await list(s.owner, "?departmentId=" + s.sales)).total).toBe(2);
    expect((await list(s.owner, "?search=person%203")).total).toBe(1);
    expect((await list(s.owner, "?search=tech")).total).toBe(2); // by designation
    const page = (await list(s.owner, "?limit=2&offset=2")).people;
    expect(page).toHaveLength(2);
    expect((await get(t.app, "/api/employees?limit=9999", s.owner)).status).toBe(400);
  });
});

describe("reporting lines", () => {
  it("a person can have several managers; a new primary ends the old one on that day and the history keeps both", async () => {
    const s = await setup();
    const a = await add(s.owner, "Ann");
    const b = await add(s.owner, "Bea");
    const c = await add(s.owner, "Cy", { managerId: a });
    const second = await post(t.app, "/api/hierarchy/reporting", { subordinateId: c, managerId: b, type: "secondary" }, s.owner);
    expect(second.status).toBe(201);
    expect((await list(s.owner)).people.find((p) => p.id === c)!.managers.map((m) => `${m.name}:${m.type}`).sort()).toEqual(["Ann:primary", "Bea:secondary"]);
    expect(code(await post(t.app, "/api/hierarchy/reporting", { subordinateId: c, managerId: b, type: "secondary" }, s.owner))).toBe("already_reporting");

    const switched = await post(t.app, "/api/hierarchy/reporting", { subordinateId: c, managerId: b, type: "primary", startDate: dayOffset(1), reason: "Reorganised" }, s.owner);
    expect(switched.status).toBe(201);
    expect(switched.body.data.endedPrimary).toBe("Ann");
    const lines = (await get(t.app, `/api/hierarchy/reporting?membershipId=${c}`, s.owner)).body.data.asSubordinate as { manager: { name: string }; type: string; startDate: string; endDate: string | null }[];
    expect(lines.filter((l) => l.type === "primary").map((l) => [l.manager.name, l.startDate === today, l.endDate])).toEqual([["Ann", true, dayOffset(1)], ["Bea", false, null]]);
    // as of today Ann is still the primary manager (the change takes effect tomorrow)
    expect((await list(s.owner)).people.find((p) => p.id === c)!.managers.filter((m) => m.type === "primary").map((m) => m.name)).toEqual(["Ann"]);
    const hist = (await get(t.app, `/api/employees/${c}/history`, s.owner)).body.data;
    expect(hist.managers.map((m: { label: string }) => m.label).sort()).toEqual(["Ann", "Bea", "Bea"]);
    expect((await audit(s.owner)).find((e) => e.action === "reporting.add" && /no longer the primary/.test(e.summary))).toBeTruthy();
    expect(code(await post(t.app, "/api/hierarchy/reporting", { subordinateId: c, managerId: c }, s.owner))).toBe("self_report");
  });

  it("refuses a loop (also through several people) and lets a line be ended but never deleted", async () => {
    const s = await setup();
    const a = await add(s.owner, "Ann");
    const b = await add(s.owner, "Bea", { managerId: a });
    const c = await add(s.owner, "Cy", { managerId: b });
    const loop = await post(t.app, "/api/hierarchy/reporting", { subordinateId: a, managerId: c, type: "secondary" }, s.owner);
    expect(loop.status).toBe(409);
    expect(code(loop)).toBe("would_create_cycle");
    // a dotted line is display only and may point up the tree
    expect((await post(t.app, "/api/hierarchy/reporting", { subordinateId: a, managerId: c, type: "dotted" }, s.owner)).status).toBe(201);
    const row = t.db.prepare("SELECT id FROM reporting_relationships WHERE subordinate_membership_id = ? AND relationship_type = 'primary'").get(c) as { id: string };
    const ended = await send(t.app, "patch", `/api/hierarchy/reporting/${row.id}`, { reason: "Left the project" }, s.owner);
    expect(ended.status).toBe(200);
    expect(code(await send(t.app, "patch", `/api/hierarchy/reporting/${row.id}`, {}, s.owner))).toBe("already_ended");
    expect(t.db.prepare("SELECT end_date, reason FROM reporting_relationships WHERE id = ?").get(row.id)).toEqual({ end_date: today, reason: "Left the project" });
    expect((await list(s.owner)).people.find((p) => p.id === c)!.managers).toEqual([]);
    expect(t.db.prepare("SELECT COUNT(*) n FROM reporting_relationships").get()).toEqual({ n: 3 }); // nothing deleted
  });
});

describe("teams, departments and moving", () => {
  it("heads and leads: a new lead replaces the old one, who stays on as a member from that day", async () => {
    const s = await setup();
    const a = await add(s.owner, "Ann", { teamId: s.core });
    const b = await add(s.owner, "Bea", { teamId: s.core });
    const rowA = (t.db.prepare("SELECT id FROM team_memberships WHERE membership_id = ?").get(a) as { id: string }).id;
    expect((await send(t.app, "patch", `/api/teams/${s.core}/members/${rowA}`, { type: "lead" }, s.owner)).status).toBe(200);
    const rowB = (t.db.prepare("SELECT id FROM team_memberships WHERE membership_id = ?").get(b) as { id: string }).id;
    expect((await send(t.app, "patch", `/api/teams/${s.core}/members/${rowB}`, { type: "lead" }, s.owner)).status).toBe(200);
    const open = t.db.prepare("SELECT m.display_name n, tm.membership_type t FROM team_memberships tm JOIN organization_memberships m ON m.id = tm.membership_id WHERE tm.team_id = ? AND tm.end_date IS NULL ORDER BY m.display_name").all(s.core);
    expect(open).toEqual([{ n: "Ann", t: "member" }, { n: "Bea", t: "lead" }]);
    expect(t.db.prepare("SELECT COUNT(*) n FROM team_memberships WHERE team_id = ?").get(s.core)).toEqual({ n: 5 }); // history rows kept
    const hist = (await get(t.app, `/api/employees/${a}/history`, s.owner)).body.data.teams as { detail: string; endDate: string | null }[];
    expect(hist.map((h) => `${h.detail}:${h.endDate ? "ended" : "open"}`).sort()).toEqual(["lead:ended", "member:ended", "member:open"]);

    const head = await post(t.app, `/api/departments/${s.eng}/members`, { membershipId: a, type: "head" }, s.owner);
    expect(head.status, JSON.stringify(head.body)).toBe(409); // already in the department through the team
    const row = (t.db.prepare("SELECT id FROM department_memberships WHERE membership_id = ?").get(a) as { id: string }).id;
    expect((await send(t.app, "patch", `/api/departments/${s.eng}/members/${row}`, { type: "head" }, s.owner)).status).toBe(200);
    const tree = (await get(t.app, "/api/hierarchy/tree?view=organization&depth=3", s.owner)).body.data.nodes as { name: string; subtitle: string | null }[];
    expect(tree.find((n) => n.name === "Engineering")!.subtitle).toBe("Head: Ann");
  });

  it("move: ends the old team and department rows on the day and starts the new ones, atomically; a no-op is refused", async () => {
    const s = await setup();
    const a = await add(s.owner, "Ann", { teamId: s.core });
    const day = dayOffset(10);
    const mv = await post(t.app, "/api/hierarchy/move", { membershipId: a, toTeamId: s.inside, effectiveDate: day, reason: "Joined sales" }, s.owner);
    expect(mv.status, JSON.stringify(mv.body)).toBe(200);
    // not yet: today she is still in Core / Engineering
    let p = (await list(s.owner)).people.find((x) => x.id === a)!;
    expect(p.teams.map((x) => x.name)).toEqual(["Core"]);
    expect(p.departments.map((x) => x.name)).toEqual(["Engineering"]);
    const rows = t.db.prepare("SELECT t.name n, tm.start_date s, tm.end_date e FROM team_memberships tm JOIN teams t ON t.id = tm.team_id WHERE tm.membership_id = ? ORDER BY tm.start_date, t.name").all(a);
    expect(rows).toEqual([{ n: "Core", s: today, e: day }, { n: "Inside sales", s: day, e: null }]);
    expect(code(await post(t.app, "/api/hierarchy/move", { membershipId: a, toTeamId: s.inside, effectiveDate: day }, s.owner))).toBe("no_change");
    expect(code(await post(t.app, "/api/hierarchy/move", { membershipId: a }, s.owner))).toBe("validation_failed");
    const back = await post(t.app, "/api/hierarchy/move", { membershipId: a, toDepartmentId: s.sales, effectiveDate: dayOffset(20) }, s.owner); // a department only: leaves every team
    expect(back.status).toBe(200);
    expect((await audit(s.owner)).filter((e) => e.action === "person.move")).toHaveLength(2);
    const profile = (await get(t.app, `/api/employees/${a}`, s.owner)).body.data as { teamRows: { team: { name: string } }[] };
    expect(profile.teamRows.map((x) => x.team.name).sort()).toEqual(["Core", "Inside sales"]); // the profile lists the current and the scheduled rows
  });

  it("a past move is recorded with the old row ended on the earlier day, and as of today the person is already there", async () => {
    const s = await setup();
    const a = await add(s.owner, "Ann", { teamId: s.core, startDate: "2020-01-01" });
    t.db.prepare("UPDATE team_memberships SET start_date = '2020-01-01'").run();
    t.db.prepare("UPDATE department_memberships SET start_date = '2020-01-01'").run();
    await post(t.app, "/api/hierarchy/move", { membershipId: a, toTeamId: s.inside, effectiveDate: "2021-06-01" }, s.owner);
    const p = (await list(s.owner)).people.find((x) => x.id === a)!;
    expect(p.teams.map((x) => x.name)).toEqual(["Inside sales"]);
    expect(p.departments.map((x) => x.name)).toEqual(["Sales"]);
    const hist = (await get(t.app, `/api/employees/${a}/history`, s.owner)).body.data.teams as { label: string; startDate: string; endDate: string | null }[];
    expect(hist.map((h) => [h.label, h.startDate, h.endDate])).toEqual([["Inside sales", "2021-06-01", null], ["Core", "2020-01-01", "2021-06-01"]]);
  });

  it("a team or department with people in it cannot be archived until they move", async () => {
    const s = await setup();
    const a = await add(s.owner, "Ann", { teamId: s.inside });
    const loose = await add(s.owner, "Loose", { departmentId: s.sales });
    const refused = await post(t.app, `/api/teams/${s.inside}/archive`, undefined, s.owner);
    expect(refused.status).toBe(409);
    expect(code(refused)).toBe("has_active_members");
    expect(code(await post(t.app, `/api/departments/${s.sales}/archive`, undefined, s.owner))).toBe("has_active_children"); // the team comes first
    await post(t.app, "/api/hierarchy/move", { membershipId: a, toTeamId: s.core }, s.owner);
    expect((await post(t.app, `/api/teams/${s.inside}/archive`, undefined, s.owner)).status).toBe(200);
    expect(code(await post(t.app, `/api/departments/${s.sales}/archive`, undefined, s.owner))).toBe("has_active_members"); // Loose is still in Sales
    await post(t.app, "/api/hierarchy/move", { membershipId: loose, toTeamId: s.core }, s.owner);
    expect((await post(t.app, `/api/departments/${s.sales}/archive`, undefined, s.owner)).status).toBe(200);
  });
});

describe("designations over time and archiving people", () => {
  it("a new designation ends the old one on its start day; the history lists both; today or earlier only", async () => {
    const s = await setup();
    const a = await add(s.owner, "Ann", { designationId: s.dev });
    const r = await post(t.app, `/api/employees/${a}/designation`, { designationId: s.lead, startDate: today, reason: "Promoted" }, s.owner);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(code(await post(t.app, `/api/employees/${a}/designation`, { designationId: s.lead }, s.owner))).toBe("no_change");
    expect(code(await post(t.app, `/api/employees/${a}/designation`, { designationId: s.dev, startDate: dayOffset(2) }, s.owner))).toBe("future_date");
    expect(code(await post(t.app, `/api/employees/${a}/designation`, { designationId: s.dev, startDate: "2001-01-01" }, s.owner))).toBe("before_current_start");
    const h = (await get(t.app, `/api/employees/${a}/history`, s.owner)).body.data.designations as { label: string; detail: string | null; endDate: string | null }[];
    expect(h.map((x) => [x.label, x.endDate === null])).toEqual([["Tech Lead", true], ["Developer", false]]);
    expect(h[0]!.detail).toBe("Promoted");
    const p = (await get(t.app, `/api/employees/${a}`, s.owner)).body.data;
    expect(p.designation.name).toBe("Tech Lead");
    expect(p.roleFamily.name).toBe("Engineering roles");
    expect((await audit(s.owner))[0]!.summary).toBe(`Changed the designation of Ann from Developer to Tech Lead, from ${today}`);
  });

  it("archive: only people without a login, refused while people report to them, placements end, restore brings them back; the audit says how many ended", async () => {
    const s = await setup();
    const boss = await add(s.owner, "Boss", { teamId: s.core });
    const rep = await add(s.owner, "Rep", { managerId: boss });
    expect(code(await post(t.app, `/api/employees/${boss}/archive`, undefined, s.owner))).toBe("has_reports");
    await post(t.app, "/api/hierarchy/reporting", { subordinateId: rep, managerId: (await add(s.owner, "Other boss")) }, s.owner);
    expect((await post(t.app, `/api/employees/${boss}/archive`, undefined, s.owner)).status).toBe(200);
    expect((await list(s.owner)).people.map((p) => p.displayName)).not.toContain("Boss");
    expect((await list(s.owner, "?includeArchived=true")).people.map((p) => p.displayName)).toContain("Boss");
    expect(t.db.prepare("SELECT COUNT(*) n FROM team_memberships WHERE membership_id = ? AND end_date IS NULL").get(boss)).toEqual({ n: 0 });
    expect((await audit(s.owner))[0]!.summary).toMatch(/^Archived Boss; \d+ placements/);
    expect((await post(t.app, `/api/employees/${boss}/restore`, undefined, s.owner)).status).toBe(200);
    expect((await list(s.owner)).people.map((p) => p.displayName)).toContain("Boss");
    // a person with a login is removed on the Users page, not archived here
    const member = await addPerson(t.app, s.owner, "m@example.com", s.ids.employee, "Member");
    const ar = await post(t.app, `/api/employees/${member.membershipId}/archive`, undefined, s.owner);
    expect(ar.status).toBe(409);
    expect(code(ar)).toBe("has_login");
    expect((await post(t.app, `/api/employees/${member.membershipId}/archive`, undefined, member.cookie)).status).toBe(403); // an employee cannot
  });

  it("removing a person with a login ends their placements and lines", async () => {
    const s = await setup();
    const member = await addPerson(t.app, s.owner, "m@example.com", s.ids.employee, "Member");
    await post(t.app, `/api/teams/${s.core}/members`, { membershipId: member.membershipId }, s.owner);
    await post(t.app, "/api/hierarchy/reporting", { subordinateId: member.membershipId, managerId: await add(s.owner, "Boss") }, s.owner);
    expect((await post(t.app, `/api/people/${member.membershipId}/remove`, undefined, s.owner)).status).toBe(200);
    expect(t.db.prepare("SELECT COUNT(*) n FROM team_memberships WHERE membership_id = ? AND end_date IS NULL").get(member.membershipId)).toEqual({ n: 0 });
    expect(t.db.prepare("SELECT COUNT(*) n FROM reporting_relationships WHERE subordinate_membership_id = ? AND end_date IS NULL").get(member.membershipId)).toEqual({ n: 0 });
  });
});

describe("who sees what (the real hierarchy behind the scope resolver)", () => {
  it("an employee (my teams) sees their teammates; a manager (reports) sees and manages only the people below them; sensitive details follow people.view_sensitive", async () => {
    const s = await setup();
    const emp = await addPerson(t.app, s.owner, "emp@example.com", s.ids.employee, "Emma Employee");
    const mgr = await addPerson(t.app, s.owner, "mgr@example.com", s.ids.manager, "Max Manager");
    const mate = await add(s.owner, "Tess Teammate", { teamId: s.core, employeeCode: "T-1", workEmail: "tess@acme.test" });
    const stranger = await add(s.owner, "Sam Stranger", { teamId: s.inside, employeeCode: "S-1" });
    const report = await add(s.owner, "Rita Report", { managerId: mgr.membershipId, employeeCode: "R-1" });
    await post(t.app, `/api/teams/${s.core}/members`, { membershipId: emp.membershipId }, s.owner);

    // employee: org.view / people.view = my_teams; sees self (always) + teammates, never the stranger
    const seen = (await list(emp.cookie)).people;
    expect(names(seen)).toEqual(["Emma Employee", "Tess Teammate"]);
    expect(seen.find((p) => p.displayName === "Tess Teammate")!.email).toBeNull(); // sensitive details are only for themselves
    expect((await get(t.app, `/api/employees/${stranger}`, emp.cookie)).status).toBe(404);
    const mateProfile = (await get(t.app, `/api/employees/${mate}`, emp.cookie)).body.data;
    expect(mateProfile.employment).toBeNull();
    expect(mateProfile.can).toEqual({ edit: false, manageHierarchy: false, archive: false, restore: false });
    const myProfile = (await get(t.app, `/api/employees/${emp.membershipId}`, emp.cookie)).body.data;
    expect(myProfile.employment).toEqual({ employeeCode: null, employmentType: null, startDate: null, endDate: null });
    expect((await post(t.app, "/api/employees", { name: "Nope" }, emp.cookie)).status).toBe(403);

    // manager: people.view = reports + my teams; people.manage = reports
    const mgrSees = names((await list(mgr.cookie)).people);
    expect(mgrSees).toEqual(["Max Manager", "Rita Report"]);
    const ritaView = (await get(t.app, `/api/employees/${report}`, mgr.cookie)).body.data;
    expect(ritaView.employment.employeeCode).toBe("R-1");
    expect(ritaView.can.edit).toBe(true);
    expect((await send(t.app, "patch", `/api/employees/${report}`, { employeeCode: "R-2" }, mgr.cookie)).status).toBe(200);
    expect((await send(t.app, "patch", `/api/employees/${mate}`, { employeeCode: "X" }, mgr.cookie)).status).toBe(404); // outside their reports
    // a manager adds a person only under someone in their reports
    expect(code(await post(t.app, "/api/employees", { name: "Free agent" }, mgr.cookie))).toBe("outside_scope");
    expect((await post(t.app, "/api/employees", { name: "New hire", managerId: report }, mgr.cookie)).status).toBe(201);
    expect(code(await post(t.app, "/api/employees", { name: "Out", managerId: mate }, mgr.cookie))).toBe("outside_scope");
    // the manager role holds no hierarchy.manage
    expect((await post(t.app, "/api/hierarchy/reporting", { subordinateId: report, managerId: mgr.membershipId, type: "secondary" }, mgr.cookie)).status).toBe(403);
    // and a manager gets exactly their part of the chart
    const chart = (await get(t.app, "/api/hierarchy/tree", mgr.cookie)).body.data;
    expect(chart.partial).toBe(true);
    expect(chart.nodes.map((n: { name: string }) => n.name)).toEqual(["Max Manager"]);
    expect(JSON.stringify(chart)).not.toMatch(/Sam Stranger|Tess/);
  });

  it("a role given for one department reaches that department's people only", async () => {
    const s = await setup();
    const head = await addPerson(t.app, s.owner, "head@example.com", undefined, "Hana Head");
    await add(s.owner, "In Eng", { teamId: s.core });
    await add(s.owner, "In Sales", { teamId: s.inside });
    const give = await post(t.app, "/api/role-assignments", { membershipId: head.membershipId, roleId: s.ids.department_head, scopeType: "department", scopeId: s.eng }, s.owner);
    expect(give.status, JSON.stringify(give.body)).toBe(201);
    expect(give.body.data).toMatchObject({ scopeType: "department", scopeId: s.eng, scopeName: "Engineering" });
    const seen = names((await list(head.cookie)).people);
    expect(seen).toEqual(["Hana Head", "In Eng"]);
    expect((await post(t.app, "/api/employees", { name: "Eng hire", teamId: s.core }, head.cookie)).status).toBe(201);
    const chart = (await get(t.app, "/api/hierarchy/tree?view=organization", head.cookie)).body.data;
    expect(chart.nodes.map((n: { name: string }) => n.name)).toEqual(["Engineering"]);
    expect(JSON.stringify(chart)).not.toMatch(/Sales/);
    // the same role at a different scope is a second assignment; the same scope twice is refused
    expect((await post(t.app, "/api/role-assignments", { membershipId: head.membershipId, roleId: s.ids.department_head, scopeType: "department", scopeId: s.sales }, s.owner)).status).toBe(201);
    expect(code(await post(t.app, "/api/role-assignments", { membershipId: head.membershipId, roleId: s.ids.department_head, scopeType: "department", scopeId: s.sales }, s.owner))).toBe("already_assigned");
    expect((await audit(s.owner)).find((e) => /for the department "Engineering"/.test(e.summary))).toBeTruthy();
    // an unknown or archived department and a missing id
    expect((await post(t.app, "/api/role-assignments", { membershipId: head.membershipId, roleId: s.ids.employee, scopeType: "department", scopeId: "11111111-1111-4111-8111-111111111111" }, s.owner)).status).toBe(404);
  });

  it("people without any role see nothing", async () => {
    const s = await setup();
    const none = await addPerson(t.app, s.owner, "none@example.com", undefined, "No Role");
    for (const path of ["/api/employees", "/api/hierarchy/tree", "/api/hierarchy/reporting"]) expect((await get(t.app, path, none.cookie)).status, path).toBe(403);
  });
});

describe("audit and transactions", () => {
  it("every hierarchy change writes exactly one audit row with plain words and no secrets", async () => {
    const s = await setup();
    const a = await add(s.owner, "Ann");
    const b = await add(s.owner, "Bea");
    const before = (await audit(s.owner)).length;
    await post(t.app, "/api/hierarchy/reporting", { subordinateId: b, managerId: a }, s.owner);
    await post(t.app, `/api/teams/${s.core}/members`, { membershipId: b, type: "lead" }, s.owner);
    await post(t.app, "/api/hierarchy/move", { membershipId: b, toTeamId: s.inside }, s.owner);
    const log = await audit(s.owner);
    expect(log.length - before).toBe(3);
    expect(log.slice(0, 3).map((e) => e.action).reverse()).toEqual(["reporting.add", "team_member.add", "person.move"]);
    expect(JSON.stringify(log)).not.toMatch(/password|token|secret/i);
  });

  it("a refused change leaves no audit row and no half-written rows", async () => {
    const s = await setup();
    const a = await add(s.owner, "Ann");
    const b = await add(s.owner, "Bea", { managerId: a });
    const before = (await audit(s.owner)).length;
    expect(code(await post(t.app, "/api/hierarchy/reporting", { subordinateId: a, managerId: b }, s.owner))).toBe("would_create_cycle");
    expect((await audit(s.owner)).length).toBe(before);
    expect(t.db.prepare("SELECT COUNT(*) n FROM reporting_relationships").get()).toEqual({ n: 1 });
  });

  it("Delete my account: people without a login keep the organization alive until they are archived; then everything goes", async () => {
    const s = await setup();
    const a = await add(s.owner, "Ann", { teamId: s.core, designationId: s.dev });
    const b = await add(s.owner, "Bea", { managerId: a });
    const del = { password: "correct horse battery", confirmEmail: "owner@example.com", confirmOrganizationName: "Acme" };
    expect(code(await post(t.app, "/api/auth/delete-account", del, s.owner))).toBe("last_admin"); // two other people still belong
    await post(t.app, `/api/employees/${b}/archive`, undefined, s.owner);
    await post(t.app, `/api/employees/${a}/archive`, undefined, s.owner);
    const res = await post(t.app, "/api/auth/delete-account", del, s.owner);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    for (const table of ["organization_memberships", "reporting_relationships", "team_memberships", "department_memberships", "designation_assignments"]) expect(t.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get(), table).toEqual({ n: 0 });
  });
});
