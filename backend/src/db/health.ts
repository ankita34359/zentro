import type Database from "better-sqlite3";

/** How many migrations the database has recorded; throws if the database cannot be read. */
export function migrationsApplied(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number }).n;
}
