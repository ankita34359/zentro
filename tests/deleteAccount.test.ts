import { afterEach, describe, expect, it } from "vitest";
import { ORGANIZATION_TABLES_IN_DELETE_ORDER } from "../backend/src/modules/auth/repositories/erasure.js";
import { FAKE_ENV, type TestApp } from "./helpers/app.js";
import { cookieFrom, get, invite, makeAuthApp, PASSWORD, post, signUp, signUpWithOrg, TEST_CODE } from "./helpers/auth.js";
import { addPerson, roleIds } from "./helpers/roles.js";

let t: TestApp;
afterEach(() => t?.cleanup());
const one = <T>(sql: string, ...p: unknown[]) => t.db.prepare(sql).get(...p) as T;
const all = <T>(sql: string, ...p: unknown[]) => t.db.prepare(sql).all(...p) as T[];
const del = (cookie: string, body: Record<string, unknown>) => post(t.app, "/api/auth/delete-account", body, cookie);
const preview = (cookie: string) => get(t.app, "/api/auth/delete-account/preview", cookie);

describe("Delete my account: the preview warns before anything happens", () => {
  it("says what would be deleted: a person who is not in an organization, the only member, and a member of a busy organization", async () => {
    t = makeAuthApp();
    const lone = await signUp(t.app, "lone@example.com");
    expect((await preview(lone)).body.data).toMatchObject({ mode: "account_only", organizationName: null });

    const solo = await signUpWithOrg(t.app, "solo@example.com", "Solo Co");
    expect((await preview(solo)).body.data).toMatchObject({ mode: "account_and_organization", organizationName: "Solo Co", others: 0, pendingInvitations: 0, reason: null });

    const ids = await roleIds(t.app, solo);
    await addPerson(t.app, solo, "second@example.com", ids.employee);
    expect((await preview(solo)).body.data).toMatchObject({ mode: "blocked", reason: "last_admin", others: 1 });
    expect((await get(t.app, "/api/auth/delete-account/preview")).status).toBe(401);
  });

  it("with only pending invitations left, the organization is NOT deleted: blocked until they are revoked", async () => {
    t = makeAuthApp();
    const solo = await signUpWithOrg(t.app, "solo@example.com", "Solo Co");
    const inv = await invite(t.app, solo, "later@example.com");
    expect((await preview(solo)).body.data).toMatchObject({ mode: "blocked", reason: "pending_invitations", pendingInvitations: 1 });
    await post(t.app, `/api/invitations/${inv.invitation.id}/revoke`, undefined, solo);
    expect((await preview(solo)).body.data).toMatchObject({ mode: "account_and_organization" });
  });
});

