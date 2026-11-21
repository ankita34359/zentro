import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export function openDatabase(dataDir: string): { db: Database.Database; file: string } {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "zentro.db");
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return { db, file };
}
