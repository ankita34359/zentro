import type Database from "better-sqlite3";
import { newId } from "../lib/ids.js";

export type JobStatus = "running" | "ok" | "failed" | "partial";

export interface JobRun {
  id: string;
  jobName: string;
  startedAt: string;
  finishedAt: string | null;
  status: JobStatus;
  summary: unknown;
  error: string | null;
}

interface Row {
  id: string;
  job_name: string;
  started_at: string;
  finished_at: string | null;
  status: JobStatus;
  summary_json: string | null;
  error: string | null;
}

const toRun = (r: Row): JobRun => ({
  id: r.id,
  jobName: r.job_name,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  status: r.status,
  summary: r.summary_json ? (JSON.parse(r.summary_json) as unknown) : null,
  error: r.error,
});

/** Tick bookkeeping (scheduled_job_runs). Platform-level SQL, so it lives in db/ with the other global tables. */
export function startRun(db: Database.Database, jobName: string, now: Date): string {
  const id = newId();
  db.prepare("INSERT INTO scheduled_job_runs (id, job_name, started_at, status) VALUES (?, ?, ?, 'running')").run(
    id,
    jobName,
    now.toISOString(),
  );
  return id;
}

export function finishRun(
  db: Database.Database,
  id: string,
  now: Date,
  status: Exclude<JobStatus, "running">,
  summary?: unknown,
  error?: string,
): void {
  db.prepare("UPDATE scheduled_job_runs SET finished_at = ?, status = ?, summary_json = ?, error = ? WHERE id = ?").run(
    now.toISOString(),
    status,
    summary === undefined ? null : JSON.stringify(summary),
    error ? error.slice(0, 500) : null,
    id,
  );
}

/** Most recent run (any outcome except an interrupted one still marked running) of a job, for the min-interval check. */
export function lastStart(db: Database.Database, jobName: string): string | null {
  const r = db
    .prepare("SELECT started_at FROM scheduled_job_runs WHERE job_name = ? ORDER BY started_at DESC LIMIT 1")
    .get(jobName) as { started_at: string } | undefined;
  return r?.started_at ?? null;
}

export function lastRun(db: Database.Database, jobName: string): JobRun | null {
  const r = db
    .prepare("SELECT * FROM scheduled_job_runs WHERE job_name = ? ORDER BY started_at DESC LIMIT 1")
    .get(jobName) as Row | undefined;
  return r ? toRun(r) : null;
}

export function recentRuns(db: Database.Database, limit = 20): JobRun[] {
  return (db.prepare("SELECT * FROM scheduled_job_runs ORDER BY started_at DESC LIMIT ?").all(limit) as Row[]).map(toRun);
}

/** Rows left "running" by a process that died: mark them failed so nothing looks stuck forever. */
export function failInterrupted(db: Database.Database, olderThan: Date, now: Date): number {
  return db
    .prepare(
      "UPDATE scheduled_job_runs SET status = 'failed', finished_at = ?, error = 'interrupted (process restarted or timed out)' WHERE status = 'running' AND started_at < ?",
    )
    .run(now.toISOString(), olderThan.toISOString()).changes;
}

export function pruneRuns(db: Database.Database, before: Date): number {
  return db.prepare("DELETE FROM scheduled_job_runs WHERE started_at < ?").run(before.toISOString()).changes;
}
