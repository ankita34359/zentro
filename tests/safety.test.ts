import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { AnthropicProvider } from "../backend/src/modules/ai/provider.js";
import { CRON, FAKE_ENV, type TestApp } from "./helpers/app.js";
import { get, makeAuthApp, post, signUpWithOrg, TEST_CODE } from "./helpers/auth.js";

let t: TestApp;
afterEach(() => t?.cleanup());
const code = (r: { body: { error?: { code?: string } } }) => r.body.error?.code;
const one = <T>(sql: string, ...p: unknown[]) => t.db.prepare(sql).get(...p) as T;

describe("security headers (batch K)", () => {
  it("every response, API or page or error, carries the protective headers; the policy allows only Zentro's own resources", async () => {
    t = makeAuthApp();
    for (const res of [await get(t.app, "/healthz"), await get(t.app, "/api/auth/me"), await get(t.app, "/api/nope"), await post(t.app, "/api/auth/login", { email: "x", password: "y" })]) {
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(res.headers["permissions-policy"]).toMatch(/camera=\(\)/);
      const csp = String(res.headers["content-security-policy"]);
      expect(csp).toMatch(/default-src 'self'/);
      expect(csp).toMatch(/frame-ancestors 'none'/);
      expect(csp).toMatch(/script-src 'self'(;|$)/); // no inline or outside scripts
      expect(csp).not.toMatch(/https?:\/\//); // nothing outside Zentro is allowed
      expect(csp).not.toMatch(/unsafe-eval/);
    }
  });
});

describe("rate limits (batch K)", () => {
  it("the general API limit answers 429 with a friendly message and Retry-After, never a crash; the health check is exempt", async () => {
    t = makeAuthApp({ apiRequestsPerMinute: 5 });
    for (let i = 0; i < 5; i++) expect((await get(t.app, "/api/auth/me")).status).toBe(401);
    const limited = await get(t.app, "/api/auth/me");
    expect(limited.status).toBe(429);
    expect(limited.body.error).toMatchObject({ code: "rate_limited", message: "Too many attempts, try again in a minute." });
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect(limited.body.meta.requestId).toBeTruthy();
    expect((await get(t.app, "/healthz")).status).toBe(200);
    expect(t.lines.filter((l) => l.includes('"msg":"rate limited"')).length).toBeGreaterThanOrEqual(1);
  });

  it("wrong-password attempts are limited per account, with the friendly message, and a logged event without the account or the password", async () => {
    t = makeAuthApp();
    await signUpWithOrg(t.app, "owner@example.com", "Acme");
    let last = await post(t.app, "/api/auth/login", { email: "owner@example.com", password: "WRONG-PASSWORD-123" });
    for (let i = 0; i < 12 && last.status !== 429; i++) last = await post(t.app, "/api/auth/login", { email: "owner@example.com", password: "WRONG-PASSWORD-123" });
    expect(last.status).toBe(429);
    expect(last.body.error.message).toMatch(/^Too many attempts, try again in (a minute|\d+ minutes)\.$/);
    const logged = t.lines.filter((l) => l.includes('"msg":"rate limited"'));
    expect(logged.length).toBeGreaterThanOrEqual(1);
    for (const l of logged) {
      expect(l).not.toContain("owner@example.com");
      expect(l).not.toContain("WRONG-PASSWORD-123");
    }
  });

  it("file uploads are limited per person, and the pause is audited without the file", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ev = (await post(t.app, "/api/evidence", { title: "Report" }, owner)).body.data.id as string;
    const file = { filename: "a.txt", dataBase64: Buffer.from("hello").toString("base64") };
    expect((await post(t.app, `/api/evidence/${ev}/file`, file, owner)).status).toBe(201);
    let blocked: Awaited<ReturnType<typeof post>> | undefined;
    for (let i = 0; i < 30 && !blocked; i++) {
      const r = await post(t.app, `/api/evidence/${ev}/file`, file, owner);
      if (r.status === 429) blocked = r;
    }
    expect(blocked, "an upload was never limited").toBeTruthy();
    expect(blocked!.body.error.code).toBe("rate_limited");
    const a = one<{ summary: string; after_json: string; action: string }>("SELECT action, summary, after_json FROM audit_logs WHERE action = 'security.rate_limited'");
    expect(a.after_json).toContain("evidence_upload");
    expect(`${a.summary}${a.after_json}`).not.toMatch(/a\.txt|hello/);
  });
});

describe("no secret reaches a response, a log line or the audit log (batch K)", () => {
  it("scans every list route, errors, the page and the logs for passwords, tokens, session ids, the AI key's value and its name", async () => {
    const KEY = "sk-ant-api03-FAKEKEYVALUE-0123456789";
    const PASSWORD = "Correct-Horse-Battery-77";
    const provider = new AnthropicProvider({ ANTHROPIC_API_KEY: KEY }, (async () => { throw new Error(`boom ${KEY}`); }) as unknown as typeof fetch);
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = KEY; // the real setting is read from the environment: make it present while everything runs
    try {
      t = makeAuthApp({ aiProvider: provider });
      const reg = await post(t.app, "/api/auth/register", { email: "owner@example.com", name: "Olivia Owner", password: PASSWORD, registrationCode: TEST_CODE });
      expect([202, 201]).toContain(reg.status);
      const login = await post(t.app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD });
      const cookie = ([] as string[]).concat(login.headers["set-cookie"] ?? []).find((c) => c.startsWith("zentro_session="))!.split(";")[0]!;
      const sessionToken = decodeURIComponent(cookie.slice("zentro_session=".length));
      await post(t.app, "/api/organizations", { name: "Acme" }, cookie);
      await post(t.app, "/api/demo/load", undefined, cookie);
      await post(t.app, "/api/auth/login", { email: "owner@example.com", password: "WRONG-" + PASSWORD });
      await post(t.app, "/api/ai/ask", { question: "Hello?" }, cookie);
      const secrets = [KEY, "ANTHROPIC_API_KEY", PASSWORD, "WRONG-" + PASSWORD, sessionToken, FAKE_ENV.SESSION_SECRET, FAKE_ENV.ENCRYPTION_KEY, CRON];
      const bodies: string[] = [JSON.stringify(login.body), JSON.stringify(reg.body)];
      for (const r of t.registry.list()) {
        if (r.method !== "get" || r.path.includes(":")) continue;
        const res = await request(t.app).get(r.path).set("Cookie", cookie);
        bodies.push(`${r.path} ${res.status} ${JSON.stringify(res.body)} ${res.text}`);
      }
      for (const p of ["/", "/login", "/nope", "/api/nope"]) { const res = await get(t.app, p, cookie); bodies.push(res.text); bodies.push(JSON.stringify(res.headers).replace(/set-cookie[^\]]*\]/i, "")); }
      bodies.push((await post(t.app, "/api/ai/ask", { question: "Hello?" }, cookie)).text);
      bodies.push(JSON.stringify(t.db.prepare("SELECT * FROM audit_logs").all()), JSON.stringify(t.db.prepare("SELECT * FROM ai_requests").all()), t.lines.join("\n"));
      expect(bodies.length).toBeGreaterThan(40);
      for (const s of secrets) {
        for (const b of bodies) expect(b.includes(s), `a response, log line or audit row contains a secret (${s.slice(0, 8)}…)`).toBe(false);
      }
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});
