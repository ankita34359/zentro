import { bump } from "../../db/counters.js";
import type { JobDef } from "../registry.js";

/** Stage 1.1 proof that Embarko's scheduler reaches the app: counts ticks for the spike page. Removed with the spike (1.3). */
export const heartbeatJob: JobDef = {
  name: "platform.heartbeat",
  minIntervalSeconds: 0,
  run: ({ db, now }) => ({ ticks: bump(db, "ticks", now).value }),
};
