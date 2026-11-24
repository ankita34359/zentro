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
import { hashPassword } from "../backend/src/lib/passwords.js";
import { PERMISSIONS } from "../backend/src/modules/permissions/catalog.js";
import { migrationsDir, testConfig } from "./helpers/app.js";
import { get, post, send } from "./helpers/auth.js";

/**
 * Upgrade rehearsal for migration 0006: a database exactly as stage 2.3 left it (migrations 0001 to 0005, a populated
 * organization) is upgraded to 2.4, restored from the automatic backup, upgraded again, and the older code is shown to
 * run on the upgraded data (a rollback).
 */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "zentro-upgrade24-"));
  dirs.push(d);
  return d;
};
const upTo = (last: number): string => {
  const d = tmp();
  for (const f of fs.readdirSync(migrationsDir).filter((x) => Number(x.slice(0, 4)) <= last)) fs.copyFileSync(path.join(migrationsDir, f), path.join(d, f));
  return d;
};

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEMBER_USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OWNER_M = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MEMBER_M = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OWNER_ROLE = "11111111-1111-4111-8111-111111111111";
const EMP_ROLE = "22222222-2222-4222-8222-222222222222";
const PASSWORD = "correct horse battery";
const NOW = "2026-11-22T10:00:00.000Z";

/** What the 2.3 code wrote: an organization, an owner holding the Owner role (every permission), a member holding Employee. No is_protected column and no audit_logs table yet. */
async function seed23(db: Database.Database): Promise<void> {
  const hash = await hashPassword(PASSWORD);
  const run = (sql: string, ...p: unknown[]) => db.prepare(sql).run(...p);
  run("INSERT INTO users (id, email, password_hash, name, created_at, updated_at) VALUES (?, 'owner@example.com', ?, 'Olive Owner', ?, ?)", OWNER_USER, hash, NOW, NOW);
  run("INSERT INTO users (id, email, password_hash, name, created_at, updated_at) VALUES (?, 'member@example.com', ?, 'Mo Member', ?, ?)", MEMBER_USER, hash, NOW, NOW);
  run("INSERT INTO organizations (id, name, slug, created_by_user_id, created_at, updated_at) VALUES (?, 'Acme Robotics', 'acme-robotics', ?, ?, ?)", ORG, OWNER_USER, NOW, NOW);
  run("UPDATE users SET default_organization_id = ?", ORG);
  for (const [id, uid, name, email] of [[OWNER_M, OWNER_USER, "Olive Owner", "owner@example.com"], [MEMBER_M, MEMBER_USER, "Mo Member", "member@example.com"]] as const) {
    run("INSERT INTO organization_memberships (id, organization_id, user_id, display_name, work_email, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)", id, ORG, uid, name, email, NOW, NOW);
  }
  run("INSERT INTO roles (id, organization_id, key, name, description, kind, created_at, updated_at) VALUES (?, ?, 'owner', 'Owner', '', 'template', ?, ?)", OWNER_ROLE, ORG, NOW, NOW);
  run("INSERT INTO roles (id, organization_id, key, name, description, kind, created_at, updated_at) VALUES (?, ?, 'employee', 'Employee', '', 'template', ?, ?)", EMP_ROLE, ORG, NOW, NOW);
  for (const p of PERMISSIONS) run("INSERT INTO role_permissions (organization_id, role_id, permission_id, scope_mode, created_at) VALUES (?, ?, ?, 'all_in_scope', ?)", ORG, OWNER_ROLE, p.key, NOW);
  run("INSERT INTO role_permissions (organization_id, role_id, permission_id, scope_mode, created_at) VALUES (?, ?, 'okr.view', 'own', ?)", ORG, EMP_ROLE, NOW);
  run("INSERT INTO user_role_assignments (id, organization_id, membership_id, role_id, scope_type, valid_from, created_at) VALUES ('99999999-9999-4999-8999-999999999991', ?, ?, ?, 'organization', ?, ?)", ORG, OWNER_M, OWNER_ROLE, NOW, NOW);
  run("INSERT INTO user_role_assignments (id, organization_id, membership_id, role_id, scope_type, valid_from, created_at) VALUES ('99999999-9999-4999-8999-999999999992', ?, ?, ?, 'organization', ?, ?)", ORG, MEMBER_M, EMP_ROLE, NOW, NOW);
}

