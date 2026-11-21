import type Database from "better-sqlite3";
import type { Logger } from "../lib/logger.js";

export interface JobContext {
  db: Database.Database;
  log: Logger;
  now: Date;
  /** Milliseconds left in this tick's time budget; long jobs should stop early when it runs low. */
  budgetMs: () => number;
}

export interface JobDef {
  /** Stable name, stored in scheduled_job_runs. */
  name: string;
  /** The job is skipped unless at least this many seconds passed since it last started. 0 = every tick. */
  minIntervalSeconds: number;
  /** Must be idempotent and safe to repeat: a missed or interrupted run is only delayed, never replayed. */
  run: (ctx: JobContext) => Promise<unknown> | unknown;
}

/** The list of everything the 5-minute tick may do (docs/architecture.md section 9). */
export class JobRegistry {
  private readonly jobs: JobDef[] = [];

  register(job: JobDef): void {
    if (!/^[a-z][a-z0-9_.]*$/.test(job.name)) throw new Error(`Bad job name "${job.name}"`);
    if (this.jobs.some((j) => j.name === job.name)) throw new Error(`Job "${job.name}" is registered twice`);
    if (!Number.isFinite(job.minIntervalSeconds) || job.minIntervalSeconds < 0) {
      throw new Error(`Job "${job.name}" has a bad interval`);
    }
    this.jobs.push(job);
  }

  list(): readonly JobDef[] {
    return this.jobs;
  }
}
