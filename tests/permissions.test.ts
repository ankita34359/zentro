import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PERMISSIONS, PERMISSION_KEYS, BASELINE_RIGHTS } from "../backend/src/modules/permissions/catalog.js";
import { ROLE_TEMPLATES } from "../backend/src/modules/permissions/roleTemplates.js";
import {
  ALL_SCOPE, EMPTY_SCOPE, intersect, isEmptyScope, noHierarchy, resolveScope, scopeContainsMember, union,
  type Grant, type HierarchyProvider, type Unit,
} from "../backend/src/modules/permissions/resolver.js";
import { Capabilities } from "../backend/src/modules/permissions/service.js";
import { get, makeAuthApp, post, signUp, signUpWithOrg } from "./helpers/auth.js";
import { addPerson, roleIds } from "./helpers/roles.js";
import type { TestApp } from "./helpers/app.js";

let t: TestApp;
afterEach(() => t?.cleanup());
const one = <T>(sql: string, ...p: unknown[]) => t.db.prepare(sql).get(...p) as T;
const all = <T>(sql: string, ...p: unknown[]) => t.db.prepare(sql).all(...p) as T[];

// ---------- the catalogue and the templates ----------

describe("catalogue and role templates", () => {
  it("the database catalogue is exactly the code catalogue (key, module, description, modes, sensitivity)", () => {
    t = makeAuthApp();
    const rows = all<{ key: string; module: string; description: string; allowed_scope_modes_json: string; is_sensitive: number }>("SELECT key, module, description, allowed_scope_modes_json, is_sensitive FROM permissions ORDER BY rowid");
    expect(rows.map((r) => ({ key: r.key, module: r.module, description: r.description, modes: JSON.parse(r.allowed_scope_modes_json), sensitive: r.is_sensitive === 1 }))).toEqual(
      PERMISSIONS.map((p) => ({ key: p.key, module: p.module, description: p.description, modes: [...p.modes], sensitive: p.sensitive })),
    );
    expect(PERMISSIONS).toHaveLength(54);
    expect(new Set(PERMISSIONS.map((p) => p.key)).size).toBe(54);
  });

  it("every template grants only catalogue keys, only in modes the catalogue allows, and Owner is everything at all_in_scope", () => {
    for (const tpl of ROLE_TEMPLATES) {
      for (const [key, modes] of Object.entries(tpl.grants)) {
        expect(PERMISSION_KEYS.has(key), `${tpl.key} -> ${key}`).toBe(true);
        const allowed = PERMISSIONS.find((p) => p.key === key)!.modes;
        for (const m of modes) expect(allowed, `${tpl.key} ${key} ${m}`).toContain(m);
      }
    }
    expect(ROLE_TEMPLATES.map((x) => x.key)).toEqual(["owner", "ceo", "senior_management", "department_head", "manager", "team_lead", "mentor", "employee", "intern"]);
    for (const p of PERMISSIONS) expect(p.modes).toContain("all_in_scope"); // so the Owner can hold every permission at S
  });

  it("matches the documented matrix on the points that matter: the CEO has no daily-task grants, only Owner configures roles and scoring", () => {
    const g = (k: string) => ROLE_TEMPLATES.find((x) => x.key === k)!.grants;
    for (const k of ["task.create", "task.assign", "task.edit"]) expect(g("ceo")[k]).toBeUndefined();
    expect(g("ceo")["roles.view"]).toEqual(["all_in_scope"]);
    expect(g("ceo")["roles.manage"]).toBeUndefined();
    for (const tpl of ROLE_TEMPLATES.filter((x) => x.key !== "owner")) {
      for (const k of ["roles.manage", "org.settings", "performance.configure", "audit.view", "ai.configure"]) expect(tpl.grants[k], `${tpl.key} ${k}`).toBeUndefined();
    }
    expect(g("manager")["org.view"]).toEqual(["reports", "my_teams"]);
    expect(g("employee")["people.view_sensitive"]).toEqual(["own"]);
  });

  it("no code outside the template file looks at a role's key or name", () => {
    const src = path.resolve(import.meta.dirname, "../backend/src");
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".ts") ? [path.join(d, e.name)] : []));
    const rx = /["'`](owner|ceo|senior_management|department_head|manager|team_lead|mentor|employee|intern)["'`]/;
    const offenders = walk(src).filter((f) => !f.endsWith("roleTemplates.ts")).filter((f) => rx.test(fs.readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(src, f))).toEqual([]);
    // and the migrations do not name roles other than the Owner back-fill by kind
    const sql = fs.readFileSync(path.resolve(import.meta.dirname, "../database/migrations/0005_permissions_and_role_grants.sql"), "utf8");
    expect(sql.match(/key = '(\w+)'/g)).toEqual(["key = 'owner'"]);
  });

  it("a new organization gets the nine templates seeded, each with its grants, and its creator holds the creator template", async () => {
    t = makeAuthApp();
    await signUpWithOrg(t.app, "owner@example.com", "Acme");
    expect(all<{ key: string }>("SELECT key FROM roles ORDER BY created_at, key").map((r) => r.key).sort()).toEqual([...ROLE_TEMPLATES.map((x) => x.key)].sort());
    for (const tpl of ROLE_TEMPLATES) {
      const n = one<{ n: number }>("SELECT COUNT(*) n FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.key = ?", tpl.key).n;
      const expected = tpl.key === "owner" ? PERMISSIONS.length : Object.values(tpl.grants).reduce((s, m) => s + m.length, 0);
      expect(n, tpl.key).toBe(expected);
    }
    expect(one<{ key: string; scope_type: string }>("SELECT r.key, a.scope_type FROM user_role_assignments a JOIN roles r ON r.id = a.role_id")).toEqual({ key: "owner", scope_type: "organization" });
  });
});

