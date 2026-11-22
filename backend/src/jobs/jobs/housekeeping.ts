import { pruneRuns } from "../../db/jobRuns.js";
import { SessionsRepository } from "../../modules/auth/repositories/sessions.js";
import type { JobDef } from "../registry.js";

const KEEP_DAYS = 30;

/** Daily: drop tick bookkeeping older than 30 days and sessions past their hard expiry. More housekeeping joins this job later. */
export const housekeepingJob: JobDef = {
  name: "platform.housekeeping",
  minIntervalSeconds: 23 * 60 * 60,
  run: ({ db, now }) => ({
    prunedJobRuns: pruneRuns(db, new Date(now.getTime() - KEEP_DAYS * 86_400_000)),
    purgedSessions: new SessionsRepository(db).purgeExpired(now.toISOString()),
  }),
};
