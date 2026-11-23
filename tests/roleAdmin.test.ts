import { afterEach, describe, expect, it } from "vitest";
import { PERMISSIONS, permissionByKey } from "../backend/src/modules/permissions/catalog.js";
import type { TestApp } from "./helpers/app.js";
import { get, makeAuthApp, post, send, signUpWithOrg } from "./helpers/auth.js";
import { addPerson, roleIds } from "./helpers/roles.js";

let t: TestApp;
afterEach(() => t?.cleanup());
const one = <T>(sql: string, ...p: unknown[]) => t.db.prepare(sql).get(...p) as T;
const all = <T>(sql: string, ...p: unknown[]) => t.db.prepare(sql).all(...p) as T[];
const detail = async (cookie: string, id: string) => (await get(t.app, `/api/roles/${id}`, cookie)).body.data as { name: string; description: string; isProtected: boolean; permissions: { key: string; modes: string[] }[] };
const grid = (perms: { key: string; modes: string[] }[]) => perms.flatMap((p) => p.modes.map((mode) => ({ permission: p.key, mode })));
const audits = (action?: string) => all<{ action: string; summary: string; before_json: string | null; after_json: string | null; actor_membership_id: string | null }>(`SELECT action, summary, before_json, after_json, actor_membership_id FROM audit_logs ${action ? "WHERE action = ?" : ""} ORDER BY created_at, rowid`, ...(action ? [action] : []));

async function org() {
  t = makeAuthApp();
  const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
  const ids = await roleIds(t.app, owner);
  return { owner, ids };
}

