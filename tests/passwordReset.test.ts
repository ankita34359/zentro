import { afterEach, describe, expect, it } from "vitest";
import { FAKE_ENV, type TestApp } from "./helpers/app.js";
import { acceptNew, get, invite, makeAuthApp, PASSWORD, post, signUp, signUpWithOrg, cookieFrom } from "./helpers/auth.js";

let t: TestApp;
afterEach(() => t?.cleanup());

const one = <T>(sql: string, ...p: unknown[]) => t.db.prepare(sql).get(...p) as T;
const past = () => new Date(Date.now() - 1000).toISOString();
const NEW_PASSWORD = "a brand new password";

/** An organization with an Owner and one joined member (Sam). Returns their cookies and Sam's membership id. */
async function setup() {
  t = makeAuthApp();
  const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
  const { code } = await invite(t.app, owner, "sam@example.com", "Sam");
  const { cookie: sam } = await acceptNew(t.app, code, "sam@example.com", "Sam");
  const samMembership = one<{ id: string }>("SELECT id FROM organization_memberships WHERE work_email = 'sam@example.com'").id;
  return { owner, sam: sam!, samMembership };
}
const resetLink = async (owner: string, membershipId: string) => {
  const r = await post(t.app, `/api/people/${membershipId}/reset-link`, undefined, owner);
  return { res: r, token: r.body?.data?.token as string };
};

describe("the administrator's reset link", () => {
  it("is generated for a person in the caller's organization: shown once, valid 1 hour, only its hash stored", async () => {
    const { owner, samMembership } = await setup();
    const { res, token } = await resetLink(owner, samMembership);
    expect(res.status).toBe(201);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.data).toMatchObject({ displayName: "Sam" });
    const life = Date.parse(res.body.data.expiresAt) - Date.now();
    expect(life).toBeGreaterThan(59 * 60_000);
    expect(life).toBeLessThanOrEqual(60 * 60_000);
    const row = one<{ token_hash: string; purpose: string; used_at: string | null }>("SELECT token_hash, purpose, used_at FROM auth_tokens");
    expect(row).toMatchObject({ purpose: "password_reset", used_at: null });
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(t.db.prepare("SELECT * FROM auth_tokens").all())).not.toContain(token);
  });

  it("refuses: someone who has not joined (409 no_login), yourself (409), a bad id (400), a non-owner (403), signed out (401)", async () => {
    const { owner, sam, samMembership } = await setup();
    const pending = await invite(t.app, owner, "later@example.com");
    expect((await resetLink(owner, pending.invitation.membershipId)).res.status).toBe(409);
    const ownerMembership = one<{ id: string }>("SELECT id FROM organization_memberships WHERE work_email = 'owner@example.com'").id;
    const self = await resetLink(owner, ownerMembership);
    expect(self.res.status).toBe(409);
    expect(self.res.body.error.code).toBe("use_change_password");
    expect((await post(t.app, "/api/people/not-a-uuid/reset-link", undefined, owner)).status).toBe(400);
    expect((await post(t.app, `/api/people/${ownerMembership}/reset-link`, undefined, sam)).status).toBe(403);
    expect((await post(t.app, `/api/people/${samMembership}/reset-link`)).status).toBe(401);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM auth_tokens").n).toBe(0);
  });

  it("a login that belongs to another organization is not this administrator's to reset (404)", async () => {
    const { owner, samMembership } = await setup();
    t.db.prepare("UPDATE users SET default_organization_id = (SELECT id FROM organizations LIMIT 1) WHERE 0").run();
    const other = (await signUpWithOrg(t.app, "owner-b@example.com", "Beta Co"), one<{ id: string }>("SELECT id FROM organizations WHERE name = 'Beta Co'").id);
    t.db.prepare("UPDATE users SET default_organization_id = ? WHERE email = 'sam@example.com'").run(other);
    expect((await resetLink(owner, samMembership)).res.status).toBe(404);
  });
});

