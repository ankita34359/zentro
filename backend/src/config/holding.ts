import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { apiNotFound, errorHandler } from "../http/errorHandler.js";
import { sendError } from "../http/envelope.js";
import { requestId } from "../http/requestId.js";
import { requestLog } from "../http/requestLog.js";
import { assertAllRegistered, denyAllGuards, RouteRegistry } from "../http/registry.js";
import type { Logger } from "../lib/logger.js";

export interface HoldingOptions {
  /** "Server is missing: A, B" built by describeProblem(): names only. */
  message: string;
  names: string[];
  version: string;
  cronSecret: string | undefined;
  log: Logger;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function holdingHtml(message: string, names: string[]): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zentro: finishing setup</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:12vh auto;padding:0 1rem;color:#1c1c1c}
code{background:#f1f1f1;padding:.1em .35em;border-radius:4px}li{margin:.2rem 0}</style></head>
<body><h1>Zentro is almost ready</h1>
<p>${esc(message)}.</p>
<ul>${names.map((n) => `<li><code>${esc(n)}</code></li>`).join("")}</ul>
<p>Add ${names.length === 1 ? "it" : "them"} on this app's <strong>App setup</strong> page in Embarko, then press
<strong>Apply changes</strong>. This page goes away by itself once the settings are in.</p></body></html>`;
}

/**
 * What the server runs when required settings are missing or invalid. It still listens (so Embarko sees a healthy
 * process and the problem is visible from outside), answers /healthz and the cron route, shows a plain page at the
 * site address, and answers every /api path with 503 naming the settings. It never opens the database.
 */
export function createHoldingApp(o: HoldingOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  const registry = new RouteRegistry();

  registry.add({
    method: "get",
    path: "/healthz",
    access: { kind: "public", why: "health probe; says not ready and names the missing settings" },
    summary: "Holding-mode health",
    handler: (_req, res) => {
      res.json({ ok: true, ready: false, version: o.version, node: process.versions.node, migrations: null, lastTick: null, missing: o.names });
    },
  });
  registry.add({
    method: "get",
    path: "/api/cron/tick",
    access: { kind: "cron" },
    summary: "Holding-mode tick: authenticates, does nothing",
    handler: (_req, res) => {
      res.status(202).json({ accepted: true, started: false, skipped: "server settings missing" });
    },
  });

  app.use(requestId);
  app.use(requestLog(o.log));
  registry.mount(app, denyAllGuards(o.cronSecret));
  assertAllRegistered(app, registry);

  app.use("/api", (_req: Request, res: Response) => {
    sendError(res, 503, "server_missing_settings", o.message, { missing: o.names });
  });
  const html = holdingHtml(o.message, o.names);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    res.status(200).type("html").send(html);
  });
  app.use(apiNotFound);
  app.use(errorHandler(o.log));
  return app;
}
