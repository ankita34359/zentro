import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

export interface MigrationResult {
  applied: string[];
  total: number;
  /** Where the safety copy of the database was written before changing it (null when none was needed). */
  backupFile: string | null;
  /** Ids recorded in the database that this version of the code does not know (an older release is running). */
  unknownApplied: string[];
}

export interface MigrateOptions {
  /** Folder for the pre-migration copy; default: <database folder>/backups. Pass null to skip (tests of the runner). */
  backupDir?: string | null;
  keepBackups?: number;
  now?: () => Date;
}

/**
 * Applies database/migrations/NNNN_name.sql in order, one transaction each, tracked in
 * schema_migrations(id, name, checksum, applied_at).
 *  - A released migration is never edited: a checksum mismatch fails startup loudly.
 *  - Before applying anything to a database that already holds earlier migrations, a consistent copy is written
 *    to <data>/backups (VACUUM INTO) and only the newest few are kept. This protects against a bad migration, NOT
 *    against losing the whole volume (Embarko has no backups).
 *  - Embarko's own _litestream_* tables are never touched.
 */
export function migrate(db: Database.Database, dir: string, opts: MigrateOptions = {}): MigrationResult {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    checksum   TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort();

  const ids = files.map((f) => f.slice(0, 4));
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`Two migration files share the number ${dup}`);

  const done = new Map<string, string>(
    (db.prepare("SELECT id, checksum FROM schema_migrations").all() as { id: string; checksum: string }[]).map(
      (r) => [r.id, r.checksum],
    ),
  );

  // Verify every already-applied file BEFORE changing anything.
  const pending: { file: string; id: string; sql: string; checksum: string }[] = [];
  for (const file of files) {
    const id = file.slice(0, 4);
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    const existing = done.get(id);
    if (existing === undefined) pending.push({ file, id, sql, checksum });
    else if (existing !== checksum) throw new Error(`Migration ${file} was changed after it was applied (checksum mismatch)`);
  }
  const unknownApplied = [...done.keys()].filter((id) => !ids.includes(id));

  let backupFile: string | null = null;
  if (pending.length > 0 && done.size > 0 && opts.backupDir !== null) {
    backupFile = backupBeforeMigrating(db, opts, pending[0]!.id);
  }

  const now = opts.now ?? (() => new Date());
  const applied: string[] = [];
  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (id, name, checksum, applied_at) VALUES (?, ?, ?, ?)").run(
        m.id,
        m.file,
        m.checksum,
        now().toISOString(),
      );
    })();
    applied.push(m.file);
  }
  return { applied, total: files.length, backupFile, unknownApplied };
}

function backupBeforeMigrating(db: Database.Database, opts: MigrateOptions, firstPendingId: string): string | null {
  const dbFile = db.name;
  if (!dbFile || dbFile === ":memory:" || !fs.existsSync(dbFile)) return null;
  const dir = opts.backupDir ?? path.join(path.dirname(dbFile), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = (opts.now ?? (() => new Date()))().toISOString().replace(/[:.]/g, "-");
  const target = path.join(dir, `pre-${firstPendingId}-${stamp}.db`);
  db.prepare("VACUUM INTO ?").run(target);

  const keep = opts.keepBackups ?? 3;
  const old = fs
    .readdirSync(dir)
    .filter((f) => /^pre-\d{4}-.*\.db$/.test(f))
    .sort(); // the ISO stamp sorts oldest first
  for (const f of old.slice(0, Math.max(0, old.length - keep))) fs.rmSync(path.join(dir, f), { force: true });
  return target;
}
