import { afterEach, describe, expect, it } from "vitest";
import type { TestApp } from "./helpers/app.js";
import { get, makeAuthApp, post, send, signUpWithOrg } from "./helpers/auth.js";
import { addPerson, roleIds } from "./helpers/roles.js";

let t: TestApp;
afterEach(() => t?.cleanup());

type Row = { id: string; name: string; parentId?: string | null; departmentId?: string; parentTeamId?: string | null; archived: boolean; roleFamilyId?: string | null };
const view = async (cookie: string) => (await get(t.app, "/api/organization/structure", cookie)).body.data as { departments: Row[]; teams: Row[]; roleFamilies: Row[]; designations: Row[]; limits: { maxDepth: number }; partial: boolean };
const code = (r: { body: { error?: { code?: string } } }) => r.body.error?.code;
const created = async (path: string, body: Record<string, unknown>, cookie: string): Promise<string> => {
  const r = await post(t.app, path, body, cookie);
  expect(r.status, `${path} ${JSON.stringify(r.body)}`).toBe(201);
  return r.body.data.id as string;
};
const audit = async (cookie: string, q = "") => (await get(t.app, `/api/audit-logs?limit=100${q}`, cookie)).body.data as { action: string; summary: string; entityType: string; entityId: string | null; before: unknown; after: unknown }[];

async function setup() {
  t = makeAuthApp();
  const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
  const ids = await roleIds(t.app, owner);
  return { owner, ids };
}

