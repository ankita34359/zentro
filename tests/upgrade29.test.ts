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
 * Upgrade rehearsal for migration 0011 (stages 3.1 and 4.2, objectives and task links): a database as batch C left it (migrations 0001 to 0010, an
 * organization with people and tasks created and worked in through the app) is upgraded, restored from the automatic backup, upgraded again,
 * and the older migration list is shown to run on the upgraded data (a rollback).
 */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "zentro-upgrade29-"));
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

/** The batch C state: registered through the app at migration 0010, a person and a task. */
async function seed10(db: Database.Database): Promise<{ cookie: string }> {
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


describe("upgrading a batch C database (migration 0010) to objectives and task links (migration 0011)", () => {
  it("takes the automatic backup, adds the new tables and nullable columns only, and everything that worked before still works", async () => {
    const { db } = openDatabase(tmp());
    migrate(db, upTo(10));
    await seed10(db);
    expect(hasTable(db, "objectives")).toBe(false);
    const before = JSON.stringify(db.prepare("SELECT id, title, status, priority, due_at FROM tasks").all());
    const result = migrate(db, upTo(11));
    expect(result.applied).toEqual(["0011_objectives_and_task_links.sql"]);
    expect(result.backupFile).toMatch(/pre-0011-.*\.db$/);
    for (const table of ["objectives", "key_results", "objective_progress_history", "task_dependencies"]) {
      expect(hasTable(db, table), table).toBe(true);
      expect(count(db, `SELECT COUNT(*) n FROM ${table}`), table).toBe(0);
    }
    migrate(db, migrationsDir); // the server applies every migration at start-up before it serves anything
    expect(JSON.stringify(db.prepare("SELECT id, title, status, priority, due_at FROM tasks").all())).toBe(before); // existing rows unchanged
    expect(db.prepare("SELECT objective_id, key_result_id, outcome_summary, outcome_quality FROM tasks").get()).toEqual({ objective_id: null, key_result_id: null, outcome_summary: null, outcome_quality: null });
    const { app } = appOn(db);
    const cookie = cookieOf(await post(app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD }));
    expect((await get(app, "/api/tasks", cookie)).body.data.total).toBe(1);
    const o = await post(app, "/api/objectives", { level: "company", title: "After the upgrade", startDate: "2026-01-01", endDate: "2026-12-31", keyResults: [{ title: "k", targetValue: 10 }] }, cookie);
    expect(o.status, JSON.stringify(o.body)).toBe(201);
    expect((await get(app, "/api/tasks", cookie)).body.data.tasks[0].id).toBeTruthy();
    expect((await post(app, "/api/demo/load", undefined, cookie)).status).toBe(201); // the demo now carries objectives too
    expect(count(db, "SELECT COUNT(*) n FROM objectives WHERE is_demo = 1")).toBeGreaterThan(8);
    expect((await post(app, "/api/demo/remove", undefined, cookie)).status).toBe(200);
    expect(count(db, "SELECT COUNT(*) n FROM objectives")).toBe(1);
    db.close();
  });

  it("restoring from the automatic backup returns the database to its batch C state, and it upgrades again", async () => {
    const dataDir = tmp();
    const { db } = openDatabase(dataDir);
    migrate(db, upTo(10));
    await seed10(db);
    const up = migrate(db, upTo(11));
    migrate(db, migrationsDir);
    const backup = path.basename(up.backupFile!);
    const copy = new Database(up.backupFile!, { readonly: true });
    expect((copy.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check).toBe("ok");
    expect((copy.prepare("SELECT COUNT(*) n FROM schema_migrations").get() as { n: number }).n).toBe(10);
    copy.close();
    const { app } = appOn(db);
    const cookie = cookieOf(await post(app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD }));
    await post(app, "/api/objectives", { level: "company", title: "Made after the upgrade", startDate: "2026-01-01", endDate: "2026-12-31" }, cookie);
    expect(count(db, "SELECT COUNT(*) n FROM objectives")).toBe(1);
    db.close();

    const restore = applyRestoreRequest({ dataDir, request: backup, log: quiet });
    expect(restore.outcome).toBe("restored");
    const reopened = openDatabase(dataDir).db;
    expect(count(reopened, "SELECT COUNT(*) n FROM schema_migrations")).toBe(10);
    expect(hasTable(reopened, "objectives")).toBe(false);
    expect(count(reopened, "SELECT COUNT(*) n FROM tasks")).toBe(1);
    const safety = new Database(path.join(dataDir, "backups", restore.preRestoreBackup!), { readonly: true });
    expect((safety.prepare("SELECT COUNT(*) n FROM objectives").get() as { n: number }).n).toBe(1); // the work after the upgrade is kept in the safety backup
    safety.close();
    expect(migrate(reopened, migrationsDir).applied).toEqual(["0011_objectives_and_task_links.sql", "0012_alignment_and_health.sql", "0013_kpi_definitions.sql", "0014_kpi_measurements.sql", "0015_scoring_models.sql", "0016_scorecards.sql"]);
    expect((await post(appOn(reopened).app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD })).status).toBe(200);
    reopened.close();
  });

  it("a rollback is safe: the batch C migration list opens the upgraded database, and its own queries still work", async () => {
    const { db } = openDatabase(tmp());
    migrate(db, upTo(10));
    await seed10(db);
    migrate(db, migrationsDir);
    const { app } = appOn(db);
    const cookie = cookieOf(await post(app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD }));
    const o = (await post(app, "/api/objectives", { level: "company", title: "Kept", startDate: "2026-01-01", endDate: "2026-12-31", keyResults: [{ title: "k", targetValue: 10 }] }, cookie)).body.data;
    await post(app, `/api/key-results/${o.keyResults[0].id}/progress`, { value: 3 }, cookie);
    const older = migrate(db, upTo(10)); // what the batch C build does when it starts on this database
    expect(older.applied).toEqual([]);
    expect(older.unknownApplied).toEqual(["0011", "0012", "0013", "0014", "0015", "0016"]);
    // the batch C queries (the columns it knows) read the same rows, and the new tables are simply ignored by it
    expect(count(db, "SELECT COUNT(*) n FROM tasks WHERE is_demo = 0")).toBe(1);
    expect(db.prepare("SELECT id, title, status, priority, importance_weight, progress_pct, start_date, due_at, estimated_minutes, actual_minutes, completed_at, blocked_reason, team_id, parent_task_id, created_by_membership_id, archived_at, is_demo, created_at, updated_at FROM tasks").all()).toHaveLength(1);
    expect(count(db, "SELECT COUNT(*) n FROM objective_progress_history")).toBe(1); // kept for when the new version returns
    db.close();
  });
});