describe("creating and editing roles", () => {
  it("creates a custom role (blank or a copy), with a unique name, and audits it", async () => {
    const { owner, ids } = await org();
    const blank = await post(t.app, "/api/roles", { name: "Program Director", description: "Runs programs" }, owner);
    expect(blank.status).toBe(201);
    expect(blank.body.data).toMatchObject({ name: "Program Director", kind: "custom", isProtected: false, permissionCount: 0 });
    const copy = await post(t.app, "/api/roles", { name: "Senior Manager", copyFromRoleId: ids.manager }, owner);
    expect(copy.status).toBe(201);
    expect(copy.body.data.permissionCount).toBe((await detail(owner, ids.manager)).permissions.length);
    expect((await post(t.app, "/api/roles", { name: "program director" }, owner)).status).toBe(409); // names are unique, ignoring case
    expect((await post(t.app, "/api/roles", { name: "x" }, owner)).status).toBe(400);
    expect((await post(t.app, "/api/roles", { name: "Okay Name", surprise: 1 }, owner)).status).toBe(400);
    expect(audits("role.create").map((a) => a.summary)).toEqual(['Created the role "Program Director"', 'Created the role "Senior Manager" as a copy of another role']);
    expect(one<{ key: string }>("SELECT key FROM roles WHERE name = 'Program Director'").key).toBe("program_director");
  });

  it("renames a role and records before and after; the Owner role cannot be edited, even by the Owner", async () => {
    const { owner, ids } = await org();
    const mine = (await post(t.app, "/api/roles", { name: "Program Director" }, owner)).body.data.id as string;
    const r = await send(t.app, "patch", `/api/roles/${mine}`, { name: "Program Lead", description: "New text" }, owner);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ name: "Program Lead", description: "New text" });
    const a = audits("role.update")[0]!;
    expect(JSON.parse(a.before_json!)).toEqual({ name: "Program Director", description: "" });
    expect(JSON.parse(a.after_json!)).toEqual({ name: "Program Lead", description: "New text" });
    // a template can be edited like any role...
    expect((await send(t.app, "patch", `/api/roles/${ids.manager}`, { description: "Our managers" }, owner)).status).toBe(200);
    // ...but the Owner role is protected: view only
    const protectedRole = await send(t.app, "patch", `/api/roles/${ids.owner}`, { name: "Boss" }, owner);
    expect(protectedRole.status).toBe(403);
    expect(protectedRole.body.error.code).toBe("role_protected");
    expect((await send(t.app, "put", `/api/roles/${ids.owner}/permissions`, { grants: [] }, owner)).body.error.code).toBe("role_protected");
    expect((await post(t.app, `/api/roles/${ids.owner}/archive`, undefined, owner)).body.error.code).toBe("role_protected");
    expect((await detail(owner, ids.owner)).isProtected).toBe(true);
    expect((await detail(owner, ids.owner)).permissions).toHaveLength(PERMISSIONS.length); // untouched
    expect((await send(t.app, "patch", `/api/roles/${mine}`, { name: "Manager" }, owner)).status).toBe(409); // name clash
  });

  it("replaces the permission grid: validates every cell against the catalogue, records what changed, and a role can be given a mode only if the catalogue allows it", async () => {
    const { owner } = await org();
    const id = (await post(t.app, "/api/roles", { name: "Auditor" }, owner)).body.data.id as string;
    const ok = await send(t.app, "put", `/api/roles/${id}/permissions`, { grants: [{ permission: "okr.view", mode: "all_in_scope" }, { permission: "okr.view", mode: "own" }, { permission: "org.view", mode: "reports" }] }, owner);
    expect(ok.status).toBe(200);
    expect(ok.body.data.permissionCount).toBe(2);
    expect((await detail(owner, id)).permissions.find((p) => p.key === "okr.view")!.modes.sort()).toEqual(["all_in_scope", "own"]);
    // unknown permission, a mode the catalogue does not allow (roles.manage is all_in_scope only), an invalid mode word
    expect((await send(t.app, "put", `/api/roles/${id}/permissions`, { grants: [{ permission: "made.up", mode: "own" }] }, owner)).status).toBe(400);
    const badMode = await send(t.app, "put", `/api/roles/${id}/permissions`, { grants: [{ permission: "roles.manage", mode: "own" }] }, owner);
    expect(badMode.status).toBe(400);
    expect(JSON.stringify(badMode.body)).toMatch(/cannot be given in the own mode/);
    expect((await send(t.app, "put", `/api/roles/${id}/permissions`, { grants: [{ permission: "okr.view", mode: "everyone" }] }, owner)).status).toBe(400);
    expect((await detail(owner, id)).permissions).toHaveLength(2); // refusals changed nothing
    const a = audits("role.permissions.update");
    expect(a).toHaveLength(1);
    expect(JSON.parse(a[0]!.after_json!)).toMatchObject({ added: ["okr.view:all_in_scope", "okr.view:own", "org.view:reports"] });
    // a second edit records both what was added and what was removed
    await send(t.app, "put", `/api/roles/${id}/permissions`, { grants: [{ permission: "okr.view", mode: "own" }, { permission: "kpi.view", mode: "own" }] }, owner);
    const second = audits("role.permissions.update")[1]!;
    expect(JSON.parse(second.before_json!).removed.sort()).toEqual(["okr.view:all_in_scope", "org.view:reports"]);
    expect(JSON.parse(second.after_json!).added).toEqual(["kpi.view:own"]);
  });

  it("adding a SENSITIVE permission needs an explicit confirmation, and the audit row says so", async () => {
    const { owner } = await org();
    const id = (await post(t.app, "/api/roles", { name: "Reviewer" }, owner)).body.data.id as string;
    expect(permissionByKey("performance.view_scores")!.sensitive).toBe(true);
    const grants = [{ permission: "performance.view_scores", mode: "reports" }, { permission: "okr.view", mode: "own" }];
    const first = await send(t.app, "put", `/api/roles/${id}/permissions`, { grants }, owner);
    expect(first.status).toBe(400);
    expect(first.body.error.code).toBe("sensitive_confirmation_required");
    expect(first.body.error.details).toEqual({ permissions: ["performance.view_scores"] });
    expect((await detail(owner, id)).permissions).toHaveLength(0);
    const confirmed = await send(t.app, "put", `/api/roles/${id}/permissions`, { grants, confirmSensitive: true }, owner);
    expect(confirmed.status).toBe(200);
    const a = audits("role.permissions.update")[0]!;
    expect(a.summary).toMatch(/including sensitive permissions/);
    expect(JSON.parse(a.after_json!).sensitiveAdded).toEqual(["performance.view_scores"]);
    // removing a sensitive permission needs no confirmation
    expect((await send(t.app, "put", `/api/roles/${id}/permissions`, { grants: [{ permission: "okr.view", mode: "own" }] }, owner)).status).toBe(200);
  });

  it("you cannot ADD a permission you do not hold (403), but you can always take permissions away", async () => {
    const { owner, ids } = await org();
    // a custom role that may manage roles (roles.manage + roles.view) but holds little else
    const rm = (await post(t.app, "/api/roles", { name: "Role Manager" }, owner)).body.data.id as string;
    await send(t.app, "put", `/api/roles/${rm}/permissions`, { grants: [{ permission: "roles.manage", mode: "all_in_scope" }, { permission: "roles.view", mode: "all_in_scope" }, { permission: "okr.view", mode: "own" }], confirmSensitive: true }, owner);
    const rmPerson = await addPerson(t.app, owner, "rm@example.com", rm, "Role Manager");
    const target = (await post(t.app, "/api/roles", { name: "Target" }, owner)).body.data.id as string;
    await send(t.app, "put", `/api/roles/${target}/permissions`, { grants: [{ permission: "okr.view", mode: "own" }, { permission: "kpi.view", mode: "own" }], confirmSensitive: true }, owner);
    // adding something the role manager does not hold
    const tooMuch = await send(t.app, "put", `/api/roles/${target}/permissions`, { grants: [{ permission: "okr.view", mode: "own" }, { permission: "kpi.view", mode: "own" }, { permission: "task.view", mode: "own" }] }, rmPerson.cookie);
    expect(tooMuch.status).toBe(403);
    expect(tooMuch.body.error.code).toBe("cannot_grant_permission");
    // a mode wider than they hold (they hold okr.view as own only)
    expect((await send(t.app, "put", `/api/roles/${target}/permissions`, { grants: [{ permission: "okr.view", mode: "all_in_scope" }, { permission: "kpi.view", mode: "own" }] }, rmPerson.cookie)).status).toBe(403);
    // removing (even what they do not hold) is allowed
    const trim = await send(t.app, "put", `/api/roles/${target}/permissions`, { grants: [{ permission: "okr.view", mode: "own" }] }, rmPerson.cookie);
    expect(trim.status).toBe(200);
    expect((await detail(owner, target)).permissions.map((p) => p.key)).toEqual(["okr.view"]);
    // and they cannot copy a role bigger than their own
    expect((await post(t.app, "/api/roles", { name: "Big Copy", copyFromRoleId: ids.ceo }, rmPerson.cookie)).status).toBe(403);
    expect(audits("role.permissions.update").at(-1)!.actor_membership_id).toBe(rmPerson.membershipId);
  });

  it("archiving: refused while people hold the role (409 role_in_use, with the count), allowed once nobody does; archived roles grant nothing", async () => {
    const { owner } = await org();
    const id = (await post(t.app, "/api/roles", { name: "Temp Role" }, owner)).body.data.id as string;
    await send(t.app, "put", `/api/roles/${id}/permissions`, { grants: [{ permission: "org.view", mode: "all_in_scope" }] }, owner);
    const person = await addPerson(t.app, owner, "p@example.com", id, "P");
    const refused = await post(t.app, `/api/roles/${id}/archive`, undefined, owner);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("role_in_use");
    expect(refused.body.error.details).toEqual({ holders: 1 });
    const assignment = (await get(t.app, `/api/role-assignments?membershipId=${person.membershipId}`, owner)).body.data[0].id as string;
    expect((await post(t.app, `/api/role-assignments/${assignment}/revoke`, undefined, owner)).status).toBe(200);
    expect((await post(t.app, `/api/roles/${id}/archive`, undefined, owner)).status).toBe(200);
    expect(((await get(t.app, "/api/roles", owner)).body.data as { id: string }[]).some((r) => r.id === id)).toBe(false);
    expect(audits("role.archive")).toHaveLength(1);
    expect((await post(t.app, "/api/roles", { name: "Temp Role" }, owner)).status).toBe(201); // the name is free again
  });

  it("only people with roles.manage (organization-wide) can edit roles; others get 403, signed out 401", async () => {
    const { owner, ids } = await org();
    const emp = await addPerson(t.app, owner, "emp@example.com", ids.employee);
    const ceo = await addPerson(t.app, owner, "ceo@example.com", ids.ceo); // roles.view but not roles.manage
    for (const cookie of [emp.cookie, ceo.cookie]) {
      expect((await post(t.app, "/api/roles", { name: "Nope Role" }, cookie)).status).toBe(403);
      expect((await send(t.app, "patch", `/api/roles/${ids.manager}`, { name: "Hijack" }, cookie)).status).toBe(403);
    }
    expect((await post(t.app, "/api/roles", { name: "Nope Role" })).status).toBe(401);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM roles WHERE name IN ('Nope Role','Hijack')").n).toBe(0);
  });
});

