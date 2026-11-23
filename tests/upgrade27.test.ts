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
 * Upgrade rehearsal for migration 0009 (stages 4.1, 4.4 and 4.5): a database as batch A left it (migrations 0001 to 0008, an
 * organization with people created and worked in through the app) is upgraded, restored from the automatic backup, upgraded again,
 * and the older migration list is shown to run on the upgraded data (a rollback).
 */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "zentro-upgrade27-"));
  dirs.push(d);
  return d;
};
const upTo = (last: number): string => {
  const d = tmp();
  for (const f of fs.readdirSync(migrationsDir).filter((x) => Number(x.slice(0, 4)) <= last)) fs.copyFileSync(path.join(migrationsDir, f), path.join(d, f));
  return d;
};
const quiet = createLogger("error", () => undefined);
const appOn = (db: Database.Database) => createApp({ db, config: testConfig({ REGISTRATION_MODE: "code", REGISTRATION_CODE: TEST_CODE }), version: "t", cronSecret: undefined, migrationsTotal: 9, log: quiet });
const cookieOf = (res: { headers: Record<string, unknown> }) => ([] as string[]).concat((res.headers["set-cookie"] as string[]) ?? []).find((c) => c.startsWith("zentro_session="))!.split(";")[0]!;
const count = (db: Database.Database, sql: string) => (db.prepare(sql).get() as { n: number }).n;
const hasTable = (db: Database.Database, name: string) => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name) !== undefined;

/** The batch A state: registered through the app at migration 0008, a team and two people placed under each other. */
async function seed8(db: Database.Database): Promise<{ cookie: string; ann: string; bo: string }> {
  const { app } = appOn(db);
  const cookie = await signUpWithOrg(app, "owner@example.com", "Acme Robotics");
  const dep = await post(app, "/api/departments", { name: "Engineering" }, cookie);
  const team = await post(app, "/api/teams", { name: "Core", departmentId: dep.body.data.id }, cookie);
  const ann = await post(app, "/api/employees", { name: "Ann Boss", teamId: team.body.data.id }, cookie);
  const bo = await post(app, "/api/employees", { name: "Bo Dev", teamId: team.body.data.id, managerId: ann.body.data.id }, cookie);
  expect(bo.status).toBe(201);
  return { cookie, ann: ann.body.data.id, bo: bo.body.data.id };
}
const NEW_TABLES = ["tasks", "task_assignments", "task_updates", "task_comments", "daily_updates", "notifications", "notification_preferences", "automation_events"];

describe("upgrading a batch A database (migration 0008) to stages 4.1, 4.4 and 4.5 (migration 0009)", () => {
  it("takes the automatic backup, adds only new tables, and everything that worked before still works", async () => {
    const { db } = openDatabase(tmp());
    migrate(db, upTo(8));
    await seed8(db);
    for (const table of NEW_TABLES) expect(hasTable(db, table), table).toBe(false);
    const result = migrate(db, upTo(9));
    expect(result.applied).toEqual(["0009_tasks_and_notifications.sql"]);
    expect(result.backupFile).toMatch(/pre-0009-.*\.db$/);
    expect(fs.existsSync(result.backupFile!)).toBe(true);
    for (const table of NEW_TABLES) {
      expect(hasTable(db, table), table).toBe(true);
      expect(count(db, `SELECT COUNT(*) n FROM ${table}`), table).toBe(0);
    }
    const { app, tick } = appOn(db);
    const login = await post(app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD });
    expect(login.status).toBe(200);
    const cookie = cookieOf(login);
    expect((await get(app, "/api/employees", cookie)).body.data.people.map((p: { displayName: string }) => p.displayName).sort()).toEqual(["Ann Boss", "Bo Dev", "Test Person"]);
    expect((await get(app, "/api/hierarchy/tree", cookie)).body.data.nodes.map((n: { name: string }) => n.name).sort()).toEqual(["Ann Boss", "Test Person"]);
    const bo = (await get(app, "/api/employees", cookie)).body.data.people.find((p: { displayName: string }) => p.displayName === "Bo Dev").id;
    const made = await post(app, "/api/tasks", { title: "First task after the upgrade", assigneeIds: [bo], dueAt: "2020-01-01" }, cookie);
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(count(db, "SELECT COUNT(*) n FROM audit_logs WHERE action = 'task.create'")).toBe(1);
    await tick.run();
    expect(count(db, "SELECT COUNT(*) n FROM notifications WHERE type = 'task.overdue'")).toBe(2); // the person doing it and its creator
    db.close();
  });

  it("restoring from the automatic backup returns the database to its batch A state, and it upgrades again", async () => {
    const dataDir = tmp();
    const { db } = openDatabase(dataDir);
    migrate(db, upTo(8));
    await seed8(db);
    const up = migrate(db, upTo(9));
    const backup = path.basename(up.backupFile!);
    const copy = new Database(up.backupFile!, { readonly: true });
    expect((copy.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check).toBe("ok");
    expect((copy.prepare("SELECT COUNT(*) n FROM schema_migrations").get() as { n: number }).n).toBe(8);
    copy.close();
    const { app } = appOn(db);
    const cookie = cookieOf(await post(app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD }));
    await post(app, "/api/tasks", { title: "Made after the upgrade" }, cookie);
    expect(count(db, "SELECT COUNT(*) n FROM tasks")).toBe(1);
    db.close();

    const restore = applyRestoreRequest({ dataDir, request: backup, log: quiet });
    expect(restore.outcome).toBe("restored");
    const reopened = openDatabase(dataDir).db;
    expect(count(reopened, "SELECT COUNT(*) n FROM schema_migrations")).toBe(8);
    expect(hasTable(reopened, "tasks")).toBe(false);
    expect(count(reopened, "SELECT COUNT(*) n FROM organization_memberships")).toBe(3); // the people are still there
    const safety = new Database(path.join(dataDir, "backups", restore.preRestoreBackup!), { readonly: true });
    expect((safety.prepare("SELECT COUNT(*) n FROM tasks").get() as { n: number }).n).toBe(1); // the work after the upgrade is kept in the safety backup
    safety.close();
    expect(migrate(reopened, upTo(9)).applied).toEqual(["0009_tasks_and_notifications.sql"]);
    expect((await post(appOn(reopened).app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD })).status).toBe(200);
    reopened.close();
  });

  it("a rollback is safe: the batch A migration list opens the upgraded database, and the batch A queries still work", async () => {
    const { db } = openDatabase(tmp());
    migrate(db, upTo(8));
    await seed8(db);
    migrate(db, upTo(9));
    const { app } = appOn(db);
    const cookie = cookieOf(await post(app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD }));
    await post(app, "/api/tasks", { title: "Written by the new code" }, cookie);
    const older = migrate(db, upTo(8)); // what the batch A build does when it starts on this database
    expect(older.applied).toEqual([]);
    expect(older.unknownApplied).toEqual(["0009"]);
    // the older code's statements still run: it never names the new tables
    expect(count(db, "SELECT COUNT(*) n FROM reporting_relationships WHERE end_date IS NULL")).toBe(1);
    expect(count(db, "SELECT COUNT(*) n FROM organization_memberships")).toBe(3);
    // and removing a person (a batch A action) is not blocked by the new tables: they point at memberships, which are only ever detached
    expect(() => db.prepare("UPDATE organization_memberships SET status = 'left' WHERE display_name = 'Bo Dev'").run()).not.toThrow();
    db.close();
  });
});
