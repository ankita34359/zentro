import jwt from "jsonwebtoken";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, parseRegistration } from "../backend/src/config/env.js";
import { hashPassword, safeEqual, verifyPassword } from "../backend/src/lib/passwords.js";
import { RateLimiter } from "../backend/src/lib/rateLimit.js";
import { COOKIE_NAME, sessionRowId } from "../backend/src/modules/auth/tokens.js";
import { createLogger } from "../backend/src/lib/logger.js";
import { FAKE_ENV, makeTestApp, ORIGIN, testConfig, type TestApp } from "./helpers/app.js";
import { cookieFrom, get, makeAuthApp, PASSWORD, post, signUp, signUpWithOrg, TEST_CODE } from "./helpers/auth.js";

let t: TestApp;
afterEach(() => t?.cleanup());

const row = <T>(sql: string, params: Record<string, unknown> = {}) => t.db.prepare(sql).get(params) as T;

describe("passwords (scrypt)", () => {
  it("stores scrypt$N$r$p$salt$hash with a fresh salt each time, and verifies only the right password", async () => {
    const a = await hashPassword(PASSWORD);
    const b = await hashPassword(PASSWORD);
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword(PASSWORD, a)).toBe(true);
    expect(await verifyPassword(PASSWORD + "x", a)).toBe(false);
    expect(await verifyPassword("", a)).toBe(false);
  });
  it("never throws on a damaged or missing stored value", async () => {
    for (const bad of [null, undefined, "", "plain", "scrypt$1$2", "scrypt$x$8$1$aa$bb", "bcrypt$16384$8$1$aa$bb", "scrypt$99999999$8$1$aa$bb"]) {
      expect(await verifyPassword(PASSWORD, bad as string)).toBe(false);
    }
  });
  it("compares strings in constant time without caring about length differences", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcdef")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("registration setting (REGISTRATION_MODE and REGISTRATION_CODE)", () => {
  it("is closed unless mode is code with a code of 8 or more characters, or mode is open", () => {
    expect(parseRegistration({})).toEqual({ mode: "closed" });
    expect(parseRegistration({ REGISTRATION_MODE: "code" })).toEqual({ mode: "closed" });
    expect(parseRegistration({ REGISTRATION_MODE: "code", REGISTRATION_CODE: "short" })).toEqual({ mode: "closed" });
    expect(parseRegistration({ REGISTRATION_MODE: "banana", REGISTRATION_CODE: "long-enough-code" })).toEqual({ mode: "closed" });
    expect(parseRegistration({ REGISTRATION_MODE: "invite_only", REGISTRATION_CODE: "long-enough-code" })).toEqual({ mode: "closed" });
    expect(parseRegistration({ REGISTRATION_MODE: "CODE", REGISTRATION_CODE: " long-enough-code " })).toEqual({ mode: "code", code: "long-enough-code" });
    expect(parseRegistration({ REGISTRATION_MODE: "open" })).toEqual({ mode: "open" });
  });
  it("a missing, short or wrong registration setting never puts the server into holding mode", () => {
    for (const extra of [{}, { REGISTRATION_MODE: "code" }, { REGISTRATION_MODE: "code", REGISTRATION_CODE: "x" }, { REGISTRATION_MODE: "???" }]) {
      const r = loadConfig({ SESSION_SECRET: FAKE_ENV.SESSION_SECRET, ENCRYPTION_KEY: FAKE_ENV.ENCRYPTION_KEY, ...extra });
      expect(r.ok).toBe(true);
    }
  });
  it("/healthz shows the mode (never the code)", async () => {
    t = makeAuthApp();
    const res = await get(t.app, "/healthz");
    expect(res.body.registration).toBe("code");
    expect(JSON.stringify(res.body)).not.toContain(TEST_CODE);
  });
});

