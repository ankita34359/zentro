import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

export interface MigrationResult {
  applied: string[];
  total: number;
}

/**
 * Applies database/migrations/NNNN_name.sql in order, one transaction each,
 * tracked in schema_migrations(id, name, checksum, applied_at).
 * A released migration is never edited: a checksum mismatch fails startup loudly.
 * Embarko's own _litestream_* tables are never touched.
 */
export function migrate(db: Database.Database, dir: string): MigrationResult {
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

  const done = new Map<string, string>(
    (db.prepare("SELECT id, checksum FROM schema_migrations").all() as { id: string; checksum: string }[]).map(
      (r) => [r.id, r.checksum],
    ),
  );

  const applied: string[] = [];
  for (const file of files) {
    const id = file.slice(0, 4);
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    const existing = done.get(id);
    if (existing !== undefined) {
      if (existing !== checksum) {
        throw new Error(`Migration ${file} was changed after it was applied (checksum mismatch)`);
      }
      continue;
    }
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (id, name, checksum, applied_at) VALUES (?, ?, ?, ?)").run(
        id,
        file,
        checksum,
        new Date().toISOString(),
      );
    })();
    applied.push(file);
  }
  return { applied, total: files.length };
}