// ---------- the resolver (pure) ----------

/** A small company: Eve leads team T1 (Ann, Bob, Cy) inside department D1; Dee heads D1 which also has team T2 (Flo). Ann reports to Eve. */
const U = (members: string[], teams: string[] = [], departments: string[] = []): Unit => ({ members: new Set(members), teams: new Set(teams), departments: new Set(departments) });
const company: HierarchyProvider = {
  myTeams: (m) => (["ann", "bob", "cy", "eve"].includes(m) ? U(["ann", "bob", "cy", "eve"], ["T1"]) : m === "flo" ? U(["flo"], ["T2"]) : U([])),
  reports: (m) => (m === "eve" ? U(["eve", "ann", "bob"], ["T1"]) : m === "dee" ? U(["dee", "eve", "ann", "bob", "flo"], ["T1", "T2"], ["D1"]) : U([m])),
  departmentSubtree: (d) => (d === "D1" ? U(["dee", "eve", "ann", "bob", "cy", "flo"], ["T1", "T2"], ["D1"]) : U([])),
  teamSubtree: (tm) => (tm === "T1" ? U(["eve", "ann", "bob", "cy"], ["T1"]) : tm === "T2" ? U(["flo"], ["T2"]) : U([])),
};
const g = (permission: string, mode: Grant["mode"], scopeType: Grant["scopeType"] = "organization", scopeId: string | null = null): Grant => ({ permission, mode, scopeType, scopeId });
const NOW = "2026-11-23T00:00:00.000Z";
const members = (s: ReturnType<typeof resolveScope>) => [...s.members].sort();

