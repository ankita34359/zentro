import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../backend/src/db/migrate.js";
import { openDatabase } from "../backend/src/db/open.js";
import { applyRestoreRequest } from "../backend/src/db/restore.js";
import { createLogger } from "../backend/src/lib/logger.js";
import { migrationsDir } from "./helpers/app.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "zentro-restore-"));
  dirs.push(d);
  return d;
};
const lines: string[] = [];
const log = createLogger("debug", (l) => lines.push(l));
const logged = () => lines.map((l) => JSON.parse(l) as { level: string; msg: string; [k: string]: unknown });
const names = (dir: string) => fs.readdirSync(dir).sort();

/** A data folder holding a live database with some rows, and one automatic backup of an EARLIER state ("old-user" only). */
function setup() {
  lines.length = 0;
  const dataDir = tmp();
  const { db, file } = openDatabase(dataDir);
  migrate(db, migrationsDir);
  const now = "2026-11-22T10:00:00.000Z";
  db.prepare("INSERT INTO users (id, email, name, created_at, updated_at) VALUES ('u-old', 'old-user@example.com', 'Old', ?, ?)").run(now, now);
  const backupDir = path.join(dataDir, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backup = "pre-0005-2026-11-22T10-00-00-000Z.db";
  db.prepare("VACUUM INTO ?").run(path.join(backupDir, backup));
  // later state: a second user the backup does not have
  db.prepare("INSERT INTO users (id, email, name, created_at, updated_at) VALUES ('u-new', 'new-user@example.com', 'New', ?, ?)").run(now, now);
  db.close();
  return { dataDir, file, backupDir, backup };
}
const emails = (file: string) => {
  const db = new Database(file, { readonly: true });
  try {
    return (db.prepare("SELECT email FROM users ORDER BY email").all() as { email: string }[]).map((r) => r.email);
  } finally {
    db.close();
  }
};

describe("restore a backup at start-up", () => {
  it("does nothing when no restore is requested", () => {
    const s = setup();
    for (const request of [undefined, "", "   "]) expect(applyRestoreRequest({ dataDir: s.dataDir, request, log }).outcome).toBe("none");
    expect(emails(s.file)).toEqual(["new-user@example.com", "old-user@example.com"]);
    expect(fs.existsSync(path.join(s.dataDir, "restore-log.json"))).toBe(false);
  });

  it("restores the named backup, after taking a FRESH backup of the current data first, and logs what it did", () => {
    const s = setup();
    const r = applyRestoreRequest({ dataDir: s.dataDir, request: s.backup, log });
    expect(r.outcome).toBe("restored");
    // the database is now the backup (the later user is gone) ...
    expect(emails(s.file)).toEqual(["old-user@example.com"]);
    // ... and the current data was backed up first, in full, so the restore itself can be undone
    expect(r.preRestoreBackup).toMatch(/^pre-restore-.*\.db$/);
    expect(emails(path.join(s.backupDir, r.preRestoreBackup!))).toEqual(["new-user@example.com", "old-user@example.com"]);
    // the log says what happened, in order, without any data
    const msgs = logged().map((l) => l.msg);
    expect(msgs).toEqual(["restore requested", "fresh backup of the current data taken before restoring", "restore completed"]);
    expect(logged()[0]).toMatchObject({ backup: s.backup, backupMigrations: 12 });
    expect(logged()[1]).toMatchObject({ preRestoreBackup: r.preRestoreBackup });
    expect(logged()[2]).toMatchObject({ backup: s.backup, preRestoreBackup: r.preRestoreBackup });
    expect(lines.join("\n")).not.toMatch(/example\.com/);
    // and it was recorded next to the database
    const record = JSON.parse(fs.readFileSync(path.join(s.dataDir, "restore-log.json"), "utf8"));
    expect(record.restores).toHaveLength(1);
    expect(record.restores[0]).toMatchObject({ request: s.backup, backup: s.backup, preRestoreBackup: r.preRestoreBackup });
    // no leftovers from the swap
    expect(names(s.dataDir)).not.toContain("zentro.db.restoring");
  });

  it("runs ONCE: a restart with the same setting does not restore again (later data survives), and says so", () => {
    const s = setup();
    expect(applyRestoreRequest({ dataDir: s.dataDir, request: s.backup, log }).outcome).toBe("restored");
    // the app runs on the restored data and takes new writes
    const { db } = openDatabase(s.dataDir);
    db.prepare("INSERT INTO users (id, email, name, created_at, updated_at) VALUES ('u-after', 'after-restore@example.com', 'After', 'x', 'x')").run();
    db.close();
    lines.length = 0;
    const second = applyRestoreRequest({ dataDir: s.dataDir, request: s.backup, log });
    expect(second.outcome).toBe("already_applied");
    expect(emails(s.file)).toEqual(["after-restore@example.com", "old-user@example.com"]); // untouched by the second start
    expect(logged().map((l) => l.msg)).toEqual(["restore already applied; nothing to do (remove the RESTORE_BACKUP setting)"]);
    // a third, fourth restart: the same
    expect(applyRestoreRequest({ dataDir: s.dataDir, request: s.backup, log }).outcome).toBe("already_applied");
    expect(JSON.parse(fs.readFileSync(path.join(s.dataDir, "restore-log.json"), "utf8")).restores).toHaveLength(1);
    expect(names(s.backupDir).filter((f) => f.startsWith("pre-restore-"))).toHaveLength(1); // no extra safety backups either
  });

  it("a deliberately NEW request (a different value) runs again, with a fresh backup of the data as it is then", () => {
    const s = setup();
    applyRestoreRequest({ dataDir: s.dataDir, request: s.backup, log });
    const { db } = openDatabase(s.dataDir);
    db.prepare("INSERT INTO users (id, email, name, created_at, updated_at) VALUES ('u-after', 'after-restore@example.com', 'After', 'x', 'x')").run();
    db.close();
    const again = applyRestoreRequest({ dataDir: s.dataDir, request: `${s.backup}@second-try`, log });
    expect(again.outcome).toBe("restored");
    expect(emails(s.file)).toEqual(["old-user@example.com"]); // back to the backup again
    expect(emails(path.join(s.backupDir, again.preRestoreBackup!))).toEqual(["after-restore@example.com", "old-user@example.com"]); // the work done in between was backed up first
    expect(JSON.parse(fs.readFileSync(path.join(s.dataDir, "restore-log.json"), "utf8")).restores).toHaveLength(2);
  });

  it("refuses, loudly and without touching the current data, anything that is not a plain backup file name", () => {
    const s = setup();
    const before = emails(s.file);
    for (const request of ["../zentro.db", "/etc/passwd", "backups/" + s.backup, "..\\zentro.db", "zentro.db", s.backup.replace(".db", ".sql"), "pre-0005-x.db@bad label", "pre-.db/../../x.db"]) {
      lines.length = 0;
      const r = applyRestoreRequest({ dataDir: s.dataDir, request, log });
      expect(r.outcome, request).toBe("refused");
      expect(logged().some((l) => l.level === "error" && l.msg.startsWith("restore refused"))).toBe(true);
    }
    expect(emails(s.file)).toEqual(before);
    expect(fs.existsSync(path.join(s.dataDir, "restore-log.json"))).toBe(false); // a refusal is not recorded as done: fix the value and restart
    expect(names(s.backupDir).filter((f) => f.startsWith("pre-restore-"))).toEqual([]);
  });

  it("refuses a missing file, a file that is not SQLite, a SQLite file that is not a Zentro database, and a damaged backup", () => {
    const s = setup();
    const before = emails(s.file);
    expect(applyRestoreRequest({ dataDir: s.dataDir, request: "pre-9999-missing.db", log }).outcome).toBe("refused");
    fs.writeFileSync(path.join(s.backupDir, "pre-0006-notsqlite.db"), "this is not a database at all");
    expect(applyRestoreRequest({ dataDir: s.dataDir, request: "pre-0006-notsqlite.db", log }).outcome).toBe("refused");
    const other = new Database(path.join(s.backupDir, "pre-0007-other.db"));
    other.exec("CREATE TABLE something_else (x TEXT)");
    other.close();
    const wrong = applyRestoreRequest({ dataDir: s.dataDir, request: "pre-0007-other.db", log });
    expect(wrong).toMatchObject({ outcome: "refused" });
    expect(wrong.reason).toMatch(/not a Zentro database/);
    const bytes = fs.readFileSync(path.join(s.backupDir, s.backup));
    fs.writeFileSync(path.join(s.backupDir, "pre-0008-damaged.db"), bytes.subarray(0, Math.floor(bytes.length / 2))); // truncated copy
    expect(applyRestoreRequest({ dataDir: s.dataDir, request: "pre-0008-damaged.db", log }).outcome).toBe("refused");
    expect(emails(s.file)).toEqual(before);
    expect(names(s.backupDir).filter((f) => f.startsWith("pre-restore-"))).toEqual([]); // refused BEFORE any change
  });

  it("if the current database cannot be read, its raw files are kept before the backup replaces it", () => {
    const s = setup();
    fs.writeFileSync(s.file, "corrupted live database bytes");
    fs.rmSync(s.file + "-wal", { force: true });
    fs.rmSync(s.file + "-shm", { force: true });
    const r = applyRestoreRequest({ dataDir: s.dataDir, request: s.backup, log });
    expect(r.outcome).toBe("restored");
    expect(r.preRestoreBackup).toMatch(/-raw$/);
    expect(fs.readFileSync(path.join(s.backupDir, r.preRestoreBackup!, "zentro.db"), "utf8")).toBe("corrupted live database bytes");
    expect(emails(s.file)).toEqual(["old-user@example.com"]);
  });

  it("the restored database opens and starts normally: pending migrations are applied on top, with their own automatic backup", () => {
    const s = setup();
    // make the backup an OLDER state (4 migrations): rebuild it from the first four migration files
    const older = path.join(s.backupDir, "pre-0005-older.db");
    const oldMig = tmp();
    for (const f of fs.readdirSync(migrationsDir).filter((x) => /^000[1-4]_/.test(x))) fs.copyFileSync(path.join(migrationsDir, f), path.join(oldMig, f));
    const o = new Database(older);
    o.pragma("foreign_keys = ON");
    migrate(o, oldMig, { backupDir: null });
    o.close();
    expect(applyRestoreRequest({ dataDir: s.dataDir, request: "pre-0005-older.db", log }).outcome).toBe("restored");
    const { db } = openDatabase(s.dataDir);
    const res = migrate(db, migrationsDir);
    expect(res.applied).toEqual(["0005_permissions_and_role_grants.sql", "0006_audit_log_and_protected_roles.sql", "0007_organization_structure.sql", "0008_people_and_reporting.sql", "0009_tasks_and_notifications.sql", "0010_demo_data.sql", "0011_objectives_and_task_links.sql", "0012_alignment_and_health.sql"]);
    expect(res.backupFile).toMatch(/pre-0005-.*\.db$/);
    db.close();
  });

  it("keeps only the newest three safety backups", () => {
    const s = setup();
    for (let i = 0; i < 5; i++) {
      applyRestoreRequest({ dataDir: s.dataDir, request: `${s.backup}@try${i}`, log, now: () => new Date(Date.UTC(2026, 10, 23, 10, i, 0)) });
    }
    expect(names(s.backupDir).filter((f) => f.startsWith("pre-restore-"))).toHaveLength(3);
  });
});
