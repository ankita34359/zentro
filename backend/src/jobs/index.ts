import { JobRegistry } from "./registry.js";
import { heartbeatJob } from "./jobs/heartbeat.js";
import { housekeepingJob } from "./jobs/housekeeping.js";

/** Every job the tick knows about. Later stages register theirs here. */
export function defaultJobs(): JobRegistry {
  const r = new JobRegistry();
  r.register(heartbeatJob);
  r.register(housekeepingJob);
  return r;
}
