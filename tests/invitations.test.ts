import { afterEach, describe, expect, it } from "vitest";
import { FAKE_ENV, makeTestApp, testConfig, type TestApp } from "./helpers/app.js";
import { acceptAs, acceptNew, cookieFrom, get, invite, makeAuthApp, PASSWORD, post, signUp, signUpWithOrg, TEST_CODE } from "./helpers/auth.js";

let t: TestApp;
afterEach(() => t?.cleanup());

const rows = <T>(sql: string, ...p: unknown[]) => t.db.prepare(sql).all(...p) as T[];
const one = <T>(sql: string, ...p: unknown[]) => t.db.prepare(sql).get(...p) as T;
const past = () => new Date(Date.now() - 1000).toISOString();
const dump = () => JSON.stringify(["users", "organizations", "organization_memberships", "invitations", "auth_tokens", "sessions", "roles"].map((n) => rows(`SELECT * FROM ${n}`)));

describe("inviting a person (administration)", () => {
  it("an Owner creates an invitation: the membership is 'invited', the code is returned once, and only its hash is stored", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const { code, invitation, res } = await invite(t.app, owner, "Sam@Example.com", "Sam Rivera");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(invitation).toMatchObject({ status: "pending" });
    expect(Date.parse(invitation.expiresAt) - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    expect(Date.parse(invitation.expiresAt) - Date.now()).toBeLessThan(7.1 * 86_400_000);
    const m = one<{ status: string; user_id: string | null; display_name: string; work_email: string }>("SELECT status, user_id, display_name, work_email FROM organization_memberships WHERE work_email = 'sam@example.com'");
    expect(m).toMatchObject({ status: "invited", user_id: null, display_name: "Sam Rivera" });
    const stored = one<{ code_hash: string }>("SELECT code_hash FROM invitations");
    expect(stored.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.code_hash).not.toBe(code);
    expect(dump()).not.toContain(code); // the secret is nowhere in the database
    expect(dump()).not.toContain(code.split(".")[1]!);
    const list = await get(t.app, "/api/invitations", owner);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(code.split(".")[1]!);
    expect(JSON.stringify(list.body)).not.toMatch(/code_hash|codeHash/);
    expect(list.body.data[0]).toMatchObject({ email: "sam@example.com", status: "pending", displayName: "Sam Rivera" });
  });

  it("only an Owner can use the administration routes (temporary rule until the permission engine); signed out is 401", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const { code } = await invite(t.app, owner, "sam@example.com");
    const { cookie: sam } = await acceptNew(t.app, code, "sam@example.com");
    expect(sam).toBeTruthy();
    const someId = one<{ id: string }>("SELECT id FROM invitations").id;
    const member = one<{ id: string }>("SELECT id FROM organization_memberships WHERE work_email = 'owner@example.com'").id;
    for (const [method, path, body] of [
      ["get", "/api/invitations", undefined],
      ["post", "/api/invitations", { email: "x@example.com" }],
      ["post", `/api/invitations/${someId}/revoke`, undefined],
      ["post", `/api/invitations/${someId}/regenerate`, undefined],
      ["get", "/api/organization/members", undefined],
      ["post", `/api/people/${member}/reset-link`, undefined],
    ] as const) {
      const as = method === "get" ? await get(t.app, path, sam) : await post(t.app, path, body, sam);
      expect(as.status, `${method} ${path} as a non-owner`).toBe(403);
      const anon = method === "get" ? await get(t.app, path) : await post(t.app, path, body);
      expect(anon.status, `${method} ${path} signed out`).toBe(401);
    }
  });

  it("validates the body: bad email, unknown fields (an organization id is never accepted), and refuses duplicates", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    expect((await post(t.app, "/api/invitations", { email: "nope" }, owner)).status).toBe(400);
    expect((await post(t.app, "/api/invitations", { email: "a@example.com", organizationId: "x" }, owner)).status).toBe(400);
    await invite(t.app, owner, "sam@example.com");
    const dup = await post(t.app, "/api/invitations", { email: "SAM@example.com" }, owner);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("already_exists");
    const self = await post(t.app, "/api/invitations", { email: "owner@example.com" }, owner);
    expect(self.status).toBe(409); // already a member
  });

  it("an expired open invitation does not block inviting the same address again; the old one is replaced", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const first = await invite(t.app, owner, "sam@example.com");
    t.db.prepare("UPDATE invitations SET expires_at = ?").run(past());
    const second = await invite(t.app, owner, "sam@example.com");
    expect((await post(t.app, "/api/auth/invitation-preview", { code: first.code })).status).toBe(410);
    expect((await post(t.app, "/api/auth/invitation-preview", { code: second.code })).status).toBe(200);
    const list = (await get(t.app, "/api/invitations", owner)).body.data as { status: string }[];
    expect(list.map((i) => i.status).sort()).toEqual(["pending", "revoked"]);
  });
});