describe("resetting with the link", () => {
  it("sets the new password, signs the person out EVERYWHERE, and the old password stops working", async () => {
    const { owner, sam, samMembership } = await setup();
    const second = cookieFrom(await post(t.app, "/api/auth/login", { email: "sam@example.com", password: PASSWORD }))!;
    expect((await get(t.app, "/api/auth/me", sam)).status).toBe(200);
    expect((await get(t.app, "/api/auth/me", second)).status).toBe(200);
    const { token } = await resetLink(owner, samMembership);

    const r = await post(t.app, "/api/auth/reset-password", { token, password: NEW_PASSWORD });
    expect(r.status).toBe(200);
    expect(r.headers["set-cookie"]).toBeUndefined(); // resetting does not sign anyone in
    expect((await get(t.app, "/api/auth/me", sam)).status).toBe(401);
    expect((await get(t.app, "/api/auth/me", second)).status).toBe(401);
    expect((await post(t.app, "/api/auth/login", { email: "sam@example.com", password: PASSWORD })).status).toBe(401);
    expect((await post(t.app, "/api/auth/login", { email: "sam@example.com", password: NEW_PASSWORD })).status).toBe(200);
    expect((await get(t.app, "/api/auth/me", owner)).status).toBe(200); // only that person's sessions
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = 'sam@example.com' AND s.revoked_at IS NULL").n).toBe(1); // the new login only
  });

  it("is single use (410 reset_link_used), also when two requests race", async () => {
    const { owner, samMembership } = await setup();
    const { token } = await resetLink(owner, samMembership);
    expect((await post(t.app, "/api/auth/reset-password", { token, password: NEW_PASSWORD })).status).toBe(200);
    const again = await post(t.app, "/api/auth/reset-password", { token, password: "yet another password" });
    expect(again.status).toBe(410);
    expect(again.body.error.code).toBe("reset_link_used");
    expect((await post(t.app, "/api/auth/login", { email: "sam@example.com", password: NEW_PASSWORD })).status).toBe(200);

    const { token: t2 } = await resetLink(owner, samMembership);
    const race = await Promise.all([1, 2, 3].map((i) => post(t.app, "/api/auth/reset-password", { token: t2, password: `race password number ${i}` })));
    expect(race.filter((r) => r.status === 200)).toHaveLength(1);
    for (const r of race.filter((x) => x.status !== 200)) expect(r.status).toBe(410);
  });

  it("expires after 1 hour (410 reset_link_expired) and changes nothing", async () => {
    const { owner, samMembership } = await setup();
    const { token } = await resetLink(owner, samMembership);
    t.db.prepare("UPDATE auth_tokens SET expires_at = ?").run(past());
    const r = await post(t.app, "/api/auth/reset-password", { token, password: NEW_PASSWORD });
    expect(r.status).toBe(410);
    expect(r.body.error.code).toBe("reset_link_expired");
    expect((await post(t.app, "/api/auth/login", { email: "sam@example.com", password: PASSWORD })).status).toBe(200); // old password still works
  });

  it("a newer link replaces the older one (410 reset_link_revoked)", async () => {
    const { owner, samMembership } = await setup();
    const first = await resetLink(owner, samMembership);
    const second = await resetLink(owner, samMembership);
    const old = await post(t.app, "/api/auth/reset-password", { token: first.token, password: NEW_PASSWORD });
    expect(old.status).toBe(410);
    expect(old.body.error.code).toBe("reset_link_revoked");
    expect((await post(t.app, "/api/auth/reset-password", { token: second.token, password: NEW_PASSWORD })).status).toBe(200);
  });

  it("an unknown or malformed token is 404 reset_link_invalid; a weak password is 400; both leave everything unchanged", async () => {
    const { owner, samMembership } = await setup();
    const { token } = await resetLink(owner, samMembership);
    for (const bad of ["x".repeat(43), "short", "a".repeat(80)]) {
      const r = await post(t.app, "/api/auth/reset-password", { token: bad, password: NEW_PASSWORD });
      expect([400, 404], bad.slice(0, 6)).toContain(r.status);
      if (r.status === 404) expect(r.body.error.code).toBe("reset_link_invalid");
    }
    expect((await post(t.app, "/api/auth/reset-password", { token, password: "short" })).status).toBe(400);
    expect((await post(t.app, "/api/auth/reset-password", { token, password: NEW_PASSWORD, extra: 1 })).status).toBe(400);
    expect((await post(t.app, "/api/auth/reset-password", { token, password: NEW_PASSWORD })).status).toBe(200); // the token survived the failed tries
  });

  it("clears a lockout caused by the forgotten password", async () => {
    const { owner, samMembership } = await setup();
    for (let i = 0; i < 8; i++) await post(t.app, "/api/auth/login", { email: "sam@example.com", password: "wrong password!" });
    expect((await post(t.app, "/api/auth/login", { email: "sam@example.com", password: PASSWORD })).status).toBe(429);
    const { token } = await resetLink(owner, samMembership);
    await post(t.app, "/api/auth/reset-password", { token, password: NEW_PASSWORD });
    expect((await post(t.app, "/api/auth/login", { email: "sam@example.com", password: NEW_PASSWORD })).status).toBe(200);
  });

  it("rate-limits wrong tokens per address (10), then refuses even a good link for a while", async () => {
    const { owner, samMembership } = await setup();
    const { token } = await resetLink(owner, samMembership);
    for (let i = 0; i < 10; i++) expect((await post(t.app, "/api/auth/reset-password", { token: String.fromCharCode(97 + i).repeat(43), password: NEW_PASSWORD })).status).toBe(404);
    const blocked = await post(t.app, "/api/auth/reset-password", { token, password: NEW_PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("rate_limited");
  });

  it("a disabled person's link does not work", async () => {
    const { owner, samMembership } = await setup();
    const { token } = await resetLink(owner, samMembership);
    t.db.prepare("UPDATE users SET status = 'disabled' WHERE email = 'sam@example.com'").run();
    expect((await post(t.app, "/api/auth/reset-password", { token, password: NEW_PASSWORD })).status).toBe(404);
  });
});

describe("forgot password", () => {
  it("answers the same (202, same body) for an existing and an unknown address, and creates no token", async () => {
    await setup();
    const known = await post(t.app, "/api/auth/forgot-password", { email: "sam@example.com" });
    const unknown = await post(t.app, "/api/auth/forgot-password", { email: "nobody@example.com" });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect({ ...known.body, meta: undefined }).toEqual({ ...unknown.body, meta: undefined });
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM auth_tokens").n).toBe(0);
    expect(known.body.data.message).toMatch(/administrator/i);
  });

  it("rate-limits per address (10 an hour) and per email (5 an hour), and rejects a malformed email", async () => {
    t = makeAuthApp();
    expect((await post(t.app, "/api/auth/forgot-password", { email: "not-an-email" })).status).toBe(400);
    for (let i = 0; i < 5; i++) expect((await post(t.app, "/api/auth/forgot-password", { email: "same@example.com" })).status).toBe(202);
    const perEmail = await post(t.app, "/api/auth/forgot-password", { email: "same@example.com" });
    expect(perEmail.status).toBe(429);
    for (let i = 0; i < 5; i++) await post(t.app, "/api/auth/forgot-password", { email: `other${i}@example.com` });
    const perIp = await post(t.app, "/api/auth/forgot-password", { email: "fresh@example.com" });
    expect(perIp.status).toBe(429);
  });

  it("hands the request to the delivery hook (where email will plug in) and nothing else", async () => {
    const asked: string[] = [];
    t = makeAuthApp({ delivery: { invitationIssued: () => undefined, passwordResetIssued: () => undefined, passwordResetRequested: (i) => asked.push(i.email) } });
    await post(t.app, "/api/auth/forgot-password", { email: "Sam@Example.com" });
    expect(asked).toEqual(["sam@example.com"]);
  });
});

describe("change password (signed in)", () => {
  it("needs the current password, signs out the other sessions, keeps this one, and the old password stops working", async () => {
    t = makeAuthApp();
    const here = await signUp(t.app, "ada@example.com");
    const elsewhere = cookieFrom(await post(t.app, "/api/auth/login", { email: "ada@example.com", password: PASSWORD }))!;
    const r = await post(t.app, "/api/auth/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, here);
    expect(r.status).toBe(200);
    expect((await get(t.app, "/api/auth/me", here)).status).toBe(200);
    expect((await get(t.app, "/api/auth/me", elsewhere)).status).toBe(401);
    expect((await post(t.app, "/api/auth/login", { email: "ada@example.com", password: PASSWORD })).status).toBe(401);
    expect((await post(t.app, "/api/auth/login", { email: "ada@example.com", password: NEW_PASSWORD })).status).toBe(200);
  });

  it("refuses a wrong current password (403, nothing changes), a weak or unchanged new one (400), and signed out (401)", async () => {
    t = makeAuthApp();
    const c = await signUp(t.app, "ada@example.com");
    const wrong = await post(t.app, "/api/auth/change-password", { currentPassword: "not my password", newPassword: NEW_PASSWORD }, c);
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe("current_password_incorrect");
    expect((await post(t.app, "/api/auth/change-password", { currentPassword: PASSWORD, newPassword: "short" }, c)).status).toBe(400);
    expect((await post(t.app, "/api/auth/change-password", { currentPassword: PASSWORD, newPassword: PASSWORD }, c)).status).toBe(400);
    expect((await post(t.app, "/api/auth/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).status).toBe(401);
    expect((await post(t.app, "/api/auth/login", { email: "ada@example.com", password: PASSWORD })).status).toBe(200);
  });

  it("rate-limits wrong current passwords per person (5)", async () => {
    t = makeAuthApp();
    const c = await signUp(t.app, "ada@example.com");
    for (let i = 0; i < 5; i++) expect((await post(t.app, "/api/auth/change-password", { currentPassword: "wrong password", newPassword: NEW_PASSWORD }, c)).status).toBe(403);
    const blocked = await post(t.app, "/api/auth/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, c);
    expect(blocked.status).toBe(429);
  });

  it("also cancels any unused reset link for that person", async () => {
    const { owner, sam, samMembership } = await setup();
    const { token } = await resetLink(owner, samMembership);
    await post(t.app, "/api/auth/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, sam);
    expect((await post(t.app, "/api/auth/reset-password", { token, password: "something else entirely" })).status).toBe(410);
  });
});

describe("cross-tenant: reset links", () => {
  it("B's administrator cannot create a reset link for A's people; A's link cannot be made by B's token", async () => {
    const { owner: ownerA, samMembership } = await setup();
    const ownerB = await signUpWithOrg(t.app, "owner-b@example.com", "Beta Co");
    expect((await post(t.app, `/api/people/${samMembership}/reset-link`, undefined, ownerB)).status).toBe(404);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM auth_tokens").n).toBe(0);
    expect((await resetLink(ownerA, samMembership)).res.status).toBe(201);
  });
});

describe("secrets never reach the log", () => {
  it("no token or password appears in any log line through reset, forgot and change", async () => {
    const { owner, sam, samMembership } = await setup();
    const { token } = await resetLink(owner, samMembership);
    await post(t.app, "/api/auth/forgot-password", { email: "sam@example.com" });
    await post(t.app, "/api/auth/reset-password", { token, password: NEW_PASSWORD });
    await post(t.app, "/api/auth/reset-password", { token, password: NEW_PASSWORD }); // reused
    await post(t.app, "/api/auth/change-password", { currentPassword: PASSWORD, newPassword: "never printed password" }, sam);
    const log = t.lines.join("\n");
    for (const secret of [token, NEW_PASSWORD, PASSWORD, "never printed password", "sam@example.com", FAKE_ENV.SESSION_SECRET]) expect(log).not.toContain(secret);
  });
});