describe("scope resolver", () => {
  it("own is the caller; all_in_scope at organization scope is everyone", () => {
    expect(members(resolveScope([g("okr.view", "own")], "okr.view", "ann", company, NOW))).toEqual(["ann"]);
    expect(resolveScope([g("okr.view", "all_in_scope")], "okr.view", "ann", company, NOW).all).toBe(true);
  });

  it("my_teams is the people of the caller's teams; reports is the caller and everyone below", () => {
    expect(members(resolveScope([g("task.view", "my_teams")], "task.view", "ann", company, NOW))).toEqual(["ann", "bob", "cy", "eve"]);
    expect(members(resolveScope([g("task.view", "reports")], "task.view", "eve", company, NOW))).toEqual(["ann", "bob", "eve"]);
    expect(members(resolveScope([g("task.view", "reports")], "task.view", "cy", company, NOW))).toEqual(["cy"]);
    expect([...resolveScope([g("task.view", "reports")], "task.view", "dee", company, NOW).departments]).toEqual(["D1"]); // departments they head
  });

  it("an assignment scope cuts the mode down: all_in_scope at department D1 is D1's subtree, at team T1 is T1's, and the intersection can be empty", () => {
    expect(members(resolveScope([g("task.view", "all_in_scope", "department", "D1")], "task.view", "dee", company, NOW))).toEqual(["ann", "bob", "cy", "dee", "eve", "flo"]);
    expect(members(resolveScope([g("task.view", "all_in_scope", "team", "T1")], "task.view", "eve", company, NOW))).toEqual(["ann", "bob", "cy", "eve"]);
    // reports (Dee's whole tree) cut to team T2 leaves only Flo, not Eve's people
    expect(members(resolveScope([g("task.view", "reports", "team", "T2")], "task.view", "dee", company, NOW))).toEqual(["flo"]);
    expect(isEmptyScope(resolveScope([g("task.view", "own", "team", "T1")], "task.view", "dee", company, NOW))).toBe(true); // Dee is not in T1
    expect(isEmptyScope(resolveScope([g("task.view", "all_in_scope", "department", "no-such")], "task.view", "dee", company, NOW))).toBe(true);
  });

  it("several assignments are a union; a different permission is not touched", () => {
    const grants = [g("task.view", "own"), g("task.view", "my_teams"), g("okr.view", "all_in_scope")];
    expect(members(resolveScope(grants, "task.view", "ann", company, NOW))).toEqual(["ann", "bob", "cy", "eve"]);
    expect(isEmptyScope(resolveScope(grants, "kpi.view", "ann", company, NOW))).toBe(true);
    const two = resolveScope([g("task.view", "own", "self"), g("task.view", "all_in_scope", "team", "T2")], "task.view", "ann", company, NOW);
    expect(members(two)).toEqual(["ann", "flo"]);
  });

  it("with no hierarchy yet (before 2.5 and 2.6): reports is the caller alone, my_teams and department/team scopes are empty", () => {
    expect(members(resolveScope([g("p.x", "reports")], "p.x", "ann", noHierarchy, NOW))).toEqual(["ann"]);
    expect(isEmptyScope(resolveScope([g("p.x", "my_teams")], "p.x", "ann", noHierarchy, NOW))).toBe(true);
    expect(isEmptyScope(resolveScope([g("p.x", "all_in_scope", "department", "D1")], "p.x", "ann", noHierarchy, NOW))).toBe(true);
  });

  it("set algebra: all absorbs, intersect and union behave", () => {
    const a = { all: false, members: new Set(["x", "y"]), teams: new Set<string>(), departments: new Set<string>() };
    const b = { all: false, members: new Set(["y", "z"]), teams: new Set<string>(), departments: new Set<string>() };
    expect(members(intersect(a, b))).toEqual(["y"]);
    expect(members(union(a, b))).toEqual(["x", "y", "z"]);
    expect(intersect(ALL_SCOPE, a)).toBe(a);
    expect(union(a, ALL_SCOPE)).toBe(ALL_SCOPE);
    expect(scopeContainsMember(ALL_SCOPE, "anyone")).toBe(true);
    expect(scopeContainsMember(EMPTY_SCOPE, "anyone")).toBe(false);
  });

  it("Capabilities: has() needs a non-empty scope, toMap() lists granted modes, covers() is the 'cannot grant what you do not hold' rule", () => {
    const caps = new Capabilities("ann", [g("task.view", "my_teams"), g("task.view", "own"), g("okr.view", "reports"), g("kpi.view", "my_teams")], noHierarchy, NOW);
    expect(caps.has("task.view")).toBe(true); // own is non-empty
    expect(caps.has("kpi.view")).toBe(false); // my_teams is empty with no hierarchy
    expect(caps.toMap()).toEqual({ "task.view": ["my_teams", "own"], "okr.view": ["reports"] });
    const boss = new Capabilities("dee", [g("okr.view", "all_in_scope"), g("okr.edit", "reports")], noHierarchy, NOW);
    expect(boss.covers([{ permission: "okr.view", mode: "own" }, { permission: "okr.view", mode: "reports" }])).toBe(true); // S covers every mode
    expect(boss.covers([{ permission: "okr.edit", mode: "own" }])).toBe(true); // reports covers own
    expect(boss.covers([{ permission: "okr.edit", mode: "all_in_scope" }])).toBe(false);
    expect(boss.covers([{ permission: "kpi.view", mode: "own" }])).toBe(false);
  });
});

