import { backupDirOf, dailyBackup } from "../../db/backups.js";
import type { JobDef } from "../registry.js";

/** Daily: a consistent copy of the database into <data folder>/backups, the newest 14 kept. The copy lives on the same server disk as the database. */
export const backupJob: JobDef = {
  name: "platform.backup",
  minIntervalSeconds: 23 * 60 * 60,
  run: async ({ db, now, log }) => {
    const dir = backupDirOf(db);
    if (!dir) return { skipped: "in-memory database" };
    const r = await dailyBackup(db, dir, now);
    log.info("daily backup written", { file: r.file, sizeBytes: r.sizeBytes, removed: r.removed.length });
    return { file: r.file, sizeBytes: r.sizeBytes, removed: r.removed.length };
  },
};
