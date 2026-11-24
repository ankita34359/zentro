import type Database from "better-sqlite3";
import type { Request, Response } from "express";
import { migrationsApplied } from "../db/health.js";
import { backupDirOf, fileSize, KEEP_DAILY_BACKUPS, listBackups } from "../db/backups.js";
import { lastRun, recentRuns } from "../db/jobRuns.js";
import { sendData } from "../http/envelope.js";
import type { RouteRegistry } from "../http/registry.js";
import type { createTick } from "../jobs/tick.js";

export interface SystemDeps {
  db: Database.Database;
  version: string;
  migrationsTotal: number;
  tick: ReturnType<typeof createTick>;
  /** How registration is set up (never the code itself): shown on /healthz so a deploy can be checked. */
  registration: "code" | "open" | "closed";
}

/** GET /healthz: no sign-in, no secrets, no paths. Used by the post-deploy smoke test and the owner's live check. */
export function registerSystemRoutes(registry: RouteRegistry, deps: SystemDeps): void {
  registry.add({
    method: "get",
    path: "/healthz",
    access: { kind: "public", why: "health probe used by the deploy smoke test; exposes counts and versions only" },
    summary: "Health: ok, ready, version, migrations applied/total, last tick",
    handler: (_req: Request, res: Response) => {
      let dbOk = true;
      let applied = 0;
      try {
        applied = migrationsApplied(deps.db);
      } catch {
        dbOk = false;
      }
      const tick = dbOk ? lastRun(deps.db, "tick") : null;
      res.json({
        ok: dbOk,
        ready: dbOk,
        version: deps.version,
        node: process.versions.node,
        migrations: { applied, total: deps.migrationsTotal },
        registration: deps.registration,
        lastTick: tick ? { startedAt: tick.startedAt, finishedAt: tick.finishedAt, status: tick.status } : null,
        memoryMb: Math.round(process.memoryUsage().rss / 1_048_576),
      });
    },
  });

  // Embarko calls GET with "Authorization: Bearer <CRON_SECRET>" and gives up after 5 minutes: answer 202 at once.
  registry.add({
    method: "get",
    path: "/api/cron/tick",
    access: { kind: "cron" },
    summary: "Scheduled tick: runs due jobs in the background; 202 immediately",
    handler: (_req: Request, res: Response) => {
      if (deps.tick.isRunning()) {
        res.status(202).json({ accepted: true, started: false, skipped: "already running" });
        return;
      }
      res.status(202).json({ accepted: true, started: true });
      void deps.tick.run().catch(() => undefined); // failures are already recorded and logged by the tick
    },
  });

  // The System page (administrators only: the same permission as the organization's settings). Facts about the server, never a path, a secret or a file's contents.
  registry.add({
    method: "get",
    path: "/api/system",
    access: { kind: "permission", key: "org.settings" },
    summary: "The System page: app version, migrations applied, database size, the daily backup (last time and result, how many copies, the newest), and the status of each background job. Backups live on the server's own disk; this page says so and never offers them for download",
    handler: (_req: Request, res: Response) => {
      res.setHeader("Cache-Control", "no-store");
      const dir = backupDirOf(deps.db);
      const files = listBackups(dir);
      const daily = files.filter((f) => f.kind === "daily");
      const last = lastRun(deps.db, "platform.backup");
      const newest = daily[0] ?? null;
      const jobs = new Map<string, { name: string; startedAt: string; finishedAt: string | null; status: string; error: string | null }>();
      for (const r of recentRuns(deps.db, 200)) if (r.jobName !== "tick" && !jobs.has(r.jobName)) jobs.set(r.jobName, { name: r.jobName, startedAt: r.startedAt, finishedAt: r.finishedAt, status: r.status, error: r.error });
      const tick = lastRun(deps.db, "tick");
      sendData(res, {
        version: deps.version,
        node: process.versions.node,
        migrations: { applied: migrationsApplied(deps.db), total: deps.migrationsTotal },
        database: { sizeBytes: fileSize(deps.db.name) },
        backups: {
          count: files.length,
          daily: { count: daily.length, keep: KEEP_DAILY_BACKUPS },
          preMigration: { count: files.length - daily.length },
          newest: newest ? { name: newest.name, sizeBytes: newest.sizeBytes, at: newest.modifiedAt } : null,
          /** The newest copies by name (a plain file name, never a path): what to type into the restore setting (docs/RECOVERY.md). */
          files: files.slice(0, 20).map((f) => ({ name: f.name, kind: f.kind, sizeBytes: f.sizeBytes, at: f.modifiedAt })),
          lastRun: last ? { startedAt: last.startedAt, finishedAt: last.finishedAt, status: last.status, error: last.error } : null,
          location: "On the server's own disk, in the app's data folder, next to the database.",
          warning: "These copies protect against a mistake or a bad update. They are on the same disk as the database, so they do NOT protect against losing the server or its disk. An off-server copy is a later step.",
        },
        jobs: [...jobs.values()],
        lastTick: tick ? { startedAt: tick.startedAt, finishedAt: tick.finishedAt, status: tick.status } : null,
      });
    },
  });
}