describe("assigning roles (including to someone who joined with no role)", () => {
  it("gives a person who joined with no role a role: their capabilities change on their very next request", async () => {
    const { owner, ids } = await org();
    const piyush = await addPerson(t.app, owner, "piyush@example.com", undefined, "Piyush"); // like the live account: joined, no role
    expect((await get(t.app, "/api/auth/me", piyush.cookie)).body.data.capabilities).toEqual({});
    expect((await get(t.app, "/api/roles", piyush.cookie)).status).toBe(403);
    const res = await post(t.app, "/api/role-assignments", { membershipId: piyush.membershipId, roleId: ids.ceo }, owner);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ roleName: "CEO", scopeType: "organization", state: "active", validTo: null });
    const me = (await get(t.app, "/api/auth/me", piyush.cookie)).body.data;
    expect(me.roles).toEqual([{ key: "ceo", name: "CEO" }]);
    expect(Object.keys(me.capabilities).length).toBeGreaterThan(20);
    expect((await get(t.app, "/api/roles", piyush.cookie)).status).toBe(200); // the CEO template has roles.view
    expect(audits("role_assignment.create")[0]!.summary).toBe('Gave Piyush the role "CEO"');
  });

  it("a role with an end date works until then; scheduled and ended assignments are shown with their state", async () => {
    const { owner, ids } = await org();
    const p = await addPerson(t.app, owner, "p@example.com", undefined, "P");
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const a = await post(t.app, "/api/role-assignments", { membershipId: p.membershipId, roleId: ids.ceo, validTo: soon }, owner);
    expect(a.status).toBe(201);
    expect((await get(t.app, "/api/roles", p.cookie)).status).toBe(200);
    t.db.prepare("UPDATE user_role_assignments SET valid_to = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), a.body.data.id);
    expect((await get(t.app, "/api/roles", p.cookie)).status).toBe(403); // ended
    const list = (await get(t.app, `/api/role-assignments?membershipId=${p.membershipId}`, owner)).body.data as { state: string }[];
    expect(list.map((x) => x.state)).toEqual(["ended"]);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const later = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const sched = await post(t.app, "/api/role-assignments", { membershipId: p.membershipId, roleId: ids.employee, validFrom: future, validTo: later }, owner);
    expect(sched.body.data.state).toBe("scheduled");
  });

  it("validates: dates in order and in the future, a department or team needs its id and an unknown scope is refused, no duplicates, unknown people and roles are 404", async () => {
    const { owner, ids } = await org();
    const p = await addPerson(t.app, owner, "p@example.com", undefined, "P");
    const body = { membershipId: p.membershipId, roleId: ids.employee };
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect((await post(t.app, "/api/role-assignments", { ...body, validTo: past }, owner)).status).toBe(400);
    expect((await post(t.app, "/api/role-assignments", { ...body, validFrom: new Date(Date.now() + 5 * 86_400_000).toISOString(), validTo: new Date(Date.now() + 2 * 86_400_000).toISOString() }, owner)).status).toBe(400);
    const scope = await post(t.app, "/api/role-assignments", { ...body, scopeType: "department" }, owner);
    expect(scope.status).toBe(400);
    expect(scope.body.error.code).toBe("validation_failed");
    expect((await post(t.app, "/api/role-assignments", { ...body, scopeType: "planet" }, owner)).body.error.code).toBe("scope_not_available");
    expect((await post(t.app, "/api/role-assignments", body, owner)).status).toBe(201);
    const dup = await post(t.app, "/api/role-assignments", body, owner);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("already_assigned");
    expect((await post(t.app, "/api/role-assignments", { ...body, membershipId: "11111111-1111-4111-8111-111111111111" }, owner)).status).toBe(404);
    expect((await post(t.app, "/api/role-assignments", { ...body, roleId: "11111111-1111-4111-8111-111111111111" }, owner)).status).toBe(404);
    expect((await post(t.app, "/api/role-assignments", { ...body, extra: 1 }, owner)).status).toBe(400);
    // a person who only has an invitation cannot be given a role yet
    const pending = await post(t.app, "/api/invitations", { email: "later@example.com" }, owner);
    expect((await post(t.app, "/api/role-assignments", { membershipId: pending.body.data.invitation.membershipId, roleId: ids.employee }, owner)).status).toBe(404);
  });

  it("you cannot assign or revoke a role whose permissions you do not hold (403)", async () => {
    const { owner, ids } = await org();
    const ceo = await addPerson(t.app, owner, "ceo@example.com", ids.ceo);
    // the CEO may not manage roles unless given roles.manage: make a custom role that can
    const rm = (await post(t.app, "/api/roles", { name: "Role Manager" }, owner)).body.data.id as string;
    await send(t.app, "put", `/api/roles/${rm}/permissions`, { grants: [{ permission: "roles.manage", mode: "all_in_scope" }, { permission: "roles.view", mode: "all_in_scope" }, { permission: "org.view", mode: "all_in_scope" }], confirmSensitive: true }, owner);
    const mgr = await addPerson(t.app, owner, "mgr@example.com", rm, "Role Manager");
    const target = await addPerson(t.app, owner, "target@example.com", undefined, "Target");
    const tooBig = await post(t.app, "/api/role-assignments", { membershipId: target.membershipId, roleId: ids.owner }, mgr.cookie);
    expect(tooBig.status).toBe(403);
    expect(tooBig.body.error.code).toBe("cannot_grant_role");
    expect((await post(t.app, "/api/role-assignments", { membershipId: target.membershipId, roleId: ids.ceo }, mgr.cookie)).status).toBe(403); // the CEO role has more than a Role Manager holds
    // the owner gave CEO to the CEO person already; the Role Manager cannot take it away either
    const ceoAssignment = (await get(t.app, `/api/role-assignments?membershipId=${ceo.membershipId}`, owner)).body.data[0].id as string;
    expect((await post(t.app, `/api/role-assignments/${ceoAssignment}/revoke`, undefined, mgr.cookie)).status).toBe(403);
    // a role within their reach works
    expect((await post(t.app, "/api/role-assignments", { membershipId: target.membershipId, roleId: rm }, mgr.cookie)).status).toBe(201);
  });

  it("revoking works and is audited; a second revoke is a conflict; the person loses the permissions at once", async () => {
    const { owner, ids } = await org();
    const p = await addPerson(t.app, owner, "p@example.com", ids.ceo, "P");
    const aid = (await get(t.app, `/api/role-assignments?membershipId=${p.membershipId}`, owner)).body.data[0].id as string;
    expect((await get(t.app, "/api/roles", p.cookie)).status).toBe(200);
    const r = await post(t.app, `/api/role-assignments/${aid}/revoke`, undefined, owner);
    expect(r.status).toBe(200);
    expect(r.body.data.state).toBe("revoked");
    expect((await get(t.app, "/api/roles", p.cookie)).status).toBe(403);
    expect((await post(t.app, `/api/role-assignments/${aid}/revoke`, undefined, owner)).status).toBe(409);
    expect(audits("role_assignment.revoke")[0]!.summary).toBe('Took the role "CEO" away from P');
  });
});