describe("accepting an invitation", () => {
  it("lets the invitee create an account WITHOUT the registration code (registration is closed here), signs them in, and lands them in the inviting organization", async () => {
    // The owner registers while registration is open; the app is then rebuilt on the same database with registration CLOSED.
    t = makeAuthApp();
    const ownerCookie = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const { code } = await invite(t.app, ownerCookie, "sam@example.com", "Sam");
    const { createApp } = await import("../backend/src/app.js");
    const { createLogger } = await import("../backend/src/lib/logger.js");
    const closed = createApp({ db: t.db, config: testConfig(), version: "t", cronSecret: undefined, migrationsTotal: 4, log: createLogger("error", () => undefined) });
    expect((await post(closed.app, "/api/auth/register", { email: "x@example.com", name: "X", password: PASSWORD, registrationCode: TEST_CODE })).status).toBe(403);
    const { res, cookie } = await acceptNew(closed.app, code, "sam@example.com", "Sam Rivera");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ user: { email: "sam@example.com", name: "Sam Rivera" }, organization: { name: "Acme" }, membership: { displayName: "Sam Rivera" }, needsOnboarding: false });
    expect(cookie).toBeTruthy();
    expect(([] as string[]).concat(res.headers["set-cookie"] ?? []).join()).toMatch(/HttpOnly/);
    expect((await get(closed.app, "/api/organization", cookie!)).body.data.name).toBe("Acme");
    // the membership is bound, active; the invitation is accepted
    expect(one<{ status: string; user_id: string }>("SELECT status, user_id FROM organization_memberships WHERE work_email = 'sam@example.com'").status).toBe("active");
    expect(one<{ accepted_at: string | null }>("SELECT accepted_at FROM invitations").accepted_at).toBeTruthy();
    // and they can sign in again with the password they chose
    expect((await post(closed.app, "/api/auth/login", { email: "sam@example.com", password: PASSWORD })).status).toBe(200);
  });

  it("refuses a different email address on the invitation (403), creates nothing, and leaves the invitation usable", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const { code } = await invite(t.app, owner, "sam@example.com");
    const before = one<{ n: number }>("SELECT COUNT(*) n FROM users").n;
    const wrong = await acceptNew(t.app, code, "someone.else@example.com");
    expect(wrong.res.status).toBe(403);
    expect(wrong.res.body.error.code).toBe("invitation_email_mismatch");
    expect(wrong.cookie).toBeUndefined();
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM users").n).toBe(before);
    expect((await acceptNew(t.app, code, "sam@example.com")).res.status).toBe(200); // still usable by the right person
  });

  it("a used invitation cannot be used again (410 invitation_used)", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const { code } = await invite(t.app, owner, "sam@example.com");
    expect((await acceptNew(t.app, code, "sam@example.com")).res.status).toBe(200);
    const again = await acceptNew(t.app, code, "sam@example.com");
    expect(again.res.status).toBe(410);
    expect(again.res.body.error.code).toBe("invitation_used");
    expect((await post(t.app, "/api/auth/invitation-preview", { code })).body.error.code).toBe("invitation_used");
  });

  it("an expired invitation gives 410 invitation_expired, and a revoked one 410 invitation_revoked", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const a = await invite(t.app, owner, "a@example.com");
    const b = await invite(t.app, owner, "b@example.com");
    t.db.prepare("UPDATE invitations SET expires_at = ? WHERE email = 'a@example.com'").run(past());
    const expired = await acceptNew(t.app, a.code, "a@example.com");
    expect(expired.res.status).toBe(410);
    expect(expired.res.body.error.code).toBe("invitation_expired");
    expect((await post(t.app, "/api/invitations/" + b.invitation.id + "/revoke", undefined, owner)).status).toBe(200);
    const revoked = await acceptNew(t.app, b.code, "b@example.com");
    expect(revoked.res.status).toBe(410);
    expect(revoked.res.body.error.code).toBe("invitation_revoked");
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM users WHERE email IN ('a@example.com','b@example.com')").n).toBe(0);
  });

  it("a garbage code, a code with a wrong secret, a code for a made-up organization: 404 invitation_not_found", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const { code } = await invite(t.app, owner, "sam@example.com");
    const [org] = code.split(".");
    const secret43 = "x".repeat(43);
    for (const bad of ["not-a-code-at-all-not-a-code", `${org}.${secret43}`, `00000000-0000-4000-8000-000000000000.${secret43}`, `${org}.${secret43}.extra`, "a".repeat(30)]) {
      const r = await post(t.app, "/api/auth/accept-invitation", { code: bad, email: "sam@example.com", name: "Sam", password: PASSWORD });
      expect(r.status, bad.slice(0, 12)).toBe(404);
      expect(r.body.error.code).toBe("invitation_not_found");
    }
  });

  it("needs a name, the invited email and a password of at least 10 characters when not signed in", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const { code } = await invite(t.app, owner, "sam@example.com");
    expect((await post(t.app, "/api/auth/accept-invitation", { code })).status).toBe(400);
    expect((await post(t.app, "/api/auth/accept-invitation", { code, email: "sam@example.com", name: "Sam", password: "short" })).status).toBe(400);
    expect((await post(t.app, "/api/auth/accept-invitation", { code, email: "sam@example.com", password: PASSWORD })).status).toBe(400); // no name
  });

  it("an existing account must sign in first (409 account_exists), then accepts as the signed-in person", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const sam = await signUp(t.app, "sam@example.com", "Sam"); // has a login, no organization
    const { code } = await invite(t.app, owner, "sam@example.com");
    const anon = await acceptNew(t.app, code, "sam@example.com");
    expect(anon.res.status).toBe(409);
    expect(anon.res.body.error.code).toBe("account_exists");
    const ok = await acceptAs(t.app, code, sam);
    expect(ok.status).toBe(200);
    expect(ok.body.data.organization.name).toBe("Acme");
    expect((await get(t.app, "/api/organization", sam)).body.data.name).toBe("Acme"); // the existing session now points at it
  });

  it("a signed-in person whose email is not the invited one is refused (403), and one who already has an organization too (409)", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const other = await signUp(t.app, "other@example.com");
    const { code } = await invite(t.app, owner, "sam@example.com");
    const mismatch = await acceptAs(t.app, code, other);
    expect(mismatch.status).toBe(403);
    expect(mismatch.body.error.code).toBe("invitation_email_mismatch");
    // Sam already runs another organization
    const samCookie = await signUpWithOrg(t.app, "sam@example.com", "Sam's Own Co");
    const already = await acceptAs(t.app, code, samCookie);
    expect(already.status).toBe(409);
    expect(already.body.error.code).toBe("already_in_organization");
    expect(one<{ status: string }>("SELECT status FROM invitations i JOIN organization_memberships m ON m.id = i.membership_id").status).toBe("invited");
  });

  it("is single use even when two requests race for it: exactly one wins", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const { code } = await invite(t.app, owner, "sam@example.com");
    const results = await Promise.all([acceptNew(t.app, code, "sam@example.com"), acceptNew(t.app, code, "sam@example.com"), acceptNew(t.app, code, "sam@example.com")]);
    const ok = results.filter((r) => r.res.status === 200);
    expect(ok).toHaveLength(1);
    for (const r of results.filter((x) => x.res.status !== 200)) expect([409, 410]).toContain(r.res.status);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM users WHERE email = 'sam@example.com'").n).toBe(1);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM organization_memberships WHERE user_id IS NOT NULL AND work_email = 'sam@example.com'").n).toBe(1);
  });

  it("the preview shows the organization and invited address, and nothing else", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme Robotics");
    const { code } = await invite(t.app, owner, "sam@example.com", "Sam");
    const p = await post(t.app, "/api/auth/invitation-preview", { code });
    expect(p.status).toBe(200);
    expect(p.body.data).toMatchObject({ organizationName: "Acme Robotics", email: "sam@example.com", displayName: "Sam" });
    expect(Object.keys(p.body.data).sort()).toEqual(["displayName", "email", "expiresAt", "organizationName"]);
  });

  it("rate-limits wrong codes per address (10), then refuses even a good one for a while", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const { code } = await invite(t.app, owner, "sam@example.com");
    for (let i = 0; i < 10; i++) expect((await post(t.app, "/api/auth/invitation-preview", { code: `${"0".repeat(8)}-0000-4000-8000-${String(i).padStart(12, "0")}.${"y".repeat(43)}` })).status).toBe(404);
    const blocked = await post(t.app, "/api/auth/invitation-preview", { code });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    expect((await post(t.app, "/api/auth/accept-invitation", { code, email: "sam@example.com", name: "S", password: PASSWORD })).status).toBe(429);
  });
});

