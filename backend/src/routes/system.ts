import type Database from "better-sqlite3";
import type { Request, Response } from "express";
import { migrationsApplied } from "../db/health.js";
import { lastRun } from "../db/jobRuns.js";
import type { RouteRegistry } from "../http/registry.js";
import type { createTick } from "../jobs/tick.js";

export interface SystemDeps {
  db: Database.Database;
  version: string;
  migrationsTotal: number;
  tick: ReturnType<typeof createTick>;
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
}