describe("departments, teams and sub-teams", () => {
  it("builds a department → team → sub-team tree, renames it, and audits every change in plain words", async () => {
    const { owner } = await setup();
    const eng = await created("/api/departments", { name: "Engineering", description: "Builds the product" }, owner);
    const platform = await created("/api/teams", { name: "Platform", departmentId: eng }, owner);
    const infra = await created("/api/teams", { name: "Infra", departmentId: eng, parentTeamId: platform }, owner);
    const v = await view(owner);
    expect(v.limits.maxDepth).toBe(8);
    expect(v.partial).toBe(false);
    expect(v.departments).toMatchObject([{ id: eng, name: "Engineering", parentId: null, archived: false }]);
    expect(v.teams.find((x) => x.id === infra)).toMatchObject({ departmentId: eng, parentTeamId: platform });

    const ren = await send(t.app, "patch", `/api/teams/${platform}`, { name: "  Platform   Engineering " }, owner);
    expect(ren.status).toBe(200);
    expect(ren.body.data.name).toBe("Platform Engineering"); // trimmed, single spaces

    const log = await audit(owner);
    expect(log.map((e) => e.action).reverse().slice(1)).toEqual(["department.create", "team.create", "team.create", "team.rename"]);
    expect(log[0]!.summary).toBe('Renamed the team "Platform" to "Platform Engineering"');
    expect(log.find((e) => e.action === "team.create" && e.entityId === infra)!.summary).toBe('Created the sub-team "Infra" in "Engineering"');
  });

  it("keeps names unique among ACTIVE siblings (any letter case), but allows the same name under another parent", async () => {
    const { owner } = await setup();
    const a = await created("/api/departments", { name: "Sales" }, owner);
    const b = await created("/api/departments", { name: "Marketing" }, owner);
    const dup = await post(t.app, "/api/departments", { name: "SALES" }, owner);
    expect(dup.status).toBe(409);
    expect(code(dup)).toBe("name_taken");
    await created("/api/departments", { name: "Sales", parentId: b }, owner); // same name, different parent: fine
    await created("/api/teams", { name: "Core", departmentId: a }, owner);
    await created("/api/teams", { name: "Core", departmentId: b }, owner); // different department: fine
    expect((await post(t.app, "/api/teams", { name: "core", departmentId: a }, owner)).status).toBe(409);
    await created("/api/role-families", { name: "Engineering" }, owner);
    expect(code(await post(t.app, "/api/role-families", { name: "engineering" }, owner))).toBe("name_taken");
    await created("/api/designations", { name: "Mentor" }, owner);
    expect(code(await post(t.app, "/api/designations", { name: "MENTOR" }, owner))).toBe("name_taken");
    // renaming onto a sibling's name is refused too
    expect(code(await send(t.app, "patch", `/api/departments/${b}`, { name: "sales" }, owner))).toBe("name_taken");
    // an archived name is free again
    await post(t.app, `/api/teams/${(await view(owner)).teams[0]!.id}/archive`, undefined, owner);
  });

  it("checks names: empty, too long, control characters", async () => {
    const { owner } = await setup();
    for (const name of ["   ", "x".repeat(81), "bad\u0007name"]) {
      const r = await post(t.app, "/api/departments", { name }, owner);
      expect(r.status, JSON.stringify(name)).toBe(400);
      expect(["invalid_name", "validation_failed"]).toContain(code(r));
    }
    expect((await post(t.app, "/api/departments", { name: "ok", description: "d".repeat(501) }, owner)).status).toBe(400);
    expect((await post(t.app, "/api/departments", { name: "x", extra: 1 }, owner)).status).toBe(400); // unknown fields refused
    expect((await view(owner)).departments).toHaveLength(0);
  });

  it("allows 8 levels and refuses the 9th (departments and teams), also when moving a whole subtree", async () => {
    const { owner } = await setup();
    let parent: string | null = null;
    const chain: string[] = [];
    for (let i = 1; i <= 8; i++) {
      parent = await created("/api/departments", { name: `Level ${i}`, parentId: parent }, owner);
      chain.push(parent);
    }
    const ninth = await post(t.app, "/api/departments", { name: "Level 9", parentId: chain[7] }, owner);
    expect(ninth.status).toBe(400);
    expect(code(ninth)).toBe("depth_exceeded");
    // a separate two-level branch cannot be moved under level 7 (it would reach level 9), but fits under level 6
    const top = await created("/api/departments", { name: "Branch" }, owner);
    await created("/api/departments", { name: "Branch child", parentId: top }, owner);
    expect(code(await send(t.app, "patch", `/api/departments/${top}`, { parentId: chain[6] }, owner))).toBe("depth_exceeded");
    expect((await send(t.app, "patch", `/api/departments/${top}`, { parentId: chain[5] }, owner)).status).toBe(200);

    // teams: eight levels inside one department
    const dep = chain[0]!;
    let tp: string | null = null;
    const teams: string[] = [];
    for (let i = 1; i <= 8; i++) {
      tp = await created("/api/teams", { name: `Team ${i}`, departmentId: dep, parentTeamId: tp }, owner);
      teams.push(tp);
    }
    expect(code(await post(t.app, "/api/teams", { name: "Team 9", departmentId: dep, parentTeamId: teams[7] }, owner))).toBe("depth_exceeded");
  });

  it("refuses to move a department under itself or its own sub-department", async () => {
    const { owner } = await setup();
    const a = await created("/api/departments", { name: "A" }, owner);
    const b = await created("/api/departments", { name: "B", parentId: a }, owner);
    const c = await created("/api/departments", { name: "C", parentId: b }, owner);
    for (const target of [a, b, c]) {
      const r = await send(t.app, "patch", `/api/departments/${a}`, { parentId: target }, owner);
      expect(r.status, target).toBe(409);
      expect(code(r)).toBe("would_create_cycle");
    }
    // moving C to the top level, and B under C's old place, works
    expect((await send(t.app, "patch", `/api/departments/${c}`, { parentId: null }, owner)).status).toBe(200);
    expect((await send(t.app, "patch", `/api/departments/${a}`, { parentId: c }, owner)).status).toBe(200);
    expect((await audit(owner)).filter((e) => e.action === "department.move").map((e) => e.summary)).toEqual(['Moved the department "A" under "C"', 'Moved the department "C" to the top level']);
  });

  it("a sub-team must share its parent's department, and a team moved to another department takes its sub-teams along", async () => {
    const { owner } = await setup();
    const d1 = await created("/api/departments", { name: "D1" }, owner);
    const d2 = await created("/api/departments", { name: "D2" }, owner);
    const t1 = await created("/api/teams", { name: "T1", departmentId: d1 }, owner);
    const t2 = await created("/api/teams", { name: "T2", departmentId: d1, parentTeamId: t1 }, owner);
    const t3 = await created("/api/teams", { name: "T3", departmentId: d1, parentTeamId: t2 }, owner);
    const wrong = await post(t.app, "/api/teams", { name: "Odd", departmentId: d2, parentTeamId: t1 }, owner);
    expect(wrong.status).toBe(400);
    expect(code(wrong)).toBe("wrong_department");

    const moved = await send(t.app, "patch", `/api/teams/${t1}`, { departmentId: d2 }, owner);
    expect(moved.status).toBe(200);
    const v = await view(owner);
    for (const id of [t1, t2, t3]) expect(v.teams.find((x) => x.id === id)!.departmentId, id).toBe(d2);
    expect(v.teams.find((x) => x.id === t2)!.parentTeamId).toBe(t1); // the sub-teams keep their parents
    // cannot move a team under its own sub-team
    expect(code(await send(t.app, "patch", `/api/teams/${t1}`, { parentTeamId: t3 }, owner))).toBe("would_create_cycle");
    // moving a sub-team to another department without naming a parent makes it top-level there
    expect((await send(t.app, "patch", `/api/teams/${t3}`, { departmentId: d1 }, owner)).status).toBe(200);
    expect((await view(owner)).teams.find((x) => x.id === t3)).toMatchObject({ departmentId: d1, parentTeamId: null });
  });

  it("archives with confirmation rules: refused while there are active children, allowed for a leaf, and restore needs an active parent and a free name", async () => {
    const { owner } = await setup();
    const dep = await created("/api/departments", { name: "Ops" }, owner);
    const sub = await created("/api/departments", { name: "Ops Sub", parentId: dep }, owner);
    const team = await created("/api/teams", { name: "Run", departmentId: dep }, owner);
    const subTeam = await created("/api/teams", { name: "Run Night", departmentId: dep, parentTeamId: team }, owner);

    const blocked = await post(t.app, `/api/departments/${dep}/archive`, undefined, owner);
    expect(blocked.status).toBe(409);
    expect(code(blocked)).toBe("has_active_children");
    expect(blocked.body.error.message).toMatch(/1 active sub-department and 2 active teams/);
    expect(code(await post(t.app, `/api/teams/${team}/archive`, undefined, owner))).toBe("has_active_children");

    expect((await post(t.app, `/api/teams/${subTeam}/archive`, undefined, owner)).status).toBe(200);
    expect((await post(t.app, `/api/teams/${team}/archive`, undefined, owner)).status).toBe(200);
    expect(code(await post(t.app, `/api/teams/${team}/archive`, undefined, owner))).toBe("already_archived");
    expect((await post(t.app, `/api/departments/${sub}/archive`, undefined, owner)).status).toBe(200);
    expect((await post(t.app, `/api/departments/${dep}/archive`, undefined, owner)).status).toBe(200);

    // nothing was deleted; the archived rows still show, marked
    const v = await view(owner);
    expect(v.departments.every((d) => d.archived)).toBe(true);
    expect(v.teams.every((x) => x.archived)).toBe(true);
    expect(t.db.prepare("SELECT COUNT(*) n FROM departments").get()).toEqual({ n: 2 });

    // an archived item cannot be edited, nor can children be added under it
    expect(code(await send(t.app, "patch", `/api/departments/${dep}`, { name: "Renamed" }, owner))).toBe("archived");
    expect(code(await post(t.app, "/api/teams", { name: "New", departmentId: dep }, owner))).toBe("parent_archived");
    expect(code(await post(t.app, "/api/departments", { name: "New", parentId: dep }, owner))).toBe("parent_archived");

    // restore: the child cannot come back before its parent; a taken name blocks a restore
    expect(code(await post(t.app, `/api/departments/${sub}/restore`, undefined, owner))).toBe("parent_archived");
    expect(code(await post(t.app, `/api/teams/${team}/restore`, undefined, owner))).toBe("parent_archived");
    expect((await post(t.app, `/api/departments/${dep}/restore`, undefined, owner)).status).toBe(200);
    expect((await post(t.app, `/api/departments/${sub}/restore`, undefined, owner)).status).toBe(200);
    await created("/api/teams", { name: "run", departmentId: dep }, owner); // takes the name while "Run" is archived
    expect(code(await post(t.app, `/api/teams/${team}/restore`, undefined, owner))).toBe("name_taken");
    expect(code(await post(t.app, `/api/departments/${dep}/restore`, undefined, owner))).toBe("not_archived");
    const actions = (await audit(owner)).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["department.archive", "department.restore", "team.archive"]));
  });
});