const quiet = createLogger("error", () => undefined);
const appOn = (db: Database.Database) => createApp({ db, config: testConfig({ REGISTRATION_MODE: "code", REGISTRATION_CODE: "test-only-registration-code-0001" }), version: "t", cronSecret: undefined, migrationsTotal: 6, log: quiet });
const cookieOf = (res: { headers: Record<string, unknown> }) => ([] as string[]).concat((res.headers["set-cookie"] as string[]) ?? []).find((c) => c.startsWith("zentro_session="))!.split(";")[0]!;
const count = (db: Database.Database, sql: string) => (db.prepare(sql).get() as { n: number }).n;
const hasTable = (db: Database.Database, name: string) => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name) !== undefined;
const hasColumn = (db: Database.Database, table: string, col: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);

describe("upgrading a stage 2.3 database to 2.4 (migration 0006)", () => {
  it("takes the automatic backup, protects the Owner role, adds the audit log, and everyone keeps their access", async () => {
    const dataDir = tmp();
    const { db } = openDatabase(dataDir);
    migrate(db, upTo(5));
    await seed23(db);
    expect(hasTable(db, "audit_logs")).toBe(false);
    expect(hasColumn(db, "roles", "is_protected")).toBe(false);

    const result = migrate(db, migrationsDir);
    expect(result.applied).toEqual(["0006_audit_log_and_protected_roles.sql", "0007_organization_structure.sql", "0008_people_and_reporting.sql", "0009_tasks_and_notifications.sql", "0010_demo_data.sql", "0011_objectives_and_task_links.sql", "0012_alignment_and_health.sql", "0013_kpi_definitions.sql", "0014_kpi_measurements.sql", "0015_scoring_models.sql", "0016_scorecards.sql", "0017_comparisons.sql", "0018_mentorship.sql", "0019_reviews.sql", "0020_evidence.sql", "0021_evidence_withdrawn_and_ai.sql", "0022_integrations_webhooks.sql"]);
    expect(result.backupFile).toMatch(/pre-0006-.*\.db$/);
    expect(fs.existsSync(result.backupFile!)).toBe(true);
    expect(db.prepare("SELECT key, is_protected FROM roles ORDER BY key").all()).toEqual([{ key: "employee", is_protected: 0 }, { key: "owner", is_protected: 1 }]);
    expect(hasTable(db, "audit_logs")).toBe(true);
    expect(count(db, "SELECT COUNT(*) n FROM audit_logs")).toBe(0);

    const { app } = appOn(db);
    const owner = await post(app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD });
    expect(owner.status).toBe(200);
    expect(Object.keys(owner.body.data.capabilities)).toHaveLength(PERMISSIONS.length);
    const cookie = cookieOf(owner);
    // the Owner role is protected now; a new role can be made and the change is audited
    const roles = (await get(app, "/api/roles", cookie)).body.data as { id: string; key: string; isProtected: boolean }[];
    expect(roles.find((r) => r.key === "owner")!.isProtected).toBe(true);
    expect((await send(app, "patch", `/api/roles/${OWNER_ROLE}`, { name: "Boss" }, cookie)).body.error.code).toBe("role_protected");
    expect((await post(app, "/api/roles", { name: "Program Director" }, cookie)).status).toBe(201);
    expect(count(db, "SELECT COUNT(*) n FROM audit_logs WHERE action = 'role.create'")).toBe(1);
    // the member, who joined with the Employee role, is untouched; the people list shows the assignments
    const member = await post(app, "/api/auth/login", { email: "member@example.com", password: PASSWORD });
    expect(member.body.data.roles).toEqual([{ key: "employee", name: "Employee" }]);
    const people = (await get(app, "/api/organization/members", cookie)).body.data as { displayName: string; assignments: { roleName: string }[] }[];
    expect(people.find((p) => p.displayName === "Mo Member")!.assignments.map((a) => a.roleName)).toEqual(["Employee"]);
    db.close();
  });

  it("restoring from the automatic backup returns the database to its 2.3 state (no audit table), and it upgrades again", async () => {
    const dataDir = tmp();
    const { db, file } = openDatabase(dataDir);
    migrate(db, upTo(5));
    await seed23(db);
    const up = migrate(db, migrationsDir);
    const backup = path.basename(up.backupFile!);
    const copy = new Database(up.backupFile!, { readonly: true });
    expect((copy.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check).toBe("ok");
    expect((copy.prepare("SELECT COUNT(*) n FROM schema_migrations").get() as { n: number }).n).toBe(5);
    expect(hasTable(copy as unknown as Database.Database, "audit_logs")).toBe(false);
    copy.close();
    // work after the upgrade (so a restore visibly goes back in time)
    const first = appOn(db);
    const login = await post(first.app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD });
    await post(first.app, "/api/roles", { name: "Made After Upgrade" }, cookieOf(login));
    expect(count(db, "SELECT COUNT(*) n FROM audit_logs")).toBe(1);
    db.close();

    // the one-time restore setting does the file swap (a fresh backup of the live data is taken first)
    const restore = applyRestoreRequest({ dataDir, request: backup, log: quiet });
    expect(restore.outcome).toBe("restored");
    expect(restore.preRestoreBackup).toMatch(/^pre-restore-/);
    const reopened = openDatabase(dataDir).db;
    expect(count(reopened, "SELECT COUNT(*) n FROM schema_migrations")).toBe(5);
    expect(hasTable(reopened, "audit_logs")).toBe(false);
    expect(count(reopened, "SELECT COUNT(*) n FROM roles WHERE name = 'Made After Upgrade'")).toBe(0);
    // the safety backup kept the work done after the upgrade
    const safety = new Database(path.join(dataDir, "backups", restore.preRestoreBackup!), { readonly: true });
    expect((safety.prepare("SELECT COUNT(*) n FROM roles WHERE name = 'Made After Upgrade'").get() as { n: number }).n).toBe(1);
    safety.close();

    const again = migrate(reopened, migrationsDir);
    expect(again.applied).toEqual(["0006_audit_log_and_protected_roles.sql", "0007_organization_structure.sql", "0008_people_and_reporting.sql", "0009_tasks_and_notifications.sql", "0010_demo_data.sql", "0011_objectives_and_task_links.sql", "0012_alignment_and_health.sql", "0013_kpi_definitions.sql", "0014_kpi_measurements.sql", "0015_scoring_models.sql", "0016_scorecards.sql", "0017_comparisons.sql", "0018_mentorship.sql", "0019_reviews.sql", "0020_evidence.sql", "0021_evidence_withdrawn_and_ai.sql", "0022_integrations_webhooks.sql"]);
    const second = appOn(reopened);
    const login2 = await post(second.app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD });
    expect(login2.status).toBe(200);
    expect(count(reopened, "SELECT COUNT(*) n FROM roles WHERE is_protected = 1")).toBe(1);
    reopened.close();
    void file;
  });

  it("a rollback is safe: the stage 2.3 migration list opens the upgraded database, and the 2.3 queries still work", async () => {
    const dataDir = tmp();
    const { db } = openDatabase(dataDir);
    migrate(db, upTo(5));
    await seed23(db);
    migrate(db, migrationsDir);
    const older = migrate(db, upTo(5)); // what the 2.3 build does when it starts on this database
    expect(older.applied).toEqual([]);
    expect(older.unknownApplied).toEqual(["0006", "0007", "0008", "0009", "0010", "0011", "0012", "0013", "0014", "0015", "0016", "0017", "0018", "0019", "0020", "0021", "0022"]);
    // the 2.3 code inserts roles without the new column: the default applies
    db.prepare("INSERT INTO roles (id, organization_id, key, name, description, kind, created_at, updated_at) VALUES ('33333333-3333-4333-8333-333333333333', ?, 'x', 'X', '', 'template', ?, ?)").run(ORG, NOW, NOW);
    expect(db.prepare("SELECT is_protected FROM roles WHERE key = 'x'").get()).toEqual({ is_protected: 0 });
    expect(count(db, "SELECT COUNT(*) n FROM user_role_assignments")).toBe(2);
    db.close();
  });
});