describe("the last administrator is protected", () => {
  it("revoking the last administrator's role is refused (409 last_admin) and nothing changes; with a second administrator it works", async () => {
    const { owner, ids } = await org();
    const ownerM = one<{ id: string }>("SELECT id FROM organization_memberships WHERE work_email = 'owner@example.com'").id;
    const ownerAssignment = (await get(t.app, `/api/role-assignments?membershipId=${ownerM}`, owner)).body.data[0].id as string;
    const refused = await post(t.app, `/api/role-assignments/${ownerAssignment}/revoke`, undefined, owner);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("last_admin");
    expect(one<{ revoked_at: string | null }>("SELECT revoked_at FROM user_role_assignments WHERE id = ?", ownerAssignment).revoked_at).toBeNull(); // rolled back whole
    expect(audits("role_assignment.revoke")).toHaveLength(0); // and no audit row for a change that did not happen
    const second = await addPerson(t.app, owner, "second@example.com", ids.owner, "Second");
    expect((await post(t.app, `/api/role-assignments/${ownerAssignment}/revoke`, undefined, owner)).status).toBe(200);
    // now the second one is the last
    const secondAssignment = (await get(t.app, `/api/role-assignments?membershipId=${second.membershipId}`, second.cookie)).body.data[0].id as string;
    expect((await post(t.app, `/api/role-assignments/${secondAssignment}/revoke`, undefined, second.cookie)).body.error.code).toBe("last_admin");
  });

  it("when administration comes only from an ordinary role, editing that role (or revoking it) so nobody administers is refused and rolled back whole", async () => {
    const { owner } = await org();
    const adminRole = (await post(t.app, "/api/roles", { name: "Admins" }, owner)).body.data.id as string;
    const grants = [{ permission: "roles.manage", mode: "all_in_scope" }, { permission: "org.settings", mode: "all_in_scope" }, { permission: "roles.view", mode: "all_in_scope" }];
    await send(t.app, "put", `/api/roles/${adminRole}/permissions`, { grants, confirmSensitive: true }, owner);
    const a = await addPerson(t.app, owner, "a@example.com", adminRole, "Admin A");
    const ownerM = one<{ id: string }>("SELECT id FROM organization_memberships WHERE work_email = 'owner@example.com'").id;
    const oa = (await get(t.app, `/api/role-assignments?membershipId=${ownerM}`, owner)).body.data[0].id as string;
    expect((await post(t.app, `/api/role-assignments/${oa}/revoke`, undefined, owner)).status).toBe(200); // Admin A still administers, so the Owner may step down
    // Admin A is now the ONLY administrator, through an ordinary role
    const auditBefore = one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs").n;
    for (const mode of ["roles.manage", "org.settings"]) {
      const without = await send(t.app, "put", `/api/roles/${adminRole}/permissions`, { grants: grants.filter((g) => g.permission !== mode) }, a.cookie);
      expect(without.status, `removing ${mode}`).toBe(409);
      expect(without.body.error.code).toBe("last_admin");
    }
    expect((await detail(a.cookie, adminRole)).permissions).toHaveLength(3); // rolled back whole
    const aa = (await get(t.app, `/api/role-assignments?membershipId=${a.membershipId}`, a.cookie)).body.data[0].id as string;
    expect((await post(t.app, `/api/role-assignments/${aa}/revoke`, undefined, a.cookie)).body.error.code).toBe("last_admin");
    expect((await post(t.app, `/api/roles/${adminRole}/archive`, undefined, a.cookie)).body.error.code).toBe("role_in_use");
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs").n).toBe(auditBefore); // refused changes leave no audit row
    // other edits are fine
    expect((await send(t.app, "patch", `/api/roles/${adminRole}`, { description: "The administrators" }, a.cookie)).status).toBe(200);
  });
});