describe("role families and designations", () => {
  it("creates the designation \"Mentor\" in a role family, moves it, and refuses archiving a family that still has designations", async () => {
    const { owner } = await setup();
    const eng = await created("/api/role-families", { name: "Engineering" }, owner);
    const ops = await created("/api/role-families", { name: "Operations" }, owner);
    const mentor = await created("/api/designations", { name: "Mentor", roleFamilyId: eng }, owner);
    const alone = await created("/api/designations", { name: "Founder" }, owner);
    let v = await view(owner);
    expect(v.designations.find((d) => d.id === mentor)!.roleFamilyId).toBe(eng);
    expect(v.designations.find((d) => d.id === alone)!.roleFamilyId).toBeNull();

    const blocked = await post(t.app, `/api/role-families/${eng}/archive`, undefined, owner);
    expect(code(blocked)).toBe("has_active_children");
    expect((await send(t.app, "patch", `/api/designations/${mentor}`, { roleFamilyId: ops }, owner)).status).toBe(200);
    expect((await post(t.app, `/api/role-families/${eng}/archive`, undefined, owner)).status).toBe(200);
    expect(code(await post(t.app, "/api/designations", { name: "Lead", roleFamilyId: eng }, owner))).toBe("parent_archived");

    // a designation of an archived family cannot be restored until the family is
    await post(t.app, `/api/designations/${mentor}/archive`, undefined, owner);
    expect((await send(t.app, "patch", `/api/designations/${alone}`, { roleFamilyId: eng }, owner)).status).toBe(409);
    expect((await post(t.app, `/api/designations/${mentor}/restore`, undefined, owner)).status).toBe(200); // its family (Operations) is active
    expect((await send(t.app, "patch", `/api/role-families/${ops}`, { description: "Runs the company" }, owner)).body.data.description).toBe("Runs the company");
    v = await view(owner);
    expect(v.roleFamilies.filter((f) => !f.archived).map((f) => f.name)).toEqual(["Operations"]);
    expect((await audit(owner)).map((e) => e.entityType)).toEqual(expect.arrayContaining(["role_family", "designation"]));
  });

  it("changing nothing writes no audit row", async () => {
    const { owner } = await setup();
    const fam = await created("/api/role-families", { name: "Same" }, owner);
    const before = (await audit(owner)).length;
    expect((await send(t.app, "patch", `/api/role-families/${fam}`, { name: "Same" }, owner)).status).toBe(200);
    expect((await audit(owner)).length).toBe(before);
  });
});

