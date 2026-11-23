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
 * Upgrade rehearsal for migration 0010 (stage 2.8, the demo data framework): a database as batch B left it (migrations 0001 to 0009, an
 * organization with people and tasks created and worked in through the app) is upgraded, restored from the automatic backup, upgraded again,
 * and the older migration list is shown to run on the upgraded data (a rollback).
 */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "zentro-upgrade28-"));
  dirs.push(d);
  return d;
};
const upTo = (last: number): string => {
  const d = tmp();
  for (const f of fs.readdirSync(migrationsDir).filter((x) => Number(x.slice(0, 4)) <= last)) fs.copyFileSync(path.join(migrationsDir, f), path.join(d, f));
  return d;
};
const quiet = createLogger("error", () => undefined);
const appOn = (db: Database.Database) => createApp({ db, config: testConfig({ REGISTRATION_MODE: "code", REGISTRATION_CODE: TEST_CODE }), version: "t", cronSecret: undefined, migrationsTotal: 15, log: quiet });
const cookieOf = (res: { headers: Record<string, unknown> }) => ([] as string[]).concat((res.headers["set-cookie"] as string[]) ?? []).find((c) => c.startsWith("zentro_session="))!.split(";")[0]!;
const count = (db: Database.Database, sql: string) => (db.prepare(sql).get() as { n: number }).n;
const hasTable = (db: Database.Database, name: string) => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name) !== undefined;

/** The batch B state: registered through the app at migration 0009, a person and a task. */
async function seed9(db: Database.Database): Promise<{ cookie: string }> {
  const { app } = appOn(db);
  const cookie = await signUpWithOrg(app, "owner@example.com", "Acme Robotics");
  const p = await post(app, "/api/employees", { name: "Ann Boss" }, cookie);
  expect(p.status).toBe(201);
  // a task as batch B stored it (the current app code reads columns that arrive in 0011, so it is written directly)
  const org = db.prepare("SELECT id FROM organizations LIMIT 1").get() as { id: string };
  const me = db.prepare("SELECT id FROM organization_memberships WHERE organization_id = ? ORDER BY created_at LIMIT 1").get(org.id) as { id: string };
  const now = new Date().toISOString();
  db.prepare("INSERT INTO tasks (id, organization_id, title, description, status, priority, importance_weight, progress_pct, actual_minutes, created_by_membership_id, is_demo, created_at, updated_at) VALUES ('11111111-1111-4111-8111-111111111111', ?, 'A task from before the upgrade', '', 'not_started', 'medium', 3, 0, 0, ?, 0, ?, ?)").run(org.id, me.id, now, now);
  db.prepare("INSERT INTO task_assignments (id, organization_id, task_id, assignee_membership_id, role, assigned_by_membership_id, assigned_at) VALUES ('22222222-2222-4222-8222-222222222222', ?, '11111111-1111-4111-8111-111111111111', ?, 'assignee', ?, ?)").run(org.id, p.body.data.id, me.id, now);
  return { cookie };
}