// ---------- the engine over HTTP ----------

describe("the permission engine", () => {
  it("me.capabilities: the Owner holds every permission at all_in_scope; a person with no role holds none but keeps the baseline rights", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const me = (await get(t.app, "/api/auth/me", owner)).body.data;
    expect(Object.keys(me.capabilities).sort()).toEqual([...PERMISSION_KEYS].sort());
    for (const modes of Object.values(me.capabilities)) expect(modes).toEqual(["all_in_scope"]);
    expect(me.roles).toEqual([{ key: "owner", name: "Owner" }]);
    expect(me.baseline).toEqual(BASELINE_RIGHTS.map((b) => b.key));
    const nobody = await signUp(t.app, "nobody@example.com");
    const none = (await get(t.app, "/api/auth/me", nobody)).body.data;
    expect(none.capabilities).toEqual({});
    expect(none.baseline.length).toBeGreaterThan(0);
    expect((await post(t.app, "/api/auth/change-password", {}, nobody)).status).toBe(400); // baseline routes need no role (reached validation)
  });

  it("a person invited into a role holds that role's grants (Employee: own and team scopes; Owner-only things stay refused)", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ids = await roleIds(t.app, owner);
    const emp = await addPerson(t.app, owner, "emp@example.com", ids.employee);
    const me = (await get(t.app, "/api/auth/me", emp.cookie)).body.data;
    expect(me.roles).toEqual([{ key: "employee", name: "Employee" }]);
    // with no hierarchy yet, my_teams grants are empty, own grants remain
    expect(me.capabilities["okr.view"]).toEqual(["own", "my_teams"]);
    expect(me.capabilities["task.create"]).toEqual(["own"]);
    expect(me.capabilities["roles.view"]).toBeUndefined();
    expect((await get(t.app, "/api/roles", emp.cookie)).status).toBe(403);
    expect((await get(t.app, "/api/invitations", emp.cookie)).status).toBe(403);
  });

  it("revoked, expired and not-yet-valid assignments and archived roles are denied on the very next request", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ids = await roleIds(t.app, owner);
    const ceo = await addPerson(t.app, owner, "ceo@example.com", ids.ceo);
    expect((await get(t.app, "/api/roles", ceo.cookie)).status).toBe(200);
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const assignment = "(SELECT id FROM user_role_assignments WHERE membership_id = ?)";
    t.db.prepare(`UPDATE user_role_assignments SET revoked_at = ? WHERE id = ${assignment}`).run(past, ceo.membershipId);
    expect((await get(t.app, "/api/roles", ceo.cookie)).status).toBe(403); // revoked
    t.db.prepare(`UPDATE user_role_assignments SET revoked_at = NULL, valid_to = ? WHERE id = ${assignment}`).run(past, ceo.membershipId);
    expect((await get(t.app, "/api/roles", ceo.cookie)).status).toBe(403); // expired
    t.db.prepare(`UPDATE user_role_assignments SET valid_to = NULL, valid_from = ? WHERE id = ${assignment}`).run(future, ceo.membershipId);
    expect((await get(t.app, "/api/roles", ceo.cookie)).status).toBe(403); // not valid yet
    t.db.prepare(`UPDATE user_role_assignments SET valid_from = ? WHERE id = ${assignment}`).run(past, ceo.membershipId);
    expect((await get(t.app, "/api/roles", ceo.cookie)).status).toBe(200); // control
    t.db.prepare("UPDATE roles SET archived_at = ? WHERE key = 'ceo'").run(past);
    expect((await get(t.app, "/api/roles", ceo.cookie)).status).toBe(403); // archived role grants nothing
  });

  it("removing the membership ends all permissions at once", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ceo = await addPerson(t.app, owner, "ceo@example.com", (await roleIds(t.app, owner)).ceo);
    t.db.prepare("UPDATE organization_memberships SET status = 'left' WHERE id = ?").run(ceo.membershipId);
    expect((await get(t.app, "/api/roles", ceo.cookie)).status).toBe(403);
  });

  it("the guard works from the registry key: there is no role-name check anywhere (a custom role with the same grants behaves the same)", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const org = one<{ id: string }>("SELECT id FROM organizations").id;
    // a role nobody ever seeded, created straight in the database, with ONE grant
    t.db.prepare("INSERT INTO roles (id, organization_id, key, name, description, kind, created_at, updated_at) VALUES ('11111111-1111-4111-8111-111111111111', ?, 'program_director', 'Program Director', '', 'custom', ?, ?)").run(org, new Date().toISOString(), new Date().toISOString());
    t.db.prepare("INSERT INTO role_permissions (organization_id, role_id, permission_id, scope_mode, created_at) VALUES (?, '11111111-1111-4111-8111-111111111111', 'roles.view', 'all_in_scope', ?)").run(org, new Date().toISOString());
    const pd = await addPerson(t.app, owner, "pd@example.com", "11111111-1111-4111-8111-111111111111");
    expect((await get(t.app, "/api/roles", pd.cookie)).status).toBe(200);
    expect((await get(t.app, "/api/invitations", pd.cookie)).status).toBe(403); // only the one grant
    const me = (await get(t.app, "/api/auth/me", pd.cookie)).body.data;
    expect(me.capabilities).toEqual({ "roles.view": ["all_in_scope"] });
    expect(me.roles).toEqual([{ key: "program_director", name: "Program Director" }]);
  });
});

