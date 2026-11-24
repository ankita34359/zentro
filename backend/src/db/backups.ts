import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/** Daily copies kept (older ones are removed). The pre-migration copies are kept separately by the migration runner. */
export const KEEP_DAILY_BACKUPS = 14;

export interface BackupFile { name: string; kind: "daily" | "pre-migration"; sizeBytes: number; modifiedAt: string }

/** Where the backups live: a folder next to the database, inside the data folder. It is never inside the folder the web server serves. */
export const backupDirOf = (db: Database.Database): string | null => (db.name && db.name !== ":memory:" ? path.join(path.dirname(db.name), "backups") : null);

/**
 * One consistent copy of the live database, made with SQLite's own online backup (safe while the app is writing; a plain file
 * copy could catch it half-written). It is written under a temporary name, checked by opening it and running SQLite's integrity
 * check, and only then given its real name, so a broken or half-finished file is never counted as a backup. Then the oldest daily
 * copies beyond `keep` are removed.
 */
export async function dailyBackup(db: Database.Database, dir: string, now: Date, keep = KEEP_DAILY_BACKUPS): Promise<{ file: string; sizeBytes: number; removed: string[] }> {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const final = path.join(dir, `daily-${stamp}.db`);
  const tmp = `${final}.partial`;
  try {
    await db.backup(tmp);
    const check = new Database(tmp, { readonly: true, fileMustExist: true });
    try {
      const result = check.pragma("integrity_check", { simple: true });
      if (result !== "ok") throw new Error("The new backup did not pass SQLite's integrity check.");
    } finally {
      check.close();
    }
    fs.renameSync(tmp, final);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  const daily = fs.readdirSync(dir).filter((f) => /^daily-.*\.db$/.test(f)).sort(); // the ISO stamp sorts oldest first
  const removed = daily.slice(0, Math.max(0, daily.length - keep));
  for (const f of removed) fs.rmSync(path.join(dir, f), { force: true });
  return { file: path.basename(final), sizeBytes: fs.statSync(final).size, removed };
}

export function listBackups(dir: string | null): BackupFile[] {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^(daily|pre-\d{4})-.*\.db$/.test(f))
    .map((name): BackupFile => {
      const st = fs.statSync(path.join(dir, name));
      return { name, kind: name.startsWith("daily-") ? "daily" : "pre-migration", sizeBytes: st.size, modifiedAt: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));
}

export function fileSize(file: string): number {
  try { return fs.statSync(file).size; } catch { return 0; }
}