describe("register", () => {
  const body = (over: Record<string, unknown> = {}) => ({ email: "ada@example.com", name: "Ada", password: PASSWORD, registrationCode: TEST_CODE, ...over });

  it("creates a login when the code is right; nobody is signed in by it; the login then works", async () => {
    t = makeAuthApp();
    const reg = await post(t.app, "/api/auth/register", body());
    expect(reg.status).toBe(202);
    expect(reg.headers["set-cookie"]).toBeUndefined();
    expect((await post(t.app, "/api/auth/login", { email: "ada@example.com", password: PASSWORD })).status).toBe(200);
    expect(row<{ password_hash: string }>("SELECT password_hash FROM users").password_hash.startsWith("scrypt$")).toBe(true);
  });

  it("refuses a wrong code and a missing code with the same generic message and stores nothing", async () => {
    t = makeAuthApp();
    const wrong = await post(t.app, "/api/auth/register", body({ registrationCode: "not-the-code-at-all" }));
    const missing = await post(t.app, "/api/auth/register", body({ registrationCode: undefined }));
    expect(wrong.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(wrong.body.error.code).toBe("registration_unavailable");
    expect(missing.body.error).toEqual(wrong.body.error);
    expect(row<{ n: number }>("SELECT COUNT(*) n FROM users").n).toBe(0);
  });

  it("fails closed with the same message when registration is not configured, and the rest of the site works", async () => {
    t = makeTestApp(); // no REGISTRATION_* at all
    const res = await post(t.app, "/api/auth/register", body());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("registration_unavailable");
    expect((await get(t.app, "/healthz")).body).toMatchObject({ ok: true, ready: true, registration: "closed" });
    expect((await get(t.app, "/api/auth/me")).status).toBe(401); // normal answers, not a 503 holding answer
  });

  it("existing logins keep working while registration is closed", async () => {
    t = makeAuthApp();
    await post(t.app, "/api/auth/register", body());
    const closed = makeTestApp({ config: testConfig() });
    closed.db.exec("DELETE FROM users"); // separate database: prove the closed app still logs in an existing user
    closed.cleanup();
    // same database, registration switched off: build a second app on the first database
    const { createApp } = await import("../backend/src/app.js");
    const again = createApp({ db: t.db, config: testConfig(), version: "t", cronSecret: undefined, migrationsTotal: 4, log: createLogger("error", () => undefined) });
    expect((await post(again.app, "/api/auth/login", { email: "ada@example.com", password: PASSWORD })).status).toBe(200);
    expect((await post(again.app, "/api/auth/register", body({ email: "new@example.com" }))).status).toBe(403);
  });

  it("answers an email that already exists exactly like a new one (case-insensitive), and keeps the first password", async () => {
    t = makeAuthApp();
    const first = await post(t.app, "/api/auth/register", body());
    const again = await post(t.app, "/api/auth/register", body({ email: "ADA@Example.com", password: "another long password" }));
    expect(again.status).toBe(first.status);
    expect({ ...again.body, meta: undefined }).toEqual({ ...first.body, meta: undefined });
    expect(row<{ n: number }>("SELECT COUNT(*) n FROM users").n).toBe(1);
    expect((await post(t.app, "/api/auth/login", { email: "ada@example.com", password: PASSWORD })).status).toBe(200);
  });

  it("requires a password of at least 10 characters (and at most 128), a valid email and a name", async () => {
    t = makeAuthApp();
    for (const bad of [{ password: "123456789" }, { password: "x".repeat(129) }, { email: "not-an-email" }, { name: "  " }, { extra: 1 }]) {
      const res = await post(t.app, "/api/auth/register", body(bad));
      expect(res.status, JSON.stringify(Object.keys(bad))).toBe(400);
      expect(res.body.error.code).toBe("validation_failed");
    }
    expect((await post(t.app, "/api/auth/register", body({ password: "1234567890" }))).status).toBe(202);
  });

  it("rate-limits wrong codes per address (5), then refuses even the right code for a while", async () => {
    t = makeAuthApp();
    for (let i = 0; i < 5; i++) expect((await post(t.app, "/api/auth/register", body({ registrationCode: `guess-number-${i}-xx` }))).status).toBe(403);
    const blocked = await post(t.app, "/api/auth/register", body());
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("rate_limited");
    expect(blocked.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("never writes the code, a password or an email into the log, even when it is wrong", async () => {
    t = makeAuthApp();
    await post(t.app, "/api/auth/register", body({ registrationCode: "wrong-code-value-0042" }));
    await post(t.app, "/api/auth/register", body());
    await post(t.app, "/api/auth/login", { email: "ada@example.com", password: PASSWORD });
    await post(t.app, "/api/auth/login", { email: "ada@example.com", password: "wrong password here" });
    const log = t.lines.join("\n");
    for (const secret of [TEST_CODE, "wrong-code-value-0042", PASSWORD, "wrong password here", "ada@example.com", FAKE_ENV.SESSION_SECRET]) expect(log).not.toContain(secret);
  });
});

describe("login and sessions", () => {
  it("a wrong password and an unknown email give the same 401 and message", async () => {
    t = makeAuthApp();
    await signUp(t.app, "ada@example.com");
    const wrong = await post(t.app, "/api/auth/login", { email: "ada@example.com", password: "wrong password!" });
    const unknown = await post(t.app, "/api/auth/login", { email: "nobody@example.com", password: "wrong password!" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toEqual(unknown.body.error);
    expect(wrong.headers["set-cookie"]).toBeUndefined();
  });

  it("locks an account after 8 wrong passwords (even the right one is then refused), and a success clears the count", async () => {
    t = makeAuthApp();
    await signUp(t.app, "ada@example.com");
    for (let i = 0; i < 7; i++) await post(t.app, "/api/auth/login", { email: "ada@example.com", password: "wrong password!" });
    expect((await post(t.app, "/api/auth/login", { email: "ada@example.com", password: PASSWORD })).status).toBe(200); // 7 failures: still open, and reset
    for (let i = 0; i < 8; i++) await post(t.app, "/api/auth/login", { email: "ada@example.com", password: "wrong password!" });
    const locked = await post(t.app, "/api/auth/login", { email: "ada@example.com", password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(locked.headers["set-cookie"]).toBeUndefined();
  });

  it("rate-limits one address across many accounts (30 failures)", async () => {
    t = makeAuthApp();
    for (let i = 0; i < 30; i++) await post(t.app, "/api/auth/login", { email: `user${i}@example.com`, password: "wrong password!" });
    expect((await post(t.app, "/api/auth/login", { email: "another@example.com", password: "wrong password!" })).status).toBe(429);
  });

  it("sets an HttpOnly, SameSite=Lax cookie that is Secure behind https, and the JWT holds only sub and sid", async () => {
    t = makeAuthApp();
    await post(t.app, "/api/auth/register", { email: "ada@example.com", name: "Ada", password: PASSWORD, registrationCode: TEST_CODE });
    const res = await post(t.app, "/api/auth/login", { email: "ada@example.com", password: PASSWORD }).set("X-Forwarded-Proto", "https");
    const raw = ([] as string[]).concat(res.headers["set-cookie"] ?? [])[0]!;
    expect(raw).toMatch(/^zentro_session=/);
    expect(raw).toMatch(/; HttpOnly/);
    expect(raw).toMatch(/; SameSite=Lax/);
    expect(raw).toMatch(/; Secure/);
    expect(raw).toMatch(/; Path=\//);
    const token = decodeURIComponent(raw.split(";")[0]!.split("=")[1]!);
    const claims = jwt.verify(token, FAKE_ENV.SESSION_SECRET, { algorithms: ["HS256"] }) as Record<string, unknown>;
    expect(Object.keys(claims).sort()).toEqual(["exp", "iat", "sid", "sub"]);
    // the database stores only a hash of the session id, never the value inside the cookie
    const stored = row<{ id: string }>("SELECT id FROM sessions");
    expect(stored.id).toBe(sessionRowId(claims.sid as string));
    expect(stored.id).not.toBe(claims.sid);
  });

  it("is Secure whenever the request is not plain http on the developer's own machine", async () => {
    t = makeAuthApp();
    await post(t.app, "/api/auth/register", { email: "ada@example.com", name: "Ada", password: PASSWORD, registrationCode: TEST_CODE });
    const local = await post(t.app, "/api/auth/login", { email: "ada@example.com", password: PASSWORD });
    expect(([] as string[]).concat(local.headers["set-cookie"] ?? [])[0]).not.toMatch(/Secure/); // 127.0.0.1 over http
    const remote = await post(t.app, "/api/auth/login", { email: "ada@example.com", password: PASSWORD }).set("Host", "zentro.example.app");
    expect(([] as string[]).concat(remote.headers["set-cookie"] ?? [])[0]).toMatch(/; Secure/);
  });

  it("refreshing keeps you signed in: /api/auth/me with the cookie answers who you are", async () => {
    t = makeAuthApp();
    const c = await signUp(t.app, "ada@example.com", "Ada Lovelace");
    const me = await get(t.app, "/api/auth/me", c);
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ user: { email: "ada@example.com", name: "Ada Lovelace" }, organization: null, needsOnboarding: true, roles: [], capabilities: {} });
    expect(JSON.stringify(me.body)).not.toMatch(/password|scrypt/);
    expect(me.headers["cache-control"]).toBe("no-store");
  });

  it("answers 401 with no cookie, a garbage cookie, another secret's cookie, an unsigned (alg none) cookie, and clears a bad cookie", async () => {
    t = makeAuthApp();
    const c = await signUp(t.app, "ada@example.com");
    expect((await get(t.app, "/api/auth/me")).status).toBe(401);
    const token = decodeURIComponent(c.split("=")[1]!);
    const claims = jwt.decode(token) as { sub: string; sid: string };
    const forged = [
      "garbage",
      jwt.sign(claims, "some-other-secret-that-is-long-enough-xx", { algorithm: "HS256" }),
      `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: claims.sub, sid: claims.sid })).toString("base64url")}.`,
      jwt.sign({ sub: claims.sub, sid: claims.sid }, FAKE_ENV.SESSION_SECRET, { algorithm: "HS256", expiresIn: -10 }),
    ];
    for (const f of forged) {
      const res = await get(t.app, "/api/auth/me", `${COOKIE_NAME}=${encodeURIComponent(f)}`);
      expect(res.status, f.slice(0, 20)).toBe(401);
      expect(([] as string[]).concat(res.headers["set-cookie"] ?? []).join()).toMatch(/Max-Age=0/);
    }
  });

  it("a valid JWT is not enough: a revoked, expired or past-absolute-expiry session row is refused", async () => {
    t = makeAuthApp();
    const c = await signUp(t.app, "ada@example.com");
    const id = row<{ id: string }>("SELECT id FROM sessions").id;
    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect((await get(t.app, "/api/auth/me", c)).status).toBe(200);
    t.db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(past, id);
    expect((await get(t.app, "/api/auth/me", c)).status).toBe(401); // sliding window ran out
    t.db.prepare("UPDATE sessions SET expires_at = ?, absolute_expires_at = ? WHERE id = ?").run(future, past, id);
    expect((await get(t.app, "/api/auth/me", c)).status).toBe(401); // 30-day hard stop
    t.db.prepare("UPDATE sessions SET expires_at = ?, absolute_expires_at = ?, revoked_at = ? WHERE id = ?").run(future, future, past, id);
    expect((await get(t.app, "/api/auth/me", c)).status).toBe(401); // revoked
    t.db.prepare("UPDATE sessions SET revoked_at = NULL WHERE id = ?").run(id);
    expect((await get(t.app, "/api/auth/me", c)).status).toBe(200); // control: the row decides, nothing else
  });

  it("slides the 7-day window when a session is used, but never past the 30-day hard stop", async () => {
    t = makeAuthApp();
    const c = await signUp(t.app, "ada@example.com");
    const id = row<{ id: string }>("SELECT id FROM sessions").id;
    const oldSeen = new Date(Date.now() - 3600_000).toISOString();
    t.db.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?").run(oldSeen, new Date(Date.now() + 3600_000).toISOString(), id);
    await get(t.app, "/api/auth/me", c);
    const after = t.db.prepare("SELECT expires_at, absolute_expires_at FROM sessions WHERE id = ?").get(id) as { expires_at: string; absolute_expires_at: string };
    expect(Date.parse(after.expires_at)).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect(Date.parse(after.expires_at)).toBeLessThanOrEqual(Date.parse(after.absolute_expires_at));
  });

  it("logout revokes the row (the old cookie then fails) and clears the cookie; logout without a session still succeeds", async () => {
    t = makeAuthApp();
    const c = await signUp(t.app, "ada@example.com");
    const out = await post(t.app, "/api/auth/logout", undefined, c);
    expect(out.status).toBe(200);
    expect(([] as string[]).concat(out.headers["set-cookie"] ?? []).join()).toMatch(/zentro_session=;.*Max-Age=0/);
    expect(row<{ revoked_at: string | null }>("SELECT revoked_at FROM sessions").revoked_at).toBeTruthy();
    expect((await get(t.app, "/api/auth/me", c)).status).toBe(401);
    expect((await post(t.app, "/api/auth/logout")).status).toBe(200);
  });

  it("a disabled user is refused at login and on an existing session", async () => {
    t = makeAuthApp();
    const c = await signUp(t.app, "ada@example.com");
    t.db.prepare("UPDATE users SET status = 'disabled'").run();
    expect((await get(t.app, "/api/auth/me", c)).status).toBe(401);
    expect((await post(t.app, "/api/auth/login", { email: "ada@example.com", password: PASSWORD })).status).toBe(401);
  });

  it("housekeeping purges sessions past their hard expiry", async () => {
    t = makeAuthApp();
    await signUp(t.app, "ada@example.com");
    t.db.prepare("UPDATE sessions SET absolute_expires_at = ?").run(new Date(Date.now() - 1000).toISOString());
    await t.tick.run();
    expect(row<{ n: number }>("SELECT COUNT(*) n FROM sessions").n).toBe(0);
  });
});

describe("same-origin check on state-changing requests", () => {
  const creds = { email: "ada@example.com", password: PASSWORD };
  it("refuses a POST with no Origin or Referer, a foreign Origin, and the string 'null'", async () => {
    t = makeAuthApp();
    for (const set of [{}, { Origin: "https://evil.example" }, { Origin: "null" }, { Origin: "https://zentro.test.evil.example" }, { Origin: "https://evil.example", Referer: "https://zentro.test/x" }]) {
      const res = await request(t.app).post("/api/auth/login").set(set).send(creds);
      expect(res.status, JSON.stringify(set)).toBe(403);
      expect(res.body.error.code).toBe("cross_origin");
    }
  });
  it("accepts the site's own Origin, or its Referer when there is no Origin", async () => {
    t = makeAuthApp();
    expect((await request(t.app).post("/api/auth/login").set("Origin", ORIGIN).send(creds)).status).toBe(401); // reached the handler
    expect((await request(t.app).post("/api/auth/login").set("Referer", `${ORIGIN}/login`).send(creds)).status).toBe(401);
    expect((await request(t.app).post("/api/auth/login").set("Referer", "https://evil.example/login").send(creds)).status).toBe(403);
  });
  it("covers every non-GET method, but never blocks reads", async () => {
    t = makeAuthApp();
    expect((await request(t.app).put("/api/anything").send({})).status).toBe(403);
    expect((await request(t.app).delete("/api/anything")).status).toBe(403);
    expect((await get(t.app, "/healthz")).status).toBe(200);
  });
  it("without APP_URL it compares with the host the request was sent to (and X-Forwarded-Host behind the proxy)", async () => {
    t = makeTestApp({ config: testConfig({ APP_URL: "" }) });
    const ok = await request(t.app).post("/api/auth/login").set("Host", "zentro.embarko.app").set("Origin", "https://zentro.embarko.app").send(creds);
    expect(ok.status).toBe(401);
    const proxied = await request(t.app).post("/api/auth/login").set("X-Forwarded-Host", "zentro.embarko.app").set("Origin", "https://zentro.embarko.app").send(creds);
    expect(proxied.status).toBe(401);
    const foreign = await request(t.app).post("/api/auth/login").set("Host", "zentro.embarko.app").set("Origin", "https://evil.example").send(creds);
    expect(foreign.status).toBe(403);
  });
});

describe("create organization (onboarding)", () => {
  it("needs a signed-in person", async () => {
    t = makeAuthApp();
    expect((await post(t.app, "/api/organizations", { name: "Acme" })).status).toBe(401);
  });

  it("creates the organization, the person's membership, the Owner role and the Owner @ organization assignment in one go", async () => {
    t = makeAuthApp();
    const c = await signUp(t.app, "ada@example.com", "Ada Lovelace");
    const res = await post(t.app, "/api/organizations", { name: "Acme Robotics", timezone: "Asia/Kolkata" }, c);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      user: { email: "ada@example.com" },
      organization: { name: "Acme Robotics", slug: "acme-robotics", timezone: "Asia/Kolkata" },
      membership: { displayName: "Ada Lovelace" },
      roles: [{ key: "owner", name: "Owner" }],
      needsOnboarding: false,
    });
    const a = row<{ scope_type: string; key: string; organization_id: string }>(
      "SELECT a.scope_type, r.key, a.organization_id FROM user_role_assignments a JOIN roles r ON r.id = a.role_id",
    );
    expect(a).toMatchObject({ scope_type: "organization", key: "owner" });
    // a refresh (new request with the same cookie) lands in the organization
    expect((await get(t.app, "/api/auth/me", c)).body.data.organization.name).toBe("Acme Robotics");
    // and so does a fresh login
    const again = await post(t.app, "/api/auth/login", { email: "ada@example.com", password: PASSWORD });
    expect(again.body.data.organization.name).toBe("Acme Robotics");
  });

  it("never takes the organization from the request: an organization id in the body is rejected, one in the query or a header is ignored", async () => {
    t = makeAuthApp();
    const c = await signUp(t.app, "ada@example.com");
    const sneaky = await post(t.app, "/api/organizations", { name: "Acme", organizationId: "x", organization_id: "y" }, c);
    expect(sneaky.status).toBe(400);
    expect(row<{ n: number }>("SELECT COUNT(*) n FROM organizations").n).toBe(0);
  });

  it("validates the name and time zone, and refuses a second organization from the same person", async () => {
    t = makeAuthApp();
    const c = await signUp(t.app, "ada@example.com");
    expect((await post(t.app, "/api/organizations", { name: "A" }, c)).status).toBe(400);
    expect((await post(t.app, "/api/organizations", { name: "Acme", timezone: "Mars/Olympus" }, c)).status).toBe(400);
    expect((await post(t.app, "/api/organizations", { name: "Acme" }, c)).status).toBe(201);
    expect((await post(t.app, "/api/organizations", { name: "Second" }, c)).status).toBe(409);
  });

  it("gives two organizations with the same name different slugs", async () => {
    t = makeAuthApp();
    await signUpWithOrg(t.app, "a@example.com", "Acme");
    await signUpWithOrg(t.app, "b@example.com", "Acme");
    const slugs = (t.db.prepare("SELECT slug FROM organizations ORDER BY slug").all() as { slug: string }[]).map((r) => r.slug);
    expect(new Set(slugs).size).toBe(2);
    expect(slugs[0]).toBe("acme");
  });

  it("GET /api/organization needs an organization (403 before onboarding)", async () => {
    t = makeAuthApp();
    const c = await signUp(t.app, "ada@example.com");
    const res = await get(t.app, "/api/organization", c);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("no_organization");
  });

  it("removing the membership ends access on the very next request", async () => {
    t = makeAuthApp();
    const c = await signUpWithOrg(t.app, "ada@example.com", "Acme");
    expect((await get(t.app, "/api/organization", c)).status).toBe(200);
    t.db.prepare("UPDATE organization_memberships SET status = 'left'").run();
    expect((await get(t.app, "/api/organization", c)).status).toBe(403);
    expect((await get(t.app, "/api/auth/me", c)).body.data.needsOnboarding).toBe(true);
  });
});

describe("tenant isolation", () => {
  it("a person from a second organization sees only their own organization, whatever they send", async () => {
    t = makeAuthApp();
    const a = await signUpWithOrg(t.app, "alice@example.com", "Alpha Co");
    const b = await signUpWithOrg(t.app, "bob@example.com", "Beta Co");
    const orgA = row<{ id: string }>("SELECT id FROM organizations WHERE name = 'Alpha Co'").id;

    const mineB = await get(t.app, "/api/organization", b);
    expect(mineB.body.data).toMatchObject({ name: "Beta Co", memberCount: 1 });
    // Asking for A's organization any way the request can carry an id changes nothing.
    const spoofs = [
      get(t.app, `/api/organization?organizationId=${orgA}&organization_id=${orgA}`, b),
      get(t.app, "/api/organization", b).set("X-Organization-Id", orgA),
      get(t.app, `/api/organization/${orgA}`, b),
    ];
    const results = await Promise.all(spoofs);
    expect(results[0]!.body.data.name).toBe("Beta Co");
    expect(results[1]!.body.data.name).toBe("Beta Co");
    expect(results[2]!.status).toBe(404);
    for (const r of results) expect(JSON.stringify(r.body)).not.toMatch(/Alpha|alice|orgA/i);
    // and A still sees A, with only A's people
    expect((await get(t.app, "/api/auth/me", a)).body.data).toMatchObject({ organization: { name: "Alpha Co" }, membership: { displayName: "Test Person" } });
    expect(JSON.stringify((await get(t.app, "/api/auth/me", b)).body)).not.toContain("alice@example.com");
  });

  it("a session row pointing at someone else's organization gets no membership there (no access without being a member)", async () => {
    t = makeAuthApp();
    await signUpWithOrg(t.app, "alice@example.com", "Alpha Co");
    const b = await signUp(t.app, "bob@example.com");
    const orgA = row<{ id: string }>("SELECT id FROM organizations WHERE name = 'Alpha Co'").id;
    t.db.prepare("UPDATE sessions SET active_organization_id = ? WHERE user_id = (SELECT id FROM users WHERE email = 'bob@example.com')").run(orgA);
    const res = await get(t.app, "/api/organization", b);
    expect(res.status).toBe(403);
    expect((await get(t.app, "/api/auth/me", b)).body.data).toMatchObject({ organization: null, needsOnboarding: true });
  });

  it("the tenant-scoped handle returns none of the other organization's rows, and refuses SQL that skips the organization filter", async () => {
    t = makeAuthApp();
    await signUpWithOrg(t.app, "alice@example.com", "Alpha Co");
    await signUpWithOrg(t.app, "bob@example.com", "Beta Co");
    const ids = t.db.prepare("SELECT id, name FROM organizations").all() as { id: string; name: string }[];
    const A = ids.find((o) => o.name === "Alpha Co")!.id;
    const B = ids.find((o) => o.name === "Beta Co")!.id;
    const { createTenantDb } = await import("../backend/src/db/tenant.js");
    const tdb = createTenantDb(t.db, { userId: "u", membershipId: "m", organizationId: B, sessionId: "s", requestId: "r" }, { strict: true });
    const rows = tdb.all<{ organization_id: string }>("SELECT organization_id FROM organization_memberships WHERE organization_id = @organization_id");
    expect(rows.length).toBe(1);
    expect(rows.every((r) => r.organization_id === B)).toBe(true);
    expect(() => tdb.all("SELECT * FROM organization_memberships")).toThrow(/Tenant lint failed/);
    expect(() => tdb.all("SELECT * FROM roles WHERE organization_id = 'x'")).toThrow(/Tenant lint failed/);
    expect(() => tdb.all("SELECT * FROM user_role_assignments WHERE organization_id = @organization_id", { organization_id: A })).toThrow(/session/);
    const aRoles = createTenantDb(t.db, { userId: "u", membershipId: "m", organizationId: A, sessionId: "s", requestId: "r" }, { strict: true });
    expect(aRoles.all("SELECT id FROM roles WHERE organization_id = @organization_id").length).toBe(9); // the nine role templates
    expect(tdb.all("SELECT id FROM roles WHERE organization_id = @organization_id").length).toBe(9);
  });
});

describe("rate limiter", () => {
  it("blocks after max failures inside the window, doubles the next block, forgets old failures, and resets on success", () => {
    let now = 0;
    const l = new RateLimiter({ max: 3, windowMs: 1000, blockMs: 1000, maxBlockMs: 4000 }, () => now);
    expect(l.fail("k")).toBe(0);
    expect(l.fail("k")).toBe(0);
    expect(l.fail("k")).toBe(1000);
    expect(l.retryAfterMs("k")).toBe(1000);
    now = 1001;
    expect(l.retryAfterMs("k")).toBe(0);
    l.fail("k"); l.fail("k");
    expect(l.fail("k")).toBe(2000); // second block is twice as long
    now = 10_000;
    l.fail("k"); l.fail("k");
    expect(l.fail("k")).toBe(4000);
    now = 20_000;
    l.fail("k"); l.fail("k");
    expect(l.fail("k")).toBe(4000); // capped
    now = 30_000;
    l.fail("x"); l.fail("x");
    now = 31_500; // earlier failures have left the window
    expect(l.fail("x")).toBe(0);
    l.reset("x");
    expect(l.retryAfterMs("x")).toBe(0);
  });
});

describe("the registry marks every new route", () => {
  it("every auth route declares its access, and the baseline ones answer 401 with no session", async () => {
    t = makeAuthApp();
    const rows = t.registry.list().filter((r) => r.path.startsWith("/api/auth") || r.path.startsWith("/api/org"));
    expect(rows.length).toBe(16);
    for (const r of rows.filter((x) => x.access.kind === "baseline")) {
      const res = await (r.method === "get" ? get(t.app, r.path) : post(t.app, r.path, {}));
      expect(res.status, r.path).toBe(401);
    }
  });
});