describe("removing a person from the organization", () => {
  it("removes them: the login stays, their roles end, their sessions point at no organization, and they can create an organization", async () => {
    const { owner, ids } = await org();
    const sam = await addPerson(t.app, owner, "sam@example.com", ids.employee, "Sam Rivera");
    expect((await get(t.app, "/api/organization", sam.cookie)).status).toBe(200);
    const res = await post(t.app, `/api/people/${sam.membershipId}/remove`, undefined, owner);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ removed: true });
    // the login is still there: Sam is signed in, but belongs to nothing
    const me = (await get(t.app, "/api/auth/me", sam.cookie)).body.data;
    expect(me).toMatchObject({ user: { email: "sam@example.com" }, organization: null, needsOnboarding: true, roles: [], capabilities: {} });
    expect((await get(t.app, "/api/organization", sam.cookie)).status).toBe(403);
    const again = await post(t.app, "/api/auth/login", { email: "sam@example.com", password: "correct horse battery" });
    expect(again.status).toBe(200);
    expect(again.body.data.organization).toBeNull();
    // they can create their own organization
    expect((await post(t.app, "/api/organizations", { name: "Sam's Own Co" }, sam.cookie)).status).toBe(201);
    // the old organization no longer lists them; the membership keeps the name for history but is detached
    const members = (await get(t.app, "/api/organization/members", owner)).body.data as { displayName: string }[];
    expect(members.map((m) => m.displayName)).toEqual(["Test Person"]); // only the organization's owner remains
    expect(one<{ status: string; user_id: string | null; display_name: string }>("SELECT status, user_id, display_name FROM organization_memberships WHERE id = ?", sam.membershipId)).toEqual({ status: "left", user_id: null, display_name: "Sam Rivera" });
    expect(audits("person.remove")[0]!.summary).toBe("Removed Sam Rivera from the organization (their login stays)");
  });

  it("a removed person can be invited back (their old membership does not clash with the new one)", async () => {
    const { owner, ids } = await org();
    const sam = await addPerson(t.app, owner, "sam@example.com", ids.employee, "Sam");
    await post(t.app, `/api/people/${sam.membershipId}/remove`, undefined, owner);
    const inv = await post(t.app, "/api/invitations", { email: "sam@example.com", roleId: ids.employee }, owner);
    expect(inv.status).toBe(201);
    const login = await post(t.app, "/api/auth/login", { email: "sam@example.com", password: "correct horse battery" });
    const cookie = login.headers["set-cookie"]![0]!.split(";")[0]!;
    const back = await post(t.app, "/api/auth/accept-invitation", { code: inv.body.data.code }, cookie);
    expect(back.status).toBe(200);
    expect(back.body.data.organization.name).toBe("Acme");
  });

  it("refuses removing yourself (use Delete my account), someone who never joined, the last administrator, and anyone outside your scope", async () => {
    const { owner, ids } = await org();
    const ownerM = one<{ id: string }>("SELECT id FROM organization_memberships WHERE work_email = 'owner@example.com'").id;
    expect((await post(t.app, `/api/people/${ownerM}/remove`, undefined, owner)).body.error.code).toBe("use_delete_account");
    const pending = await post(t.app, "/api/invitations", { email: "later@example.com" }, owner);
    expect((await post(t.app, `/api/people/${pending.body.data.invitation.membershipId}/remove`, undefined, owner)).status).toBe(409);
    // a second administrator removes the first: the guard sees that the second remains, so it works; removing the last one is refused
    const second = await addPerson(t.app, owner, "second@example.com", ids.owner, "Second");
    expect((await post(t.app, `/api/people/${ownerM}/remove`, undefined, second.cookie)).status).toBe(200);
    expect((await post(t.app, `/api/people/${second.membershipId}/remove`, undefined, second.cookie)).body.error.code).toBe("use_delete_account");
    expect((await post(t.app, `/api/people/${"1".repeat(8)}-1111-4111-8111-${"1".repeat(12)}/remove`, undefined, second.cookie)).status).toBe(404);
  });

  it("a manager-level role cannot remove people outside their scope, and an employee cannot remove anyone", async () => {
    const { owner, ids } = await org();
    const emp = await addPerson(t.app, owner, "emp@example.com", ids.employee, "Emp");
    const target = await addPerson(t.app, owner, "target@example.com", undefined, "Target");
    expect((await post(t.app, `/api/people/${target.membershipId}/remove`, undefined, emp.cookie)).status).toBe(403);
    const mgr = await addPerson(t.app, owner, "mgr@example.com", ids.manager, "Mgr"); // people.manage at reports: with no hierarchy, only themselves
    expect((await post(t.app, `/api/people/${target.membershipId}/remove`, undefined, mgr.cookie)).status).toBe(404);
    expect(one<{ status: string }>("SELECT status FROM organization_memberships WHERE id = ?", target.membershipId).status).toBe("active");
  });
});

describe("organization member count", () => {
  it("counts only people who have joined and still belong (not invited, not left)", async () => {
    const { owner, ids } = await org();
    expect((await get(t.app, "/api/organization", owner)).body.data.memberCount).toBe(1);
    const sam = await addPerson(t.app, owner, "sam@example.com", ids.employee);
    await post(t.app, "/api/invitations", { email: "later@example.com" }, owner);
    expect((await get(t.app, "/api/organization", owner)).body.data.memberCount).toBe(2);
    await post(t.app, `/api/people/${sam.membershipId}/remove`, undefined, owner);
    expect((await get(t.app, "/api/organization", owner)).body.data.memberCount).toBe(1);
  });
});
