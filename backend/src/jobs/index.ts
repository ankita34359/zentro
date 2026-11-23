import { JobRegistry } from "./registry.js";
import { housekeepingJob } from "./jobs/housekeeping.js";
import { taskRemindersJob } from "./jobs/taskReminders.js";
import { okrHealthJob } from "./jobs/okrHealth.js";
import { kpiThresholdsJob } from "./jobs/kpiThresholds.js";
import { scoresRecalculateJob } from "./jobs/scoresRecalculate.js";

/** Every job the tick knows about. Later stages register theirs here. */
export function defaultJobs(): JobRegistry {
  const r = new JobRegistry();
  r.register(housekeepingJob);
  r.register(taskRemindersJob);
  r.register(okrHealthJob);
  r.register(kpiThresholdsJob);
  r.register(scoresRecalculateJob);
  return r;
}
