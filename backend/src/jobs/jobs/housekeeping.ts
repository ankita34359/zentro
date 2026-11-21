import { pruneRuns } from "../../db/jobRuns.js";
import type { JobDef } from "../registry.js";

const KEEP_DAYS = 30;

/** Daily: drop tick bookkeeping older than 30 days so the table stays small. More housekeeping joins this job later. */
export const housekeepingJob: JobDef = {
  name: "platform.housekeeping",
  minIntervalSeconds: 23 * 60 * 60,
  run: ({ db, now }) => ({ prunedJobRuns: pruneRuns(db, new Date(now.getTime() - KEEP_DAYS * 86_400_000)) }),
};
