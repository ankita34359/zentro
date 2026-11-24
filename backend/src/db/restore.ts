import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { Logger } from "../lib/logger.js";

/**
 * "Restore this backup at start-up" (a one-time recovery setting).
 *
 * Embarko gives no shell and no file access, so the automatic backups (`<data>/backups/pre-<migration>-<time>.db`,
 * written before every migration) could not be put back by hand. This is the way: set the environment variable
 * `RESTORE_BACKUP` to a backup's file name and restart. On the next start, BEFORE the database is opened:
 *
 *   1. the request is checked: only a plain file name in the backups folder (never a path), a real SQLite file that
 *      passes `PRAGMA integrity_check` and carries a `schema_migrations` table. Anything else is refused loudly and
 *      the current data is left untouched;
 *   2. a FRESH backup of the current data is taken first (`pre-restore-<time>.db`; if the current database cannot be
 *      read at all, its raw files are copied instead), so the restore itself can be undone;
 *   3. the backup replaces the database (the write-ahead files of the old database are removed);
 *   4. what happened is written to the log and to `restore-log.json` next to the database.
 *
 * It runs ONCE per request. The setting stays on the app until someone removes it, so the request (the exact value) is
 * recorded in `restore-log.json` and a restart with the same value does nothing but say so. To restore the same backup
 * again on purpose, change the value (append `@anything`, for example `pre-0005-….db@second-try`).
 * After the restore the normal start-up continues: migrations run (taking their own automatic backup) on the restored data.
 */
export interface RestoreResult {
  /** What happened: nothing requested, already done for this request, refused, or restored. */
  outcome: "none" | "already_applied" | "refused" | "restored";
  reason?: string;
  backup?: string;
  preRestoreBackup?: string;
}

interface LogEntry {
  request: string;
  backup: string;
  doneAt: string;
  preRestoreBackup: string;
  backupMigrations: number;
  backupBytes: number;
}

const REQUEST = /^((?:pre|daily)-[A-Za-z0-9._-]+\.db)(?:@([A-Za-z0-9_-]{1,40}))?$/;
const LOG_FILE = "restore-log.json";
const KEEP_PRE_RESTORE = 3;

function readLog(dataDir: string): LogEntry[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, LOG_FILE), "utf8")) as { restores?: LogEntry[] };
    return Array.isArray(parsed.restores) ? parsed.restores : [];
  } catch {
    return [];
  }
}

function writeLog(dataDir: string, entries: LogEntry[]): void {
  const file = path.join(dataDir, LOG_FILE);
  fs.writeFileSync(file + ".tmp", JSON.stringify({ restores: entries }, null, 1));
  fs.renameSync(file + ".tmp", file); // the record is never half-written
}

/** Opens the candidate read-only and checks it is a healthy Zentro database. Returns how many migrations it holds. */
function inspectBackup(file: string): { migrations: number } {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error("the backup failed its integrity check");
    const has = db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
    if (!has) throw new Error("the file is not a Zentro database (no schema_migrations table)");
    return { migrations: (db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number }).n };
  } finally {
    db.close();
  }
}

/** A consistent copy of the current data before anything is replaced. Falls back to copying the raw files if SQLite cannot read it. */
function backUpCurrent(dbFile: string, backupDir: string, stamp: string): string {
  const target = path.join(backupDir, `pre-restore-${stamp}.db`);
  if (!fs.existsSync(dbFile)) throw new Error("there is no current database to back up");
  try {
    const db = new Database(dbFile);
    try {
      db.prepare("VACUUM INTO ?").run(target);
    } finally {
      db.close();
    }
    return target;
  } catch {
    // The current database is unreadable: keep its bytes anyway (database and write-ahead log) so nothing is lost.
    const raw = path.join(backupDir, `pre-restore-${stamp}-raw`);
    fs.mkdirSync(raw, { recursive: true });
    for (const suffix of ["", "-wal", "-shm"]) if (fs.existsSync(dbFile + suffix)) fs.copyFileSync(dbFile + suffix, path.join(raw, path.basename(dbFile) + suffix));
    return raw;
  }
}

function trimPreRestore(backupDir: string): void {
  const entries = fs.readdirSync(backupDir).filter((f) => /^pre-restore-/.test(f)).sort(); // the ISO stamp sorts oldest first
  for (const f of entries.slice(0, Math.max(0, entries.length - KEEP_PRE_RESTORE))) fs.rmSync(path.join(backupDir, f), { recursive: true, force: true });
}

export function applyRestoreRequest(opts: { dataDir: string; request: string | undefined; log: Logger; now?: () => Date }): RestoreResult {
  const { dataDir, log } = opts;
  const request = (opts.request ?? "").trim();
  if (request === "") return { outcome: "none" };

  // Once only: this exact request was already carried out.
  const done = readLog(dataDir).find((e) => e.request === request);
  if (done) {
    log.info("restore already applied; nothing to do (remove the RESTORE_BACKUP setting)", { backup: done.backup, doneAt: done.doneAt });
    return { outcome: "already_applied", backup: done.backup };
  }

  const refuse = (reason: string): RestoreResult => {
    log.error("restore refused; the current data was NOT changed", { reason, request });
    return { outcome: "refused", reason };
  };

  const m = REQUEST.exec(request);
  if (!m) return refuse("RESTORE_BACKUP must be a backup file name from the backups folder, for example daily-2026-11-24T03-00-00-000Z.db or pre-0005-2026-11-22T15-12-49-405Z.db");
  const name = m[1]!;
  const backupDir = path.join(dataDir, "backups");
  const source = path.join(backupDir, name);
  if (path.dirname(source) !== backupDir || !fs.existsSync(source) || !fs.statSync(source).isFile()) return refuse("that backup file does not exist in the backups folder");

  let info: { migrations: number };
  try {
    info = inspectBackup(source);
  } catch (e) {
    return refuse(e instanceof Error ? e.message : "the backup could not be read");
  }

  const dbFile = path.join(dataDir, "zentro.db");
  const now = (opts.now ?? (() => new Date()))();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  log.warn("restore requested", { backup: name, backupMigrations: info.migrations, backupBytes: fs.statSync(source).size });

  let safety: string;
  try {
    safety = backUpCurrent(dbFile, backupDir, stamp);
  } catch (e) {
    return refuse(`could not take a fresh backup of the current data first (${e instanceof Error ? e.message : "unknown"})`);
  }
  log.warn("fresh backup of the current data taken before restoring", { preRestoreBackup: path.basename(safety) });

  // Replace the database: write next to it, then rename over it, and drop the old write-ahead files.
  const tmp = dbFile + ".restoring";
  fs.copyFileSync(source, tmp);
  for (const suffix of ["-wal", "-shm"]) fs.rmSync(dbFile + suffix, { force: true });
  fs.renameSync(tmp, dbFile);

  const entry: LogEntry = { request, backup: name, doneAt: now.toISOString(), preRestoreBackup: path.basename(safety), backupMigrations: info.migrations, backupBytes: fs.statSync(source).size };
  writeLog(dataDir, [...readLog(dataDir), entry]);
  trimPreRestore(backupDir);
  log.warn("restore completed", { backup: name, preRestoreBackup: path.basename(safety), backupMigrations: info.migrations, note: "remove the RESTORE_BACKUP setting; it will not run again for this value" });
  return { outcome: "restored", backup: name, preRestoreBackup: path.basename(safety) };
}