describe("who may do what", () => {
  it("lets Owner and CEO manage the structure; everyone else is refused every write and, with no team yet, the read too (nothing changes)", async () => {
    const { owner, ids } = await setup();
    const dep = await created("/api/departments", { name: "Engineering" }, owner);
    const team = await created("/api/teams", { name: "Platform", departmentId: dep }, owner);
    const ceo = await addPerson(t.app, owner, "ceo@example.com", ids.ceo, "Chief");
    const emp = await addPerson(t.app, owner, "emp@example.com", ids.employee, "Employee");
    const mgr = await addPerson(t.app, owner, "mgr@example.com", ids.manager, "Manager");
    expect((await post(t.app, "/api/departments", { name: "Finance" }, ceo.cookie)).status).toBe(201);

    const before = JSON.stringify([t.db.prepare("SELECT * FROM departments ORDER BY id").all(), t.db.prepare("SELECT * FROM teams ORDER BY id").all()]);
    for (const who of [emp.cookie, mgr.cookie]) {
      expect((await post(t.app, "/api/departments", { name: "Nope" }, who)).status).toBe(403);
      expect((await send(t.app, "patch", `/api/departments/${dep}`, { name: "Nope" }, who)).status).toBe(403);
      expect((await post(t.app, `/api/departments/${dep}/archive`, undefined, who)).status).toBe(403);
      expect((await post(t.app, `/api/teams/${team}/archive`, undefined, who)).status).toBe(403);
      expect((await post(t.app, "/api/role-families", { name: "Nope" }, who)).status).toBe(403);
      expect((await post(t.app, "/api/designations", { name: "Nope" }, who)).status).toBe(403);
    }
    // their read scope is "my teams" / "reports", and nobody belongs to a team until stage 2.6: an empty scope is a 403, as for every permission
    expect((await get(t.app, "/api/organization/structure", emp.cookie)).status).toBe(403);
    // the Manager's "reports" scope is the person alone for now, so the call is allowed but shows no department or team
    const m = await get(t.app, "/api/organization/structure", mgr.cookie);
    expect(m.status).toBe(200);
    expect(m.body.data).toMatchObject({ partial: true, departments: [], teams: [] });
    expect(JSON.stringify([t.db.prepare("SELECT * FROM departments ORDER BY id").all(), t.db.prepare("SELECT * FROM teams ORDER BY id").all()])).toBe(before);
  });

  it("a person with no role cannot even read the structure", async () => {
    const { owner } = await setup();
    const nobody = await addPerson(t.app, owner, "nobody@example.com", undefined, "No Role");
    expect((await get(t.app, "/api/organization/structure", nobody.cookie)).status).toBe(403);
    expect((await post(t.app, "/api/departments", { name: "X" }, nobody.cookie)).status).toBe(403);
  });

  it("a scoped viewer sees only the teams in their scope and the departments above them (injected hierarchy)", async () => {
    // The hierarchy provider is faked here: stage 2.6 supplies the real one.
    const { makeTestApp } = await import("./helpers/app.js");
    const { withRegistration } = await import("./helpers/auth.js");
    const mine = new Set<string>();
    const teamsOfMe = new Set<string>();
    t = makeTestApp({
      config: withRegistration(),
      hierarchy: {
        myTeams: () => ({ members: new Set(), teams: teamsOfMe, departments: mine }),
        reports: (m) => ({ members: new Set([m]), teams: new Set(), departments: new Set() }),
        departmentSubtree: () => ({ members: new Set(), teams: new Set(), departments: new Set() }),
        teamSubtree: () => ({ members: new Set(), teams: new Set(), departments: new Set() }),
      },
    });
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ids = await roleIds(t.app, owner);
    const d1 = await created("/api/departments", { name: "Visible parent" }, owner);
    const d2 = await created("/api/departments", { name: "Hidden" }, owner);
    const tm = await created("/api/teams", { name: "Mine", departmentId: d1 }, owner);
    await created("/api/teams", { name: "Not mine", departmentId: d1 }, owner);
    await created("/api/teams", { name: "Secret team", departmentId: d2 }, owner);
    const emp = await addPerson(t.app, owner, "emp@example.com", ids.employee, "Employee");
    teamsOfMe.add(tm);
    const r = await get(t.app, "/api/organization/structure", emp.cookie);
    expect(r.status).toBe(200);
    expect(r.body.data.partial).toBe(true);
    expect(r.body.data.teams.map((x: Row) => x.name)).toEqual(["Mine"]);
    expect(r.body.data.departments.map((x: Row) => x.name)).toEqual(["Visible parent"]);
    expect(JSON.stringify(r.body)).not.toMatch(/Hidden|Secret team|Not mine/);
  });
});