describe("Delete my account: the only member deletes the whole organization", () => {
  it("needs the password, the email typed again, AND the organization's name; then everything of that organization is gone and the cookie is cleared", async () => {
    t = makeAuthApp();
    const solo = await signUpWithOrg(t.app, "solo@example.com", "Solo Co");
    expect((await del(solo, { password: "not my password", confirmEmail: "solo@example.com", confirmOrganizationName: "Solo Co" })).status).toBe(403);
    expect((await del(solo, { password: PASSWORD, confirmEmail: "someone.else@example.com", confirmOrganizationName: "Solo Co" })).status).toBe(400);
    const noName = await del(solo, { password: PASSWORD, confirmEmail: "solo@example.com" });
    expect(noName.status).toBe(400);
    expect(noName.body.error.code).toBe("organization_confirmation_required");
    expect(noName.body.error.details).toEqual({ organizationName: "Solo Co" });
    expect((await del(solo, { password: PASSWORD, confirmEmail: "solo@example.com", confirmOrganizationName: "solo co" })).status).toBe(400);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM organizations").n).toBe(1); // nothing happened yet

    const ok = await del(solo, { password: PASSWORD, confirmEmail: "SOLO@example.com", confirmOrganizationName: "Solo Co" });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ deleted: true, organizationDeleted: true });
    expect(([] as string[]).concat(ok.headers["set-cookie"] ?? []).join()).toMatch(/zentro_session=;.*Max-Age=0/);
    for (const table of ["organizations", "users", "sessions", "organization_memberships", "roles", "role_permissions", "user_role_assignments", "invitations", "auth_tokens"]) {
      expect(one<{ n: number }>(`SELECT COUNT(*) n FROM ${table}`).n, table).toBe(0);
    }
    expect((await get(t.app, "/api/auth/me", solo)).status).toBe(401);
    expect((await post(t.app, "/api/auth/login", { email: "solo@example.com", password: PASSWORD })).status).toBe(401);
  });

  it("the email can register again afterwards (the login really is gone)", async () => {
    t = makeAuthApp();
    const solo = await signUpWithOrg(t.app, "solo@example.com", "Solo Co");
    await del(solo, { password: PASSWORD, confirmEmail: "solo@example.com", confirmOrganizationName: "Solo Co" });
    expect((await post(t.app, "/api/auth/register", { email: "solo@example.com", name: "New", password: PASSWORD, registrationCode: TEST_CODE })).status).toBe(202);
    expect((await post(t.app, "/api/auth/login", { email: "solo@example.com", password: PASSWORD })).status).toBe(200);
  });

  it("covers every table that holds organization rows: a table added later without cleanup fails this test", () => {
    t = makeAuthApp();
    const tables = all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map((r) => r.name);
    const withOrg = tables.filter((n) => all<{ name: string }>(`PRAGMA table_info(${n})`).some((c) => c.name === "organization_id"));
    const global = new Set(["scheduled_job_runs"]); // operational log, handled separately by deleteOrganization
    expect(withOrg.filter((n) => !global.has(n)).sort()).toEqual([...ORGANIZATION_TABLES_IN_DELETE_ORDER].sort());
  });

  it("deleting organization A's only member leaves organization B completely untouched (cross-tenant)", async () => {
    t = makeAuthApp();
    const a = await signUpWithOrg(t.app, "a@example.com", "Alpha Co");
    const b = await signUpWithOrg(t.app, "b@example.com", "Beta Co");
    const idsB = await roleIds(t.app, b);
    await addPerson(t.app, b, "b2@example.com", idsB.employee);
    await invite(t.app, b, "pending-b@example.com");
    const snap = () => JSON.stringify(["organization_memberships", "roles", "role_permissions", "user_role_assignments", "invitations"].map((n) => all(`SELECT * FROM ${n} WHERE organization_id = (SELECT id FROM organizations WHERE name = 'Beta Co') ORDER BY 1, 2`)));
    const before = snap();
    expect((await del(a, { password: PASSWORD, confirmEmail: "a@example.com", confirmOrganizationName: "Alpha Co" })).status).toBe(200);
    expect(snap()).toBe(before);
    expect((await get(t.app, "/api/organization", b)).body.data).toMatchObject({ name: "Beta Co", memberCount: 2 }); // the owner and one joined person; the pending invitation is not a member
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM organizations").n).toBe(1);
  });
});

