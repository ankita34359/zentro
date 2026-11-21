import request from "supertest";
import { describe, expect, it } from "vitest";
import { describeProblem, loadConfig } from "../backend/src/config/env.js";
import { createHoldingApp } from "../backend/src/config/holding.js";
import { createLogger } from "../backend/src/lib/logger.js";
import { CRON, FAKE_ENV } from "./helpers/app.js";

function holding(env: NodeJS.ProcessEnv) {
  const r = loadConfig(env);
  if (r.ok) throw new Error("expected a problem");
  const lines: string[] = [];
  const app = createHoldingApp({
    message: describeProblem(r),
    names: [...r.missing, ...r.invalid.map((i) => i.name)],
    version: "test",
    cronSecret: CRON,
    log: createLogger("debug", (l) => lines.push(l)),
  });
  return { app, lines };
}

describe("holding mode (settings missing)", () => {
  it("shows the holding page at the site address, naming the missing setting", async () => {
    const { app } = holding({ ENCRYPTION_KEY: FAKE_ENV.ENCRYPTION_KEY });
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.type).toBe("text/html");
    expect(res.text).toContain("Server is missing: SESSION_SECRET");
    expect(res.text).toContain("Apply changes");
    expect((await request(app).get("/some/deep/link")).text).toContain("SESSION_SECRET");
  });

  it("answers /api with 503 and the names only", async () => {
    const { app } = holding({ ENCRYPTION_KEY: FAKE_ENV.ENCRYPTION_KEY });
    for (const [method, path] of [["get", "/api/anything"], ["post", "/api/auth/login"]] as const) {
      const res = await request(app)[method](path);
      expect(res.status).toBe(503);
      expect(res.body.error).toEqual({
        code: "server_missing_settings",
        message: "Server is missing: SESSION_SECRET",
        details: { missing: ["SESSION_SECRET"] },
      });
      expect(res.body.meta.requestId).toMatch(/^req_/);
    }
  });

  it("keeps /healthz answering (not ready) and the cron route guarded and fast", async () => {
    const { app } = holding({});
    const h = await request(app).get("/healthz");
    expect(h.status).toBe(200);
    expect(h.body).toMatchObject({ ok: true, ready: false, missing: ["SESSION_SECRET", "ENCRYPTION_KEY"], migrations: null });
    expect((await request(app).get("/api/cron/tick")).status).toBe(401);
    const c = await request(app).get("/api/cron/tick").set("Authorization", `Bearer ${CRON}`);
    expect(c.status).toBe(202);
    expect(c.body.started).toBe(false);
  });

  it("never reflects a bad value: a too-short secret appears by name only", async () => {
    const secretish = "short-secret-VALUE-123";
    const { app, lines } = holding({ SESSION_SECRET: secretish, ENCRYPTION_KEY: FAKE_ENV.ENCRYPTION_KEY });
    const everything = [(await request(app).get("/")).text, JSON.stringify((await request(app).get("/api/x")).body), ...lines].join("\n");
    expect(everything).toContain("SESSION_SECRET");
    expect(everything).not.toContain(secretish);
  });
});