describe("renaming the organization", () => {
  it("the Owner can; the name is checked, audited and shown by GET /api/organization; the slug stays", async () => {
    const { owner, ids } = await setup();
    const slugBefore = (t.db.prepare("SELECT slug FROM organizations").get() as { slug: string }).slug;
    const r = await send(t.app, "patch", "/api/organization", { name: "  Acme   Global " }, owner);
    expect(r.status).toBe(200);
    expect(r.body.data.name).toBe("Acme Global");
    expect((await get(t.app, "/api/organization", owner)).body.data.name).toBe("Acme Global");
    expect((t.db.prepare("SELECT slug FROM organizations").get() as { slug: string }).slug).toBe(slugBefore);
    expect((await audit(owner))[0]).toMatchObject({ action: "organization.rename", summary: 'Renamed the organization from "Acme" to "Acme Global"' });
    expect((await send(t.app, "patch", "/api/organization", { name: " " }, owner)).status).toBe(400);
    expect((await send(t.app, "patch", "/api/organization", { name: "X", slug: "y" }, owner)).status).toBe(400);
    const emp = await addPerson(t.app, owner, "emp@example.com", ids.employee, "Employee");
    expect((await send(t.app, "patch", "/api/organization", { name: "Hacked" }, emp.cookie)).status).toBe(403);
    expect((await get(t.app, "/api/organization", owner)).body.data.name).toBe("Acme Global");
  });
});

describe("deleting an account takes the structure with it", () => {
  it("the last person leaving an empty organization deletes its departments, teams, families and designations too", async () => {
    const { owner } = await setup();
    const dep = await created("/api/departments", { name: "Gone" }, owner);
    const team = await created("/api/teams", { name: "Gone team", departmentId: dep }, owner);
    await created("/api/teams", { name: "Gone sub", departmentId: dep, parentTeamId: team }, owner);
    const fam = await created("/api/role-families", { name: "Gone family" }, owner);
    await created("/api/designations", { name: "Gone designation", roleFamilyId: fam }, owner);
    const del = await post(t.app, "/api/auth/delete-account", { password: "correct horse battery", confirmEmail: "owner@example.com", confirmOrganizationName: "Acme" }, owner);
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    for (const table of ["departments", "teams", "role_families", "designations"]) expect(t.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get(), table).toEqual({ n: 0 });
  });
});