describe("Delete my account: a member of an organization that continues", () => {
  it("a person with no administrator rights can leave: their login and personal details go, the organization continues and their roles end", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ids = await roleIds(t.app, owner);
    const sam = await addPerson(t.app, owner, "sam@example.com", ids.employee, "Sam Rivera");
    expect((await preview(sam.cookie)).body.data).toMatchObject({ mode: "account_only", organizationName: "Acme", others: 1 });

    const ok = await del(sam.cookie, { password: PASSWORD, confirmEmail: "sam@example.com" });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ deleted: true, organizationDeleted: false });
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM users WHERE email = 'sam@example.com'").n).toBe(0);
    expect(one<{ status: string; user_id: string | null; display_name: string; work_email: string | null }>("SELECT status, user_id, display_name, work_email FROM organization_memberships WHERE id = ?", sam.membershipId)).toMatchObject({
      status: "left", user_id: null, display_name: "Former member", work_email: null,
    });
    expect(one<{ revoked_at: string | null }>("SELECT revoked_at FROM user_role_assignments WHERE membership_id = ?", sam.membershipId).revoked_at).toBeTruthy();
    expect((await get(t.app, "/api/auth/me", sam.cookie)).status).toBe(401);
    expect((await get(t.app, "/api/organization", owner)).body.data).toMatchObject({ name: "Acme" });
    const members = (await get(t.app, "/api/organization/members", owner)).body.data as { displayName: string }[];
    expect(members).toHaveLength(1); // only the owner remains on the list
    expect(JSON.stringify(members)).not.toMatch(/Sam|sam@example.com/);
    expect((await post(t.app, "/api/invitations", { email: "sam@example.com" }, owner)).status).toBe(201); // can be invited again
  });

  it("the last administrator cannot delete their account while others remain (409 last_admin)", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    await addPerson(t.app, owner, "sam@example.com", (await roleIds(t.app, owner)).employee);
    const res = await del(owner, { password: PASSWORD, confirmEmail: "owner@example.com" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("last_admin");
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM users").n).toBe(2);
    expect((await get(t.app, "/api/auth/me", owner)).status).toBe(200);
  });

  it("once another administrator exists, the first may leave; the login row of the organization's creator stays as an empty tombstone and the email is free again", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const second = await addPerson(t.app, owner, "second@example.com", (await roleIds(t.app, owner)).owner, "Second");
    expect((await del(owner, { password: PASSWORD, confirmEmail: "owner@example.com" })).status).toBe(200);
    const tomb = one<{ email: string; name: string; password_hash: string | null; status: string }>("SELECT email, name, password_hash, status FROM users WHERE id = (SELECT created_by_user_id FROM organizations)");
    expect(tomb).toMatchObject({ name: "Deleted user", password_hash: null, status: "disabled" });
    expect(tomb.email).toMatch(/@deleted\.invalid$/);
    expect((await post(t.app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD })).status).toBe(401);
    expect((await get(t.app, "/api/roles", second.cookie)).status).toBe(200);
    expect((await post(t.app, "/api/auth/register", { email: "owner@example.com", name: "Again", password: PASSWORD, registrationCode: TEST_CODE })).status).toBe(202);
  });

  it("a person who never created an organization is deleted outright, with their sessions and reset links", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const sam = await addPerson(t.app, owner, "sam@example.com", (await roleIds(t.app, owner)).employee);
    const other = cookieFrom(await post(t.app, "/api/auth/login", { email: "sam@example.com", password: PASSWORD }))!;
    await post(t.app, `/api/people/${sam.membershipId}/reset-link`, undefined, owner);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM auth_tokens").n).toBe(1);
    await del(sam.cookie, { password: PASSWORD, confirmEmail: "sam@example.com" });
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM auth_tokens").n).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = 'sam@example.com'").n).toBe(0);
    expect((await get(t.app, "/api/auth/me", other)).status).toBe(401);
  });

  it("a person who has no organization yet can delete their account too", async () => {
    t = makeAuthApp();
    const lone = await signUp(t.app, "lone@example.com");
    expect((await del(lone, { password: PASSWORD, confirmEmail: "lone@example.com" })).status).toBe(200);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM users").n).toBe(0);
  });
});

describe("Delete my account: safety", () => {
  it("rate-limits wrong passwords (5), needs a signed-in person, and rejects unknown fields", async () => {
    t = makeAuthApp();
    const c = await signUp(t.app, "lone@example.com");
    for (let i = 0; i < 5; i++) expect((await del(c, { password: "wrong password", confirmEmail: "lone@example.com" })).status).toBe(403);
    expect((await del(c, { password: PASSWORD, confirmEmail: "lone@example.com" })).status).toBe(429);
    expect((await post(t.app, "/api/auth/delete-account", { password: PASSWORD, confirmEmail: "x@example.com" })).status).toBe(401);
    const d = await signUp(t.app, "d@example.com");
    expect((await del(d, { password: PASSWORD, confirmEmail: "d@example.com", organizationId: "x" })).status).toBe(400);
  });

  it("writes no password, email or organization name to the log", async () => {
    t = makeAuthApp();
    const solo = await signUpWithOrg(t.app, "solo@example.com", "Secret Org Name");
    await del(solo, { password: "wrong password here", confirmEmail: "solo@example.com", confirmOrganizationName: "Secret Org Name" });
    await del(solo, { password: PASSWORD, confirmEmail: "solo@example.com", confirmOrganizationName: "Secret Org Name" });
    const log = t.lines.join("\n");
    for (const secret of [PASSWORD, "wrong password here", "solo@example.com", "Secret Org Name", FAKE_ENV.SESSION_SECRET, TEST_CODE]) expect(log).not.toContain(secret);
    expect(log).toContain("account deleted");
  });
});
