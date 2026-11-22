import express, { type Express } from "express";
import type Database from "better-sqlite3";
import type { Config } from "./config/env.js";
import { apiNotFound, errorHandler } from "./http/errorHandler.js";
import { revalidateHealthz } from "./http/cacheHeaders.js";
import { compressText } from "./http/compress.js";
import { requestId } from "./http/requestId.js";
import { requestLog } from "./http/requestLog.js";
import { assertAllRegistered, denyAllGuards, RouteRegistry, type Guards } from "./http/registry.js";
import { mountSpa } from "./http/spa.js";
import { defaultJobs } from "./jobs/index.js";
import type { JobRegistry } from "./jobs/registry.js";
import { createTick } from "./jobs/tick.js";
import type { Logger } from "./lib/logger.js";
import { registerSystemRoutes } from "./routes/system.js";

export interface AppOptions {
  db: Database.Database;
  config: Config;
  version: string;
  cronSecret: string | undefined;
  migrationsTotal: number;
  log: Logger;
  /** Folder holding the Vite build (index.html). Omit in API-only tests. */
  staticDir?: string;
  /** Replace the job list (tests). */
  jobs?: JobRegistry;
  /** Add routes (tests, later stages). They go through the same registry and boot check. */
  extraRoutes?: (registry: RouteRegistry) => void;
  /** Replace the sign-in guards (stage 2.1 supplies real ones; the default refuses everyone). */
  guards?: Guards;
}

export function createApp(opts: AppOptions): { app: Express; registry: RouteRegistry; tick: ReturnType<typeof createTick> } {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", opts.config.trustProxy);

  const jobs = opts.jobs ?? defaultJobs();
  const tick = createTick(opts.db, jobs, opts.log);
  const registry = new RouteRegistry();

  registerSystemRoutes(registry, { db: opts.db, version: opts.version, migrationsTotal: opts.migrationsTotal, tick });
  opts.extraRoutes?.(registry);

  app.use(requestId);
  app.use(requestLog(opts.log));
  app.use(compressText());
  app.use(revalidateHealthz);
  app.use(express.json({ limit: "100kb" }));
  registry.mount(app, opts.guards ?? denyAllGuards(opts.cronSecret));
  assertAllRegistered(app, registry);

  app.use("/api", apiNotFound);
  mountSpa(app, opts.staticDir);
  app.use(apiNotFound);
  app.use(errorHandler(opts.log));
  return { app, registry, tick };
}
