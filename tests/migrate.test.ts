import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../backend/src/db/migrate.js";
import { openDatabase } from "../backend/src/db/open.js";
import { migrationsDir, tmpDir } from "./helpers/app.js";

const dirs: string[] = [];
const mk = () => {
  const d = tmpDir();
  dirs.push(d);
  return d;
};
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

function migDir(files: Record<string, string>) {
  const d = mk();
  for (const [n, sql] of Object.entries(files)) fs.writeFileSync(path.join(d, n), sql);
  return d;
}

describe("migration runner", () => {
  it("applies the real migrations once and is idempotent", () => {
    const { db } = openDatabase(mk());
    const first = migrate(db, migrationsDir);
    expect(first.applied).toEqual(["0001_spike_counters.sql", "0002_scheduled_job_runs.sql", "0003_auth_core.sql", "0004_invitations_and_reset.sql", "0005_permissions_and_role_grants.sql", "0006_audit_log_and_protected_roles.sql", "0007_organization_structure.sql", "0008_people_and_reporting.sql", "0009_tasks_and_notifications.sql", "0010_demo_data.sql", "0011_objectives_and_task_links.sql", "0012_alignment_and_health.sql", "0013_kpi_definitions.sql", "0014_kpi_measurements.sql", "0015_scoring_models.sql", "0016_scorecards.sql", "0017_comparisons.sql", "0018_mentorship.sql", "0019_reviews.sql", "0020_evidence.sql", "0021_evidence_withdrawn_and_ai.sql"]);
    expect(first.backupFile).toBeNull(); // fresh database: nothing to protect
    expect(migrate(db, migrationsDir)).toMatchObject({ applied: [], total: 21, backupFile: null });
    db.close();
  });

  it("records a SHA-256 checksum per migration and refuses an edited one without changing anything", () => {
    const { db } = openDatabase(mk());
    const d = migDir({ "0001_a.sql": "CREATE TABLE a (x TEXT);" });
    migrate(db, d);
    const row = db.prepare("SELECT checksum FROM schema_migrations WHERE id = '0001'").get() as { checksum: string };
    expect(row.checksum).toBe(crypto.createHash("sha256").update("CREATE TABLE a (x TEXT);").digest("hex"));

    fs.writeFileSync(path.join(d, "0001_a.sql"), "CREATE TABLE a (x TEXT, y TEXT);");
    fs.writeFileSync(path.join(d, "0002_b.sql"), "CREATE TABLE b (x TEXT);");
    expect(() => migrate(db, d)).toThrow(/checksum mismatch/);
    // The edit was found BEFORE the new migration ran.
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'b'").get()).toBeUndefined();
    db.close();
  });

  it("rolls a failing migration back completely", () => {
    const { db } = openDatabase(mk());
    const d = migDir({ "0001_a.sql": "CREATE TABLE a (x TEXT); INSERT INTO nope VALUES (1);" });
    expect(() => migrate(db, d)).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'a'").get()).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get()).toEqual({ n: 0 });
    db.close();
  });

  it("refuses two files with the same number", () => {
    const { db } = openDatabase(mk());
    expect(() => migrate(db, migDir({ "0001_a.sql": "SELECT 1;", "0001_b.sql": "SELECT 1;" }))).toThrow(/share the number/);
    db.close();
  });

  it("copies the database before applying a new migration to existing data, and keeps only the newest copies", () => {
    const data = mk();
    const { db } = openDatabase(data);
    const d = migDir({ "0001_a.sql": "CREATE TABLE a (x TEXT); INSERT INTO a VALUES ('keep me');" });
    migrate(db, d);

    let n = 1;
    const times = ["2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z", "2026-01-03T00:00:00.000Z", "2026-01-04T00:00:00.000Z"];
    const copies: string[] = [];
    for (const t of times) {
      n++;
      fs.writeFileSync(path.join(d, `${String(n).padStart(4, "0")}_t.sql`), `CREATE TABLE t${n} (x TEXT);`);
      const r = migrate(db, d, { now: () => new Date(t), keepBackups: 3 });
      expect(r.backupFile).toBeTruthy();
      copies.push(r.backupFile!);
    }
    const backups = fs.readdirSync(path.join(data, "backups")).sort();
    expect(backups).toHaveLength(3); // the oldest was pruned
    expect(fs.existsSync(copies[0]!)).toBe(false);
    expect(fs.existsSync(copies[3]!)).toBe(true);

    // A copy is a real, consistent database holding the data from BEFORE its migration.
    const old = new Database(copies[3]!, { readonly: true });
    expect(old.prepare("SELECT x FROM a").get()).toEqual({ x: "keep me" });
    expect(old.prepare("SELECT name FROM sqlite_master WHERE name = 't5'").get()).toBeUndefined(); // the last migration is not in it
    expect(old.prepare("SELECT name FROM sqlite_master WHERE name = 't4'").get()).toBeTruthy();
    old.close();
    db.close();
  });

  it("reports migrations the database has but this code does not (an older release started on a newer database)", () => {
    const { db } = openDatabase(mk());
    migrate(db, migDir({ "0001_a.sql": "SELECT 1;", "0002_b.sql": "SELECT 1;" }));
    const r = migrate(db, migDir({ "0001_a.sql": "SELECT 1;" }));
    expect(r.unknownApplied).toEqual(["0002"]);
    db.close();
  });
});