describe("roles screens data (read only)", () => {
  it("lists the nine templates with counts, shows one role's permissions with their modes, and serves the catalogue", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const list = (await get(t.app, "/api/roles", owner)).body.data as { key: string; permissionCount: number; holderCount: number }[];
    expect(list.map((r) => r.key).sort()).toEqual([...ROLE_TEMPLATES.map((x) => x.key)].sort());
    expect(list.find((r) => r.key === "owner")).toMatchObject({ permissionCount: 54, holderCount: 1 });
    expect(list.find((r) => r.key === "intern")!.holderCount).toBe(0);
    const ids = await roleIds(t.app, owner);
    const mgr = (await get(t.app, `/api/roles/${ids.manager}`, owner)).body.data;
    expect(mgr).toMatchObject({ key: "manager", name: "Manager", kind: "template" });
    expect(mgr.permissions.find((p: { key: string }) => p.key === "org.view")).toMatchObject({ modes: ["my_teams", "reports"], allowedModes: ["own", "my_teams", "reports", "all_in_scope"], sensitive: false });
    expect(mgr.permissions.find((p: { key: string }) => p.key === "people.view_sensitive")).toMatchObject({ sensitive: true });
    const cat = (await get(t.app, "/api/permissions", owner)).body.data as { key: string }[];
    expect(cat).toHaveLength(54);
    expect((await get(t.app, `/api/roles/${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}`, owner)).status).toBe(404);
    expect((await get(t.app, "/api/roles/not-a-uuid", owner)).status).toBe(400);
  });
});

