import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { backupDirOf, dailyBackup, KEEP_DAILY_BACKUPS, listBackups } from "../backend/src/db/backups.js";
import type { TestApp } from "./helpers/app.js";
import { get, makeAuthApp, signUpWithOrg } from "./helpers/auth.js";
import { addPerson, roleIds } from "./helpers/roles.js";

let t: TestApp | undefined;
afterEach(() => { t?.cleanup(); t = undefined; });

describe("daily backup (batch K)", () => {
  it("makes a consistent copy that opens and passes SQLite's integrity check, with the data in it", async () => {
    t = makeAuthApp();
    await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const dir = backupDirOf(t.db)!;
    const r = await dailyBackup(t.db, dir, new Date("2026-11-24T03:00:00Z"));
    expect(r.file).toBe("daily-2026-11-24T03-00-00-000Z.db");
    const copy = new Database(path.join(dir, r.file), { readonly: true });
    expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
    expect((copy.prepare("SELECT COUNT(*) n FROM users").get() as { n: number }).n).toBe(1);
    expect((copy.prepare("SELECT COUNT(*) n FROM organizations").get() as { n: number }).n).toBe(1);
    copy.close();
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".partial"))).toEqual([]); // no half-written file is left behind
  });

  it("keeps the newest 14 daily copies and removes older ones, and never touches the pre-migration copies", async () => {
    t = makeAuthApp();
    const dir = backupDirOf(t.db)!;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "pre-0005-2026-01-01T00-00-00-000Z.db"), "x");
    for (let d = 1; d <= 17; d++) await dailyBackup(t.db, dir, new Date(Date.UTC(2026, 10, d, 3)));
    const files = listBackups(dir);
    const daily = files.filter((f) => f.kind === "daily").map((f) => f.name).sort();
    expect(daily).toHaveLength(KEEP_DAILY_BACKUPS);
    expect(daily[0]).toBe("daily-2026-11-04T03-00-00-000Z.db"); // days 1 to 3 are gone
    expect(daily.at(-1)).toBe("daily-2026-11-17T03-00-00-000Z.db");
    expect(files.some((f) => f.kind === "pre-migration")).toBe(true);
  });

  it("a failing check removes the file instead of counting it as a backup", async () => {
    t = makeAuthApp();
    const dir = backupDirOf(t.db)!;
    const broken = { name: t.db.name, backup: async (dest: string) => { fs.writeFileSync(dest, "this is not a database"); } } as unknown as Database.Database;
    await expect(dailyBackup(broken, dir, new Date())).rejects.toBeTruthy();
    expect(listBackups(dir)).toEqual([]);
    expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([]);
  });

  it("the tick takes the backup; the System page (administrators only) shows it plainly, with the honest warning", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ids = await roleIds(t.app, owner);
    const emma = await addPerson(t.app, owner, "emma@example.com", ids.employee, "Emma Employee");
    const max = await addPerson(t.app, owner, "max@example.com", ids.manager, "Max Manager");
    expect((await get(t.app, "/api/system")).status).toBe(401);
    expect((await get(t.app, "/api/system", emma.cookie)).status).toBe(403);
    expect((await get(t.app, "/api/system", max.cookie)).status).toBe(403); // a manager is not an administrator
    const before = (await get(t.app, "/api/system", owner)).body.data;
    expect(before.backups).toMatchObject({ count: 0, newest: null, lastRun: null });
    await t.tick.run();
    const s = (await get(t.app, "/api/system", owner)).body.data;
    expect(s.backups.daily).toEqual({ count: 1, keep: 14 });
    expect(s.backups.lastRun).toMatchObject({ status: "ok", error: null });
    expect(s.backups.newest.name).toMatch(/^daily-.*\.db$/);
    expect(s.backups.warning).toMatch(/same disk as the database/);
    expect(s.backups.warning).toMatch(/do NOT protect against losing the server/);
    expect(s.migrations.applied).toBe(s.migrations.total);
    expect(s.database.sizeBytes).toBeGreaterThan(0);
    expect(s.jobs.map((j: { name: string }) => j.name)).toContain("platform.backup");
    // no folder path, and the copy it names passes the integrity check
    expect(JSON.stringify(s)).not.toContain(t.dir);
    const copy = new Database(path.join(backupDirOf(t.db)!, s.backups.newest.name), { readonly: true });
    expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
    copy.close();
    // running the tick again the same day does not make a second copy
    await t.tick.run();
    expect((await get(t.app, "/api/system", owner)).body.data.backups.daily.count).toBe(1);
  });

  it("backups are never served over the web, whatever the address", async () => {
    const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), "zentro-static-"));
    fs.writeFileSync(path.join(staticDir, "index.html"), "<!doctype html><title>app</title>");
    t = makeAuthApp({ staticDir });
    const dir = backupDirOf(t.db)!;
    const r = await dailyBackup(t.db, dir, new Date("2026-11-24T03:00:00Z"));
    for (const url of [`/backups/${r.file}`, `/data/backups/${r.file}`, `/${r.file}`, `/..%2fbackups%2f${r.file}`, `/%2e%2e/backups/${r.file}`, `/api/backups/${r.file}`, "/zentro.db", "/backups/"]) {
      const res = await get(t.app, url);
      expect(String(res.headers["content-type"] ?? ""), url).not.toMatch(/octet-stream|sqlite/);
      expect(res.text ?? "", url).not.toContain("SQLite format");
      expect(Buffer.isBuffer(res.body) ? res.body.subarray(0, 15).toString() : "", url).not.toBe("SQLite format 3");
    }
    fs.rmSync(staticDir, { recursive: true, force: true });
  });
});

describe("restoring a daily backup (batch K)", () => {
  it("the existing restore-at-start-up accepts a daily backup by name, takes a safety copy first, and the restored data is the backup's", async () => {
    const { applyRestoreRequest } = await import("../backend/src/db/restore.js");
    const { createLogger } = await import("../backend/src/lib/logger.js");
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "zentro-restore-"));
    const dbFile = path.join(dataDir, "zentro.db");
    const db = new Database(dbFile);
    db.exec("CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, name TEXT, checksum TEXT, applied_at TEXT); INSERT INTO schema_migrations VALUES ('0001','a','x','now'); CREATE TABLE notes (t TEXT); INSERT INTO notes VALUES ('before');");
    const r = await dailyBackup(db, path.join(dataDir, "backups"), new Date("2026-11-24T03:00:00Z"));
    db.exec("INSERT INTO notes VALUES ('after the backup')");
    db.close();
    const lines: string[] = [];
    const res = applyRestoreRequest({ dataDir, request: r.file, log: createLogger("debug", (l) => lines.push(l)) });
    expect(res.outcome, JSON.stringify(res)).toBe("restored");
    expect(res.preRestoreBackup).toMatch(/^pre-restore-/);
    const back = new Database(dbFile, { readonly: true });
    expect((back.prepare("SELECT t FROM notes").all() as { t: string }[]).map((x) => x.t)).toEqual(["before"]);
    back.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});
