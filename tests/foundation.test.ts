import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { bearerMatches } from "../backend/src/http/registry.js";
import { CRON, makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
afterEach(() => t?.cleanup());

describe("/healthz", () => {
  it("reports ok, Node version, migration count and no tick yet", async () => {
    t = makeTestApp();
    const res = await request(t.app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      ready: true,
      version: "test",
      node: process.versions.node,
      migrations: { applied: 17, total: 17 },
      registration: "closed",
      lastTick: null,
    });
    expect(typeof res.body.memoryMb).toBe("number");
    expect(res.headers["x-request-id"]).toMatch(/^req_/);
  });

  it("shows the last tick time after a tick ran", async () => {
    t = makeTestApp();
    await t.tick.run();
    const res = await request(t.app).get("/healthz");
    expect(res.body.lastTick).toMatchObject({ status: "ok" });
    expect(res.body.lastTick.finishedAt).toBeTruthy();
  });

  it("never exposes the database path or any secret", async () => {
    t = makeTestApp();
    const text = JSON.stringify((await request(t.app).get("/healthz")).body);
    expect(text).not.toContain(t.dir);
    expect(text).not.toMatch(/test-session-secret|test-encryption-key|cron-secret/);
  });
});

describe("cron tick route", () => {
  it("rejects a missing or wrong bearer with the 401 envelope", async () => {
    t = makeTestApp();
    const a = await request(t.app).get("/api/cron/tick");
    expect(a.status).toBe(401);
    expect(a.body.error.code).toBe("unauthenticated");
    expect((await request(t.app).get("/api/cron/tick").set("Authorization", "Bearer wrong")).status).toBe(401);
  });

  it("always rejects when CRON_SECRET is unset", async () => {
    t = makeTestApp({ cronSecret: undefined });
    expect((await request(t.app).get("/api/cron/tick").set("Authorization", "Bearer ")).status).toBe(401);
    expect((await request(t.app).get("/api/cron/tick").set("Authorization", "Bearer undefined")).status).toBe(401);
  });

  it("answers 202 at once, runs the due jobs and records them", async () => {
    t = makeTestApp();
    const res = await request(t.app).get("/api/cron/tick").set("Authorization", `Bearer ${CRON}`);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true, started: true });
    await new Promise((r) => setTimeout(r, 80));
    const rows = t.db.prepare("SELECT job_name, status FROM scheduled_job_runs ORDER BY job_name").all();
    expect(rows).toEqual([
      { job_name: "kpi.thresholds", status: "ok" },
      { job_name: "okr.health", status: "ok" },
      { job_name: "platform.housekeeping", status: "ok" },
      { job_name: "scores.recalculate", status: "ok" },
      { job_name: "tasks.reminders", status: "ok" },
      { job_name: "tick", status: "ok" },
    ]);
  });

  it("bearerMatches is strict", () => {
    expect(bearerMatches("Bearer abc", "abc")).toBe(true);
    expect(bearerMatches("bearer abc", "abc")).toBe(false);
    expect(bearerMatches("Bearer abc", undefined)).toBe(false);
    expect(bearerMatches(undefined, "abc")).toBe(false);
  });
});
