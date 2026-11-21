import type Database from "better-sqlite3";

export interface Counter {
  value: number;
  updatedAt: string | null;
}

export function bump(db: Database.Database, name: string, now: Date = new Date()): Counter {
  const at = now.toISOString();
  db.prepare(
    `INSERT INTO spike_counters (name, value, updated_at) VALUES (?, 1, ?)
     ON CONFLICT(name) DO UPDATE SET value = value + 1, updated_at = excluded.updated_at`,
  ).run(name, at);
  return read(db, name);
}

export function read(db: Database.Database, name: string): Counter {
  const row = db.prepare("SELECT value, updated_at FROM spike_counters WHERE name = ?").get(name) as
    | { value: number; updated_at: string }
    | undefined;
  return { value: row?.value ?? 0, updatedAt: row?.updated_at ?? null };
}
