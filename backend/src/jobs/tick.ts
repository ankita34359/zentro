import type Database from "better-sqlite3";
import { failInterrupted, finishRun, lastStart, startRun, type JobStatus } from "../db/jobRuns.js";
import type { Logger } from "../lib/logger.js";
import type { JobRegistry } from "./registry.js";

export interface TickOptions {
  /** Stop starting new jobs after this long (Embarko gives each call 5 minutes; default 200 s). */
  budgetMs?: number;
  /** A tick or job still "running" after this long is treated as dead (default 10 minutes). */
  staleAfterMs?: number;
  clock?: () => Date;
}

export interface TickSummary {
  started: boolean;
  skipped?: string;
  ran: string[];
  notDue: string[];
  failed: string[];
  deferred: string[];
}

/**
 * The single scheduled entry point (docs/architecture.md section 9). One run at a time. Each call walks the job
 * registry, runs the jobs that are due, and records the tick itself and every job in scheduled_job_runs.
 */
export function createTick(db: Database.Database, registry: JobRegistry, log: Logger, opts: TickOptions = {}) {
  const budget = opts.budgetMs ?? 200_000;
  const staleAfter = opts.staleAfterMs ?? 10 * 60_000;
  const clock = opts.clock ?? (() => new Date());
  let runningSince: number | null = null;

  const isRunning = (): boolean => runningSince !== null && Date.now() - runningSince < staleAfter;

  async function run(): Promise<TickSummary> {
    if (isRunning()) return { started: false, skipped: "already running", ran: [], notDue: [], failed: [], deferred: [] };
    runningSince = Date.now();
    const began = Date.now();
    const summary: TickSummary = { started: true, ran: [], notDue: [], failed: [], deferred: [] };
    const tickStart = clock();
    const tickId = startRun(db, "tick", tickStart);
    try {
      failInterrupted(db, new Date(tickStart.getTime() - staleAfter), tickStart);
      for (const job of registry.list()) {
        const now = clock();
        const last = lastStart(db, job.name);
        if (last && now.getTime() - Date.parse(last) < job.minIntervalSeconds * 1000) {
          summary.notDue.push(job.name);
          continue;
        }
        if (Date.now() - began > budget) {
          summary.deferred.push(job.name); // still due next tick: nothing is lost, only delayed
          continue;
        }
        const id = startRun(db, job.name, now);
        try {
          const result = await job.run({ db, log, now, budgetMs: () => Math.max(0, budget - (Date.now() - began)) });
          finishRun(db, id, clock(), "ok", result);
          summary.ran.push(job.name);
        } catch (err) {
          // Only the message is stored or logged: never a stack, never job data.
          const message = err instanceof Error ? err.message : "job threw a non-error";
          finishRun(db, id, clock(), "failed", undefined, message);
          log.error("job failed", { job: job.name, error: message });
          summary.failed.push(job.name);
        }
      }
      const status: JobStatus = summary.failed.length > 0 ? "partial" : "ok";
      finishRun(db, tickId, clock(), status, {
        ran: summary.ran.length,
        failed: summary.failed.length,
        notDue: summary.notDue.length,
        deferred: summary.deferred.length,
      });
      log.info("tick", { ran: summary.ran.length, failed: summary.failed.length, ms: Date.now() - began });
      return summary;
    } catch (err) {
      const message = err instanceof Error ? err.message : "tick failed";
      finishRun(db, tickId, clock(), "failed", undefined, message);
      throw err;
    } finally {
      runningSince = null;
    }
  }

  return { isRunning, run };
}