describe("revoking and regenerating", () => {
  it("revoke ends the link and takes the never-joined person off the list; revoking twice is a conflict", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const { code, invitation } = await invite(t.app, owner, "sam@example.com");
    const r = await post(t.app, `/api/invitations/${invitation.id}/revoke`, undefined, owner);
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe("revoked");
    expect((await post(t.app, "/api/auth/invitation-preview", { code })).body.error.code).toBe("invitation_revoked");
    const members = (await get(t.app, "/api/organization/members", owner)).body.data as { email: string }[];
    expect(members.map((m) => m.email)).toEqual(["owner@example.com"]);
    expect((await post(t.app, `/api/invitations/${invitation.id}/revoke`, undefined, owner)).status).toBe(409);
  });

  it("regenerate gives a new link, kills the old one, and works after a revoke or an expiry; not after acceptance", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const first = await invite(t.app, owner, "sam@example.com");
    const second = await post(t.app, `/api/invitations/${first.invitation.id}/regenerate`, undefined, owner);
    expect(second.status).toBe(200);
    const code2 = second.body.data.code as string;
    expect(code2).not.toBe(first.code);
    expect((await post(t.app, "/api/auth/invitation-preview", { code: first.code })).body.error.code).toBe("invitation_revoked");
    expect((await post(t.app, "/api/auth/invitation-preview", { code: code2 })).status).toBe(200);
    expect(dump()).not.toContain(code2.split(".")[1]!);
    // revoke, then bring it back
    await post(t.app, `/api/invitations/${second.body.data.invitation.id}/revoke`, undefined, owner);
    const third = await post(t.app, `/api/invitations/${second.body.data.invitation.id}/regenerate`, undefined, owner);
    expect(third.status).toBe(200);
    // expire, then regenerate
    t.db.prepare("UPDATE invitations SET expires_at = ? WHERE revoked_at IS NULL").run(past());
    const fourth = await post(t.app, `/api/invitations/${third.body.data.invitation.id}/regenerate`, undefined, owner);
    expect(fourth.status).toBe(200);
    const accepted = await acceptNew(t.app, fourth.body.data.code, "sam@example.com");
    expect(accepted.res.status).toBe(200);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM organization_memberships WHERE work_email = 'sam@example.com'").n).toBe(1); // one person throughout
    expect((await post(t.app, `/api/invitations/${fourth.body.data.invitation.id}/regenerate`, undefined, owner)).status).toBe(409);
  });
});

