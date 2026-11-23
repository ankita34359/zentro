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
 * Upgrade rehearsal for migration 0008 (stages 2.6 and 2.7): a database as stage 2.5 left it (migrations 0001 to 0007, an
 * organization created and worked in through the app) is upgraded, restored from the automatic backup, upgraded again,
 * and the older migration list is shown to run on the upgraded data (a rollback).
 */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "zentro-upgrade26-"));
  dirs.push(d);
  return d;
};
const upTo = (last: number): string => {
  const d = tmp();
  for (const f of fs.readdirSync(migrationsDir).filter((x) => Number(x.slice(0, 4)) <= last)) fs.copyFileSync(path.join(migrationsDir, f), path.join(d, f));
  return d;
};
const quiet = createLogger("error", () => undefined);
const appOn = (db: Database.Database) => createApp({ db, config: testConfig({ REGISTRATION_MODE: "code", REGISTRATION_CODE: TEST_CODE }), version: "t", cronSecret: undefined, migrationsTotal: 8, log: quiet });
const cookieOf = (res: { headers: Record<string, unknown> }) => ([] as string[]).concat((res.headers["set-cookie"] as string[]) ?? []).find((c) => c.startsWith("zentro_session="))!.split(";")[0]!;
const count = (db: Database.Database, sql: string) => (db.prepare(sql).get() as { n: number }).n;
const hasTable = (db: Database.Database, name: string) => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name) !== undefined;

/** The 2.5 state: registered through the app at migration 0007, a department, a team and a designation made. */
async function seed25(db: Database.Database): Promise<string> {
  const { app } = appOn(db);
  const cookie = await signUpWithOrg(app, "owner@example.com", "Acme Robotics");
  const dep = await post(app, "/api/departments", { name: "Engineering" }, cookie);
  expect(dep.status).toBe(201);
  expect((await post(app, "/api/teams", { name: "Core", departmentId: dep.body.data.id }, cookie)).status).toBe(201);
  expect((await post(app, "/api/designations", { name: "Developer" }, cookie)).status).toBe(201);
  return cookie;
}
const NEW_TABLES = ["designation_assignments", "department_memberships", "team_memberships", "reporting_relationships"];

describe("upgrading a stage 2.5 database to 2.6 (migration 0008)", () => {
  it("takes the automatic backup, adds only new tables and nullable columns, and everything that worked before still works", async () => {
    const { db } = openDatabase(tmp());
    migrate(db, upTo(7));
    await seed25(db);
    for (const table of NEW_TABLES) expect(hasTable(db, table), table).toBe(false);
    const result = migrate(db, upTo(8));
    expect(result.applied).toEqual(["0008_people_and_reporting.sql"]);
    expect(result.backupFile).toMatch(/pre-0008-.*\.db$/);
    expect(fs.existsSync(result.backupFile!)).toBe(true);
    for (const table of NEW_TABLES) {
      expect(hasTable(db, table), table).toBe(true);
      expect(count(db, `SELECT COUNT(*) n FROM ${table}`), table).toBe(0);
    }
    // the owner's existing membership gained only empty columns
    expect(db.prepare("SELECT designation_id, employee_code, employment_type, start_date, end_date FROM organization_memberships").get()).toEqual({ designation_id: null, employee_code: null, employment_type: null, start_date: null, end_date: null });
    const { app } = appOn(db);
    const login = await post(app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD });
    expect(login.status).toBe(200);
    const cookie = cookieOf(login);
    expect((await get(app, "/api/organization/structure", cookie)).body.data.departments.map((d: { name: string }) => d.name)).toEqual(["Engineering"]);
    const people = await get(app, "/api/employees", cookie);
    expect(people.body.data.people.map((p: { displayName: string }) => p.displayName)).toEqual(["Test Person"]);
    const tree = await get(app, "/api/hierarchy/tree", cookie);
    expect(tree.body.data.nodes.map((n: { name: string }) => n.name)).toEqual(["Test Person"]);
    const created = await post(app, "/api/employees", { name: "Ann Dev", managerId: people.body.data.people[0].id }, cookie);
    expect(created.status).toBe(201);
    expect(count(db, "SELECT COUNT(*) n FROM audit_logs WHERE action = 'person.create'")).toBe(1);
    db.close();
  });

  it("restoring from the automatic backup returns the database to its 2.5 state, and it upgrades again", async () => {
    const dataDir = tmp();
    const { db } = openDatabase(dataDir);
    migrate(db, upTo(7));
    await seed25(db);
    const up = migrate(db, upTo(8));
    const backup = path.basename(up.backupFile!);
    const copy = new Database(up.backupFile!, { readonly: true });
    expect((copy.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check).toBe("ok");
    expect((copy.prepare("SELECT COUNT(*) n FROM schema_migrations").get() as { n: number }).n).toBe(7);
    copy.close();
    const { app } = appOn(db);
    const cookie = cookieOf(await post(app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD }));
    await post(app, "/api/employees", { name: "Made After Upgrade" }, cookie);
    expect(count(db, "SELECT COUNT(*) n FROM organization_memberships")).toBe(2);
    db.close();

    const restore = applyRestoreRequest({ dataDir, request: backup, log: quiet });
    expect(restore.outcome).toBe("restored");
    const reopened = openDatabase(dataDir).db;
    expect(count(reopened, "SELECT COUNT(*) n FROM schema_migrations")).toBe(7);
    expect(hasTable(reopened, "reporting_relationships")).toBe(false);
    expect(count(reopened, "SELECT COUNT(*) n FROM organization_memberships")).toBe(1);
    const safety = new Database(path.join(dataDir, "backups", restore.preRestoreBackup!), { readonly: true });
    expect((safety.prepare("SELECT COUNT(*) n FROM organization_memberships").get() as { n: number }).n).toBe(2); // the work after the upgrade is kept in the safety backup
    safety.close();
    expect(migrate(reopened, upTo(8)).applied).toEqual(["0008_people_and_reporting.sql"]);
    const login = await post(appOn(reopened).app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD });
    expect(login.status).toBe(200);
    reopened.close();
  });

  it("a rollback is safe: the stage 2.5 migration list opens the upgraded database, and the 2.5 queries still work", async () => {
    const { db } = openDatabase(tmp());
    migrate(db, upTo(7));
    await seed25(db);
    migrate(db, upTo(8));
    const { app } = appOn(db);
    const cookie = cookieOf(await post(app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD }));
    await post(app, "/api/employees", { name: "Ann Dev", designationId: (db.prepare("SELECT id FROM designations").get() as { id: string }).id }, cookie);
    const older = migrate(db, upTo(7)); // what the 2.5 build does when it starts on this database
    expect(older.applied).toEqual([]);
    expect(older.unknownApplied).toEqual(["0008"]);
    // the 2.5 code's statements still run: it never names the new columns or tables
    expect(count(db, "SELECT COUNT(*) n FROM departments WHERE name = 'Engineering'")).toBe(1);
    expect(db.prepare("SELECT id, organization_id, user_id, display_name, work_email, status, archived_at FROM organization_memberships").all()).toHaveLength(2);
    expect(() => db.prepare("INSERT INTO organization_memberships (id, organization_id, user_id, display_name, work_email, status, created_at, updated_at) SELECT 'old-code-row', organization_id, NULL, 'Old code', NULL, 'invited', created_at, updated_at FROM organization_memberships LIMIT 1").run()).not.toThrow();
    db.close();
  });
});
