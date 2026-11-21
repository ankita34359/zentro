import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bearerMatches, createApp } from "../backend/src/app.js";
import { migrate } from "../backend/src/db/migrate.js";
import { openDatabase } from "../backend/src/db/open.js";

const migrationsDir = path.resolve(import.meta.dirname, "../database/migrations");
let tmp: string;

function setup(cronSecret: string | undefined = "s3cret-for-tests") {
  const { db, file } = openDatabase(tmp);
  migrate(db, migrationsDir);
  const app = createApp({ db, dbFile: file, version: "test", appName: "zentro-test", cronSecret });
  return { db, file, app };
}

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zentro-")); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe("migrations", () => {
  it("applies once, is idempotent, and rejects an edited migration", () => {
    const { db } = openDatabase(tmp);
    expect(migrate(db, migrationsDir).applied).toEqual(["0001_spike_counters.sql"]);
    expect(migrate(db, migrationsDir).applied).toEqual([]);

    const copy = fs.mkdtempSync(path.join(os.tmpdir(), "zentro-mig-"));
    fs.writeFileSync(path.join(copy, "0001_spike_counters.sql"), "CREATE TABLE changed (x TEXT);");
    expect(() => migrate(db, copy)).toThrow(/checksum mismatch/);
    fs.rmSync(copy, { recursive: true, force: true });
    db.close();
  });
});

describe("healthz and counter", () => {
  it("answers ok and reports the running Node version", async () => {
    const { app, db } = setup();
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, version: "test", node: process.versions.node });
    db.close();
  });

  it("counts visits and keeps the count when the database is reopened (a redeploy)", async () => {
    const first = setup();
    await request(first.app).post("/api/spike/visit");
    const res = await request(first.app).post("/api/spike/visit");
    expect(res.body.visits).toBe(2);
    first.db.close();

    const second = setup();
    const info = await request(second.app).get("/api/spike");
    expect(info.body.visits).toBe(2);
    expect(info.body.dbPath).toBe(path.join(tmp, "zentro.db"));
    second.db.close();
  });

  it("returns JSON 404 for unknown /api routes", async () => {
    const { app, db } = setup();
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
    db.close();
  });
});

describe("cron tick", () => {
  it("rejects missing or wrong bearer with 401", async () => {
    const { app, db } = setup();
    expect((await request(app).get("/api/cron/tick")).status).toBe(401);
    expect((await request(app).get("/api/cron/tick").set("Authorization", "Bearer wrong")).status).toBe(401);
    db.close();
  });

  it("always rejects when CRON_SECRET is unset", async () => {
    const { app, db } = setup(undefined);
    expect((await request(app).get("/api/cron/tick").set("Authorization", "Bearer ")).status).toBe(401);
    expect((await request(app).get("/api/cron/tick").set("Authorization", "Bearer undefined")).status).toBe(401);
    db.close();
  });

  it("answers 202 and records the tick", async () => {
    const { app, db } = setup();
    const res = await request(app).get("/api/cron/tick").set("Authorization", "Bearer s3cret-for-tests");
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ started: true });
    await new Promise((r) => setTimeout(r, 50));
    const info = await request(app).get("/api/spike");
    expect(info.body.ticks).toBe(1);
    expect(info.body.lastTickAt).toBeTruthy();
    db.close();
  });

  it("bearerMatches is strict", () => {
    expect(bearerMatches("Bearer abc", "abc")).toBe(true);
    expect(bearerMatches("bearer abc", "abc")).toBe(false);
    expect(bearerMatches("Bearer abc", undefined)).toBe(false);
    expect(bearerMatches(undefined, "abc")).toBe(false);
  });
});