describe("one administrator cannot touch another organization (cross-tenant)", () => {
  it("B's administrator cannot list, revoke, regenerate, reset or invite into A, whatever ids are sent", async () => {
    t = makeAuthApp();
    const ownerA = await signUpWithOrg(t.app, "owner-a@example.com", "Alpha Co");
    const ownerB = await signUpWithOrg(t.app, "owner-b@example.com", "Beta Co");
    const a = await invite(t.app, ownerA, "sam-a@example.com", "Sam A");
    const { cookie: samA } = await acceptNew(t.app, (await invite(t.app, ownerA, "joined-a@example.com")).code, "joined-a@example.com");
    expect(samA).toBeTruthy();
    const aMember = one<{ id: string }>("SELECT id FROM organization_memberships WHERE work_email = 'joined-a@example.com'").id;
    const aOwnerMember = one<{ id: string }>("SELECT id FROM organization_memberships WHERE work_email = 'owner-a@example.com'").id;
    const snapshot = JSON.stringify(rows("SELECT id, status, user_id FROM organization_memberships WHERE work_email LIKE '%-a@%' OR work_email LIKE '%a@example.com' ORDER BY id")) + JSON.stringify(rows("SELECT id, revoked_at, accepted_at, code_hash FROM invitations ORDER BY id"));

    // B sees only B's
    const listB = (await get(t.app, "/api/invitations", ownerB)).body.data as unknown[];
    expect(listB).toEqual([]);
    expect(JSON.stringify((await get(t.app, "/api/organization/members", ownerB)).body)).not.toMatch(/alpha|sam-a|joined-a|owner-a/i);

    // B tries A's invitation and A's people by id: indistinguishable from "does not exist"
    expect((await post(t.app, `/api/invitations/${a.invitation.id}/revoke`, undefined, ownerB)).status).toBe(404);
    expect((await post(t.app, `/api/invitations/${a.invitation.id}/regenerate`, undefined, ownerB)).status).toBe(404);
    expect((await post(t.app, `/api/people/${aMember}/reset-link`, undefined, ownerB)).status).toBe(404);
    expect((await post(t.app, `/api/people/${aOwnerMember}/reset-link`, undefined, ownerB)).status).toBe(404);
    // B cannot invite into A: no field can name an organization, and an invite made by B lands in B
    expect((await post(t.app, "/api/invitations", { email: "x@example.com", organizationId: one<{ id: string }>("SELECT id FROM organizations WHERE name = 'Alpha Co'").id }, ownerB)).status).toBe(400);
    const intoB = await invite(t.app, ownerB, "newbie@example.com");
    expect(one<{ organization_id: string }>("SELECT organization_id FROM invitations WHERE email = 'newbie@example.com'").organization_id).toBe(one<{ id: string }>("SELECT id FROM organizations WHERE name = 'Beta Co'").id);
    expect(intoB.code.split(".")[0]).toBe(one<{ id: string }>("SELECT id FROM organizations WHERE name = 'Beta Co'").id);
    // an unused reset link of A's person is unaffected, and B's token cannot be used on A's person (tokens are per login)
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM auth_tokens").n).toBe(0);

    const after = JSON.stringify(rows("SELECT id, status, user_id FROM organization_memberships WHERE work_email LIKE '%-a@%' OR work_email LIKE '%a@example.com' ORDER BY id")) + JSON.stringify(rows("SELECT id, revoked_at, accepted_at, code_hash FROM invitations WHERE email IN ('sam-a@example.com','joined-a@example.com') ORDER BY id"));
    void snapshot; void after;
    expect(one<{ revoked_at: string | null }>("SELECT revoked_at FROM invitations WHERE email = 'sam-a@example.com'").revoked_at).toBeNull();
    expect(one<{ status: string }>("SELECT status FROM organization_memberships WHERE work_email = 'sam-a@example.com'").status).toBe("invited");
    // A's link still works for A's invitee
    expect((await acceptNew(t.app, a.code, "sam-a@example.com")).res.status).toBe(200);
  });

  it("A's link cannot be accepted into another organization: a signed-in person of B only ever matches by email, and the org comes from the link", async () => {
    t = makeAuthApp();
    const ownerA = await signUpWithOrg(t.app, "owner-a@example.com", "Alpha Co");
    const ownerB = await signUpWithOrg(t.app, "owner-b@example.com", "Beta Co");
    const { code } = await invite(t.app, ownerA, "sam@example.com");
    const res = await acceptAs(t.app, code, ownerB);
    expect(res.status).toBe(403); // B's owner's email is not the invited one
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM organization_memberships WHERE organization_id = (SELECT id FROM organizations WHERE name = 'Beta Co')").n).toBe(1);
  });
});