describe("upgrading a batch B database (migration 0009) to the demo data framework (migration 0010)", () => {
  it("takes the automatic backup, adds one table, and everything that worked before still works, including loading and removing demo data", async () => {
    const { db } = openDatabase(tmp());
    migrate(db, upTo(9));
    await seed9(db);
    expect(hasTable(db, "demo_data_batches")).toBe(false);
    const result = migrate(db, upTo(10));
    expect(result.applied).toEqual(["0010_demo_data.sql"]);
    expect(result.backupFile).toMatch(/pre-0010-.*\.db$/);
    expect(hasTable(db, "demo_data_batches")).toBe(true);
    expect(count(db, "SELECT COUNT(*) n FROM demo_data_batches")).toBe(0);
    migrate(db, migrationsDir); // the server applies every migration at start-up before it serves anything
    const { app } = appOn(db);
    const cookie = cookieOf(await post(app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD }));
    expect((await get(app, "/api/tasks", cookie)).body.data.total).toBe(1);
    const real = { people: count(db, "SELECT COUNT(*) n FROM organization_memberships"), tasks: count(db, "SELECT COUNT(*) n FROM tasks") };
    expect((await post(app, "/api/demo/load", undefined, cookie)).status).toBe(201);
    expect(count(db, "SELECT COUNT(*) n FROM organization_memberships WHERE is_demo = 1")).toBeGreaterThan(55);
    expect((await post(app, "/api/demo/remove", undefined, cookie)).status).toBe(200);
    expect({ people: count(db, "SELECT COUNT(*) n FROM organization_memberships"), tasks: count(db, "SELECT COUNT(*) n FROM tasks") }).toEqual(real);
    db.close();
  });

  it("restoring from the automatic backup returns the database to its batch B state, and it upgrades again", async () => {
    const dataDir = tmp();
    const { db } = openDatabase(dataDir);
    migrate(db, upTo(9));
    await seed9(db);
    const up = migrate(db, upTo(10));
    migrate(db, migrationsDir);
    const backup = path.basename(up.backupFile!);
    const copy = new Database(up.backupFile!, { readonly: true });
    expect((copy.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check).toBe("ok");
    expect((copy.prepare("SELECT COUNT(*) n FROM schema_migrations").get() as { n: number }).n).toBe(9);
    copy.close();
    const { app } = appOn(db);
    const cookie = cookieOf(await post(app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD }));
    await post(app, "/api/demo/load", undefined, cookie); // work after the upgrade
    expect(count(db, "SELECT COUNT(*) n FROM demo_data_batches")).toBe(1);
    db.close();

    const restore = applyRestoreRequest({ dataDir, request: backup, log: quiet });
    expect(restore.outcome).toBe("restored");
    const reopened = openDatabase(dataDir).db;
    expect(count(reopened, "SELECT COUNT(*) n FROM schema_migrations")).toBe(9);
    expect(hasTable(reopened, "demo_data_batches")).toBe(false);
    expect(count(reopened, "SELECT COUNT(*) n FROM organization_memberships")).toBe(2); // the owner and Ann only: the demo people are gone
    const safety = new Database(path.join(dataDir, "backups", restore.preRestoreBackup!), { readonly: true });
    expect((safety.prepare("SELECT COUNT(*) n FROM organization_memberships WHERE is_demo = 1").get() as { n: number }).n).toBeGreaterThan(55); // kept in the safety backup
    safety.close();
    expect(migrate(reopened, migrationsDir).applied).toEqual(["0010_demo_data.sql", "0011_objectives_and_task_links.sql", "0012_alignment_and_health.sql", "0013_kpi_definitions.sql", "0014_kpi_measurements.sql", "0015_scoring_models.sql", "0016_scorecards.sql", "0017_comparisons.sql"]);
    expect((await post(appOn(reopened).app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD })).status).toBe(200);
    reopened.close();
  });

  it("a rollback is safe: the batch B migration list opens the upgraded database, demo rows are plain rows to it, and its queries work", async () => {
    const { db } = openDatabase(tmp());
    migrate(db, upTo(9));
    await seed9(db);
    migrate(db, migrationsDir);
    const { app } = appOn(db);
    const cookie = cookieOf(await post(app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD }));
    await post(app, "/api/demo/load", undefined, cookie);
    const older = migrate(db, upTo(9)); // what the batch B build does when it starts on this database
    expect(older.applied).toEqual([]);
    expect(older.unknownApplied).toEqual(["0010", "0011", "0012", "0013", "0014", "0015", "0016", "0017"]);
    // the older code reads the same tables (demo people and tasks are ordinary rows with is_demo = 1) and the real data is intact
    expect(count(db, "SELECT COUNT(*) n FROM tasks WHERE is_demo = 0")).toBe(1);
    expect(count(db, "SELECT COUNT(*) n FROM organization_memberships WHERE is_demo = 0")).toBe(2);
    db.close();
  });
});
