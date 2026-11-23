import { JobRegistry } from "./registry.js";
import { housekeepingJob } from "./jobs/housekeeping.js";
import { taskRemindersJob } from "./jobs/taskReminders.js";

/** Every job the tick knows about. Later stages register theirs here. */
export function defaultJobs(): JobRegistry {
  const r = new JobRegistry();
  r.register(housekeepingJob);
  r.register(taskRemindersJob);
  return r;
}