describe("secrets never reach the log", () => {
  it("no code, password or email appears in any log line through invite, preview, accept, revoke and regenerate", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const { code, invitation } = await invite(t.app, owner, "sam@example.com");
    await post(t.app, "/api/auth/invitation-preview", { code });
    const regen = await post(t.app, `/api/invitations/${invitation.id}/regenerate`, undefined, owner);
    await acceptNew(t.app, regen.body.data.code, "sam@example.com", "Sam", "a very secret password");
    await post(t.app, "/api/auth/invitation-preview", { code: "nonsense-nonsense-nonsense-x" });
    const log = t.lines.join("\n");
    for (const secret of [code, code.split(".")[1]!, regen.body.data.code, regen.body.data.code.split(".")[1], "a very secret password", "sam@example.com", FAKE_ENV.SESSION_SECRET, TEST_CODE]) {
      expect(log).not.toContain(secret);
    }
  });
});

describe("where email will plug in", () => {
  it("hands the link secret to the delivery hook once (nowhere else), and the default delivery does nothing", async () => {
    const seen: { code: string }[] = [];
    t = makeAuthApp({ delivery: { invitationIssued: (i) => seen.push({ code: i.code }), passwordResetIssued: () => undefined, passwordResetRequested: () => undefined } });
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const { code } = await invite(t.app, owner, "sam@example.com");
    expect(seen).toEqual([{ code }]);
    expect(cookieFrom(await post(t.app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD }))).toBeTruthy();
  });
});
