import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../backend/src/app.js";
import { migrate } from "../backend/src/db/migrate.js";
import { openDatabase } from "../backend/src/db/open.js";
import { createLogger } from "../backend/src/lib/logger.js";
import { hashPassword } from "../backend/src/lib/passwords.js";
import { hashSecret, newSecret } from "../backend/src/modules/auth/secrets.js";
import { PERMISSION_KEYS } from "../backend/src/modules/permissions/catalog.js";
import { migrationsDir, testConfig } from "./helpers/app.js";
import { get, post } from "./helpers/auth.js";

/**
 * Upgrade rehearsal: a database exactly as stage 2.2 left it (migrations 0001 to 0004, rows written the way the 2.2
 * code wrote them) is upgraded to 2.3, and then restored from the automatic pre-migration backup. This is the
 * same path the live server takes at start-up, on realistic data.
 */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "zentro-upgrade-"));
  dirs.push(d);
  return d;
};

/** The migration folder as it was at the end of stage 2.2. */
function oldMigrations(): string {
  const d = tmp();
  for (const f of fs.readdirSync(migrationsDir).filter((x) => /^000[1-4]_/.test(x))) fs.copyFileSync(path.join(migrationsDir, f), path.join(d, f));
  return d;
}

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEMBER_USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OWNER_M = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MEMBER_M = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const INVITED_M = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const OWNER_ROLE = "11111111-1111-4111-8111-111111111111";
const PASSWORD = "correct horse battery";
const NOW = "2026-11-22T10:00:00.000Z";
const INVITE_SECRET = newSecret();
const INVITE_CODE = `${ORG}.${INVITE_SECRET}`;
const RESET_TOKEN = newSecret();

/** Writes what the 2.2 code wrote: an organization with an owner who has the (permission-less) Owner role, a member with no role, and one pending invitation and reset link. */
async function seed22(db: Database.Database): Promise<void> {
  const hash = await hashPassword(PASSWORD);
  const ins = (sql: string, ...p: unknown[]) => db.prepare(sql).run(...p);
  ins("INSERT INTO users (id, email, password_hash, name, default_organization_id, created_at, updated_at) VALUES (?, 'owner@example.com', ?, 'Olive Owner', NULL, ?, ?)", OWNER_USER, hash, NOW, NOW);
  ins("INSERT INTO users (id, email, password_hash, name, created_at, updated_at) VALUES (?, 'member@example.com', ?, 'Mo Member', ?, ?)", MEMBER_USER, hash, NOW, NOW);
  ins("INSERT INTO organizations (id, name, slug, timezone, created_by_user_id, created_at, updated_at) VALUES (?, 'Acme Robotics', 'acme-robotics', 'Asia/Kolkata', ?, ?, ?)", ORG, OWNER_USER, NOW, NOW);
  ins("UPDATE users SET default_organization_id = ?", ORG);
  ins("INSERT INTO organization_memberships (id, organization_id, user_id, display_name, work_email, status, created_at, updated_at) VALUES (?, ?, ?, 'Olive Owner', 'owner@example.com', 'active', ?, ?)", OWNER_M, ORG, OWNER_USER, NOW, NOW);
  ins("INSERT INTO organization_memberships (id, organization_id, user_id, display_name, work_email, status, created_at, updated_at) VALUES (?, ?, ?, 'Mo Member', 'member@example.com', 'active', ?, ?)", MEMBER_M, ORG, MEMBER_USER, NOW, NOW);
  ins("INSERT INTO organization_memberships (id, organization_id, user_id, display_name, work_email, status, created_at, updated_at) VALUES (?, ?, NULL, 'Ina Invited', 'invited@example.com', 'invited', ?, ?)", INVITED_M, ORG, NOW, NOW);
  ins("INSERT INTO roles (id, organization_id, key, name, description, kind, created_at, updated_at) VALUES (?, ?, 'owner', 'Owner', 'Full control', 'template', ?, ?)", OWNER_ROLE, ORG, NOW, NOW);
  ins("INSERT INTO user_role_assignments (id, organization_id, membership_id, role_id, scope_type, valid_from, granted_by_membership_id, created_at) VALUES ('99999999-9999-4999-8999-999999999999', ?, ?, ?, 'organization', ?, ?, ?)", ORG, OWNER_M, OWNER_ROLE, NOW, OWNER_M, NOW);
  const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
  ins("INSERT INTO invitations (id, organization_id, membership_id, email, code_hash, invited_by_membership_id, expires_at, created_at, updated_at) VALUES ('88888888-8888-4888-8888-888888888888', ?, ?, 'invited@example.com', ?, ?, ?, ?, ?)", ORG, INVITED_M, hashSecret(INVITE_CODE), OWNER_M, future, NOW, NOW);
  ins("INSERT INTO auth_tokens (id, user_id, purpose, token_hash, expires_at, created_by_user_id, created_at) VALUES ('77777777-7777-4777-8777-777777777777', ?, 'password_reset', ?, ?, ?, ?)", MEMBER_USER, hashSecret(RESET_TOKEN), new Date(Date.now() + 3600_000).toISOString(), OWNER_USER, NOW);
}