describe("inviting into a role", () => {
  it("the invitee holds the chosen role from the moment they join; the invitation list names it", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ids = await roleIds(t.app, owner);
    const res = await post(t.app, "/api/invitations", { email: "mgr@example.com", roleId: ids.manager }, owner);
    expect(res.status).toBe(201);
    expect(res.body.data.invitation.roleName).toBe("Manager");
    expect((await get(t.app, "/api/invitations", owner)).body.data[0].roleName).toBe("Manager");
    const person = await addPerson(t.app, owner, "mgr2@example.com", ids.manager);
    expect((await get(t.app, "/api/auth/me", person.cookie)).body.data.roles).toEqual([{ key: "manager", name: "Manager" }]);
    expect(one<{ granted: string }>("SELECT granted_by_membership_id AS granted FROM user_role_assignments WHERE membership_id = ?", person.membershipId).granted).toBe(one<{ id: string }>("SELECT id FROM organization_memberships WHERE work_email = 'owner@example.com'").id);
  });

  it("you cannot invite into a role whose permissions you do not hold (403), a role of another organization is 404, an unknown role id is 404", async () => {
    t = makeAuthApp();
    const ownerA = await signUpWithOrg(t.app, "owner-a@example.com", "Alpha");
    const ownerB = await signUpWithOrg(t.app, "owner-b@example.com", "Beta");
    const idsA = await roleIds(t.app, ownerA);
    const idsB = await roleIds(t.app, ownerB);
    const ceoA = await addPerson(t.app, ownerA, "ceo@example.com", idsA.ceo); // holds invitations.manage but not roles.manage etc.
    const tooMuch = await post(t.app, "/api/invitations", { email: "x@example.com", roleId: idsA.owner }, ceoA.cookie);
    expect(tooMuch.status).toBe(403);
    expect(tooMuch.body.error.code).toBe("cannot_grant_role");
    const within = await post(t.app, "/api/invitations", { email: "y@example.com", roleId: idsA.senior_management }, ceoA.cookie);
    expect(within.status).toBe(201); // the CEO template covers every permission of the Senior Management template
    expect((await post(t.app, "/api/invitations", { email: "v@example.com", roleId: idsA.employee }, ceoA.cookie)).status).toBe(403); // ...but not the Employee template (the CEO has no daily-task grants)
    expect((await post(t.app, "/api/invitations", { email: "z@example.com", roleId: idsB.employee }, ownerA)).status).toBe(404); // B's role from A
    expect((await post(t.app, "/api/invitations", { email: "w@example.com", roleId: "11111111-1111-4111-8111-111111111111" }, ownerA)).status).toBe(404);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM invitations WHERE email IN ('x@example.com','z@example.com','w@example.com')").n).toBe(0);
  });
});

describe("scope-aware administration (with a hierarchy injected)", () => {
  it("people.manage at 'reports' lets a manager reset only their own reports, and the people list shows only them (and the manager)", async () => {
    let mgrId = "";
    let repId = "";
    const hierarchy: HierarchyProvider = { ...noHierarchy, reports: (m) => (m === mgrId ? U([mgrId, repId]) : U([m])) };
    t = makeAuthApp({ hierarchy });
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ids = await roleIds(t.app, owner);
    const mgr = await addPerson(t.app, owner, "mgr@example.com", ids.manager, "Mgr");
    const rep = await addPerson(t.app, owner, "rep@example.com", ids.employee, "Rep");
    const other = await addPerson(t.app, owner, "other@example.com", ids.employee, "Other");
    mgrId = mgr.membershipId;
    repId = rep.membershipId;
    const link = await post(t.app, `/api/people/${rep.membershipId}/reset-link`, undefined, mgr.cookie);
    expect(link.status).toBe(201); // a report
    const notMine = await post(t.app, `/api/people/${other.membershipId}/reset-link`, undefined, mgr.cookie);
    expect(notMine.status).toBe(404); // exists, but outside the manager's scope: indistinguishable from missing
    const owners = await post(t.app, `/api/people/${one<{ id: string }>("SELECT id FROM organization_memberships WHERE work_email = 'owner@example.com'").id}/reset-link`, undefined, mgr.cookie);
    expect(owners.status).toBe(404);
    const members = (await get(t.app, "/api/organization/members", mgr.cookie)).body.data as { displayName: string }[];
    expect(members.map((m) => m.displayName).sort()).toEqual(["Mgr", "Rep"]);
    expect((await get(t.app, "/api/invitations", mgr.cookie)).status).toBe(403); // the manager template has no invitations.manage
    // the owner (organization-wide) still sees and resets everyone
    expect(((await get(t.app, "/api/organization/members", owner)).body.data as unknown[]).length).toBe(4);
    expect((await post(t.app, `/api/people/${other.membershipId}/reset-link`, undefined, owner)).status).toBe(201);
  });

  it("an assignment limited to a department cannot manage invitations (they have no subject yet): organization-wide only", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ids = await roleIds(t.app, owner);
    const dh = await addPerson(t.app, owner, "dh@example.com", ids.department_head, "DH");
    expect((await get(t.app, "/api/invitations", dh.cookie)).status).toBe(200); // organization-wide assignment
    t.db.prepare("UPDATE user_role_assignments SET scope_type = 'department', scope_id = 'dept-1' WHERE membership_id = ?").run(dh.membershipId);
    expect((await get(t.app, "/api/invitations", dh.cookie)).status).toBe(403); // department-limited: the guard sees an empty scope until 2.5 provides departments
  });
});
