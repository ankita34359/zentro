import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../backend/src/app.js";
import { migrate } from "../backend/src/db/migrate.js";
import { openDatabase } from "../backend/src/db/open.js";
import { applyRestoreRequest } from "../backend/src/db/restore.js";
import { createLogger } from "../backend/src/lib/logger.js";
import { migrationsDir, testConfig } from "./helpers/app.js";
import { get, post, PASSWORD, signUpWithOrg, TEST_CODE } from "./helpers/auth.js";

/**
 * Upgrade rehearsal for migration 0007 (stage 2.5): a database as stage 2.4 left it (migrations 0001 to 0006, an
 * organization created and worked in through the app) is upgraded, restored from the automatic backup, upgraded again,
 * and the older migration list is shown to run on the upgraded data (a rollback).
 */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "zentro-upgrade25-"));
  dirs.push(d);
  return d;
};
const upTo = (last: number): string => {
  const d = tmp();
  for (const f of fs.readdirSync(migrationsDir).filter((x) => Number(x.slice(0, 4)) <= last)) fs.copyFileSync(path.join(migrationsDir, f), path.join(d, f));
  return d;
};
const quiet = createLogger("error", () => undefined);
const appOn = (db: Database.Database) => createApp({ db, config: testConfig({ REGISTRATION_MODE: "code", REGISTRATION_CODE: TEST_CODE }), version: "t", cronSecret: undefined, migrationsTotal: 7, log: quiet });
const cookieOf = (res: { headers: Record<string, unknown> }) => ([] as string[]).concat((res.headers["set-cookie"] as string[]) ?? []).find((c) => c.startsWith("zentro_session="))!.split(";")[0]!;
const count = (db: Database.Database, sql: string) => (db.prepare(sql).get() as { n: number }).n;
const hasTable = (db: Database.Database, name: string) => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name) !== undefined;

/** The 2.4 state: registered through the app at migration 0006, one role made. */
async function seed24(db: Database.Database): Promise<string> {
  const { app } = appOn(db);
  const cookie = await signUpWithOrg(app, "owner@example.com", "Acme Robotics");
  expect((await post(app, "/api/roles", { name: "Program Director" }, cookie)).status).toBe(201);
  return cookie;
}

describe("upgrading a stage 2.4 database to 2.5 (migration 0007)", () => {
  it("takes the automatic backup, adds only new tables, and everything that worked before still works", async () => {
    const { db } = openDatabase(tmp());
    migrate(db, upTo(6));
    await seed24(db);
    expect(hasTable(db, "departments")).toBe(false);
    const result = migrate(db, migrationsDir);
    expect(result.applied).toEqual(["0007_organization_structure.sql"]);
    expect(result.backupFile).toMatch(/pre-0007-.*\.db$/);
    expect(fs.existsSync(result.backupFile!)).toBe(true);
    for (const table of ["departments", "teams", "role_families", "designations"]) {
      expect(hasTable(db, table), table).toBe(true);
      expect(count(db, `SELECT COUNT(*) n FROM ${table}`), table).toBe(0);
    }
    const { app } = appOn(db);
    const login = await post(app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD });
    expect(login.status).toBe(200);
    const cookie = cookieOf(login);
    expect((await get(app, "/api/organization/structure", cookie)).body.data).toMatchObject({ departments: [], teams: [], roleFamilies: [], designations: [], partial: false });
    expect((await get(app, "/api/roles", cookie)).body.data.map((r: { name: string }) => r.name)).toContain("Program Director");
    expect((await post(app, "/api/departments", { name: "Engineering" }, cookie)).status).toBe(201);
    expect(count(db, "SELECT COUNT(*) n FROM audit_logs WHERE action = 'department.create'")).toBe(1);
    db.close();
  });

  it("restoring from the automatic backup returns the database to its 2.4 state, and it upgrades again", async () => {
    const dataDir = tmp();
    const { db } = openDatabase(dataDir);
    migrate(db, upTo(6));
    await seed24(db);
    const up = migrate(db, migrationsDir);
    const backup = path.basename(up.backupFile!);
    const copy = new Database(up.backupFile!, { readonly: true });
    expect((copy.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check).toBe("ok");
    expect((copy.prepare("SELECT COUNT(*) n FROM schema_migrations").get() as { n: number }).n).toBe(6);
    copy.close();
    const { app } = appOn(db);
    const cookie = cookieOf(await post(app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD }));
    await post(app, "/api/departments", { name: "Made After Upgrade" }, cookie);
    expect(count(db, "SELECT COUNT(*) n FROM departments")).toBe(1);
    db.close();

    const restore = applyRestoreRequest({ dataDir, request: backup, log: quiet });
    expect(restore.outcome).toBe("restored");
    const reopened = openDatabase(dataDir).db;
    expect(count(reopened, "SELECT COUNT(*) n FROM schema_migrations")).toBe(6);
    expect(hasTable(reopened, "departments")).toBe(false);
    const safety = new Database(path.join(dataDir, "backups", restore.preRestoreBackup!), { readonly: true });
    expect((safety.prepare("SELECT COUNT(*) n FROM departments").get() as { n: number }).n).toBe(1); // the work after the upgrade is kept in the safety backup
    safety.close();
    expect(migrate(reopened, migrationsDir).applied).toEqual(["0007_organization_structure.sql"]);
    const login = await post(appOn(reopened).app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD });
    expect(login.status).toBe(200);
    reopened.close();
  });

  it("a rollback is safe: the stage 2.4 migration list opens the upgraded database, and the 2.4 queries still work", async () => {
    const { db } = openDatabase(tmp());
    migrate(db, upTo(6));
    await seed24(db);
    migrate(db, migrationsDir);
    const older = migrate(db, upTo(6)); // what the 2.4 build does when it starts on this database
    expect(older.applied).toEqual([]);
    expect(older.unknownApplied).toEqual(["0007"]);
    // the 2.4 code runs on the 2.4 tables, untouched by the new ones
    expect(count(db, "SELECT COUNT(*) n FROM roles WHERE name = 'Program Director'")).toBe(1);
    expect(count(db, "SELECT COUNT(*) n FROM organization_memberships")).toBe(1);
    db.close();
  });
});