const logger = createLogger("error", () => undefined);
const appOn = (db: Database.Database) => createApp({ db, config: testConfig({ REGISTRATION_MODE: "code", REGISTRATION_CODE: "test-only-registration-code-0001" }), version: "t", cronSecret: undefined, migrationsTotal: 6, log: logger });
const cookieOf = (res: { headers: Record<string, unknown> }) => ([] as string[]).concat((res.headers["set-cookie"] as string[]) ?? []).find((c) => c.startsWith("zentro_session="))!.split(";")[0]!;
const count = (db: Database.Database, sql: string) => (db.prepare(sql).get() as { n: number }).n;

describe("upgrading a stage 2.2 database to 2.3", () => {
  it("applies 0005 on top of real 2.2 data after taking an automatic backup, back-fills the Owner, adds the eight other templates, and nobody loses access", async () => {
    const dataDir = tmp();
    const { db } = openDatabase(dataDir);
    migrate(db, oldMigrations());
    await seed22(db);
    expect(count(db, "SELECT COUNT(*) n FROM schema_migrations")).toBe(4);

    const result = migrate(db, migrationsDir);
    expect(result.applied).toEqual(["0005_permissions_and_role_grants.sql", "0006_audit_log_and_protected_roles.sql", "0007_organization_structure.sql", "0008_people_and_reporting.sql", "0009_tasks_and_notifications.sql", "0010_demo_data.sql", "0011_objectives_and_task_links.sql"]);
    expect(result.backupFile).toMatch(/pre-0005-.*\.db$/);
    expect(fs.existsSync(result.backupFile!)).toBe(true);

    // The 2.2 owner already holds EVERY permission at all_in_scope straight after the migration (no other step needed).
    expect(count(db, "SELECT COUNT(*) n FROM role_permissions WHERE role_id = '" + OWNER_ROLE + "' AND scope_mode = 'all_in_scope'")).toBe(PERMISSION_KEYS.size);
    expect(count(db, "SELECT COUNT(*) n FROM roles")).toBe(1);

    // The start-up step adds the eight templates that were missing, once; running it again changes nothing.
    const { permissions, app } = appOn(db);
    permissions.syncCatalog();
    expect(permissions.ensureRoleTemplates()).toEqual({ organizations: 1, rolesCreated: 8 });
    expect(permissions.ensureRoleTemplates()).toEqual({ organizations: 1, rolesCreated: 0 });
    expect(count(db, "SELECT COUNT(*) n FROM roles")).toBe(9);
    expect(count(db, "SELECT COUNT(*) n FROM roles WHERE key = 'owner'")).toBe(1); // the existing Owner role was reused, not duplicated

    // Everything the 2.2 data held still works: the owner signs in and administers; the member is signed in with no role; old links work.
    const login = await post(app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD });
    expect(login.status).toBe(200);
    expect(Object.keys(login.body.data.capabilities).sort()).toEqual([...PERMISSION_KEYS].sort());
    expect(login.body.data.roles).toEqual([{ key: "owner", name: "Owner" }]);
    const owner = cookieOf(login);
    expect(((await get(app, "/api/roles", owner)).body.data as unknown[]).length).toBe(9);
    const member = await post(app, "/api/auth/login", { email: "member@example.com", password: PASSWORD });
    expect(member.body.data.capabilities).toEqual({});
    expect((await get(app, "/api/invitations", cookieOf(member))).status).toBe(403);
    expect((await post(app, "/api/auth/invitation-preview", { code: INVITE_CODE })).body.data).toMatchObject({ organizationName: "Acme Robotics", email: "invited@example.com" });
    expect((await post(app, "/api/auth/reset-password", { token: RESET_TOKEN, password: "a brand new password" })).status).toBe(200);
    const members = (await get(app, "/api/organization/members", owner)).body.data as { displayName: string }[];
    expect(members.map((m) => m.displayName).sort()).toEqual(["Ina Invited", "Mo Member", "Olive Owner"]);
    db.close();
  });

  it("restoring from the automatic backup works: the database returns to its 2.2 state, upgrades again, and works", async () => {
    const dataDir = tmp();
    const { db, file } = openDatabase(dataDir);
    migrate(db, oldMigrations());
    await seed22(db);
    const up = migrate(db, migrationsDir);
    const backup = up.backupFile!;
    // the backup is a complete, consistent copy of the database BEFORE the migration
    const copy = new Database(backup, { readonly: true });
    expect((copy.prepare("SELECT COUNT(*) n FROM schema_migrations").get() as { n: number }).n).toBe(4);
    expect(copy.prepare("SELECT name FROM sqlite_master WHERE name = 'permissions'").get()).toBeUndefined();
    expect((copy.prepare("SELECT COUNT(*) n FROM users").get() as { n: number }).n).toBe(2);
    expect((copy.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check).toBe("ok");
    copy.close();

    // The upgraded database takes new writes (so a restore really goes back in time)...
    const upgraded = appOn(db);
    upgraded.permissions.syncCatalog();
    upgraded.permissions.ensureRoleTemplates();
    db.prepare("INSERT INTO users (id, email, password_hash, name, created_at, updated_at) VALUES ('d0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0', 'later@example.com', NULL, 'Later', ?, ?)").run(NOW, NOW);
    db.close();

    // ...then the restore: stop, put the backup in place (and drop the write-ahead files), start again.
    for (const suffix of ["-wal", "-shm"]) fs.rmSync(file + suffix, { force: true });
    fs.copyFileSync(backup, file);
    const reopened = openDatabase(dataDir).db;
    expect((reopened.prepare("SELECT COUNT(*) n FROM schema_migrations").get() as { n: number }).n).toBe(4);
    expect(reopened.prepare("SELECT id FROM users WHERE email = 'later@example.com'").get()).toBeUndefined(); // the later write is gone: we are back at the backup
    expect((reopened.prepare("SELECT COUNT(*) n FROM roles").get() as { n: number }).n).toBe(1);

    // The restored 2.2 data upgrades again exactly as the first time, and everything works.
    const again = migrate(reopened, migrationsDir);
    expect(again.applied).toEqual(["0005_permissions_and_role_grants.sql", "0006_audit_log_and_protected_roles.sql", "0007_organization_structure.sql", "0008_people_and_reporting.sql", "0009_tasks_and_notifications.sql", "0010_demo_data.sql", "0011_objectives_and_task_links.sql"]);
    const app = appOn(reopened);
    app.permissions.syncCatalog();
    expect(app.permissions.ensureRoleTemplates().rolesCreated).toBe(8);
    const login = await post(app.app, "/api/auth/login", { email: "owner@example.com", password: PASSWORD });
    expect(login.status).toBe(200);
    expect(Object.keys(login.body.data.capabilities)).toHaveLength(PERMISSION_KEYS.size);
    reopened.close();
  });

  it("a rollback is safe: the previous version's migration list opens the upgraded database, reports it as newer, and its own queries still work", async () => {
    const dataDir = tmp();
    const { db } = openDatabase(dataDir);
    migrate(db, oldMigrations());
    await seed22(db);
    migrate(db, migrationsDir);
    const older = migrate(db, oldMigrations()); // what the 2.2 build does when it starts on this database
    expect(older.applied).toEqual([]);
    expect(older.unknownApplied).toEqual(["0005", "0006", "0007", "0008", "0009", "0010", "0011"]);
    // the 2.2 code only touches the tables it knew: they are unchanged in shape and content
    expect(count(db, "SELECT COUNT(*) n FROM organization_memberships")).toBe(3);
    expect(db.prepare("SELECT key, name FROM roles WHERE organization_id = ?").all(ORG)).toEqual([{ key: "owner", name: "Owner" }]);
    expect(count(db, "SELECT COUNT(*) n FROM invitations WHERE accepted_at IS NULL AND revoked_at IS NULL")).toBe(1);
    db.close();
  });

  it("a failed migration leaves the database exactly as it was (each migration is one transaction)", () => {
    const dataDir = tmp();
    const { db } = openDatabase(dataDir);
    const dir = oldMigrations();
    migrate(db, dir);
    fs.writeFileSync(path.join(dir, "0005_broken.sql"), "CREATE TABLE half_done (x TEXT); INSERT INTO table_that_does_not_exist VALUES (1);");
    expect(() => migrate(db, dir)).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'half_done'").get()).toBeUndefined();
    expect(count(db, "SELECT COUNT(*) n FROM schema_migrations")).toBe(4);
    db.close();
  });
});
