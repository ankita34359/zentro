import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express, { type Express, type Request, type Response } from "express";
import type Database from "better-sqlite3";
import { bump, read } from "./db/counters.js";
import { createTick } from "./jobs/tick.js";

export interface AppOptions {
  db: Database.Database;
  dbFile: string;
  version: string;
  appName: string;
  cronSecret: string | undefined;
  /** Folder holding the Vite build (index.html). Omit in API-only tests. */
  staticDir?: string;
}

/** Constant-time check of "Authorization: Bearer <secret>". Always false when the secret is unset. */
export function bearerMatches(header: string | undefined, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const m = /^Bearer (.+)$/.exec(header);
  if (!m || m[1] === undefined) return false;
  const a = crypto.createHash("sha256").update(m[1]).digest();
  const b = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}

export function createApp(opts: AppOptions): Express {
  const { db } = opts;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  const tick = createTick(db);

  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({ ok: true, version: opts.version, node: process.versions.node });
  });

  // Embarko calls GET with "Authorization: Bearer <CRON_SECRET>". Answer 202 immediately, work in the background.
  app.get("/api/cron/tick", (req: Request, res: Response) => {
    if (!bearerMatches(req.header("authorization"), opts.cronSecret)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (tick.isRunning()) {
      res.status(202).json({ started: false, skipped: "already running" });
      return;
    }
    res.status(202).json({ started: true });
    void tick.run().catch((err: unknown) => {
      console.error("tick failed:", err instanceof Error ? err.message : String(err));
    });
  });

  app.get("/api/spike", (_req: Request, res: Response) => {
    const visits = read(db, "visits");
    const ticks = read(db, "ticks");
    res.json({
      app: opts.appName,
      version: opts.version,
      node: process.versions.node,
      dbPath: opts.dbFile,
      visits: visits.value,
      ticks: ticks.value,
      lastTickAt: ticks.updatedAt,
      serverTime: new Date().toISOString(),
    });
  });

  app.post("/api/spike/visit", (_req: Request, res: Response) => {
    res.json({ visits: bump(db, "visits").value });
  });

  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  if (opts.staticDir && fs.existsSync(path.join(opts.staticDir, "index.html"))) {
    const dir = opts.staticDir;
    app.use(express.static(dir));
    app.get(/^(?!\/api\/).*/, (_req: Request, res: Response) => {
      res.sendFile(path.join(dir, "index.html"));
    });
  }

  return app;
}
