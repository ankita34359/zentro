import type Database from "better-sqlite3";
import type { Request, Response } from "express";
import { bump, read } from "../db/counters.js";
import { sendData } from "../http/envelope.js";
import type { RouteRegistry } from "../http/registry.js";

export interface SpikeDeps {
  db: Database.Database;
  dbFile: string;
  version: string;
  appName: string;
}

/** The 1.1 proof page's two routes, kept until the real frontend lands (1.3), now behind the registry and the envelope. */
export function registerSpikeRoutes(registry: RouteRegistry, d: SpikeDeps): void {
  registry.add({
    method: "get",
    path: "/api/spike",
    access: { kind: "public", why: "stage 1.1 proof page, shows no tenant data; removed in stage 1.3" },
    summary: "Spike: version, Node, database path, counters",
    handler: (_req: Request, res: Response) => {
      const visits = read(d.db, "visits");
      const ticks = read(d.db, "ticks");
      sendData(res, {
        app: d.appName,
        version: d.version,
        node: process.versions.node,
        dbPath: d.dbFile,
        visits: visits.value,
        ticks: ticks.value,
        lastTickAt: ticks.updatedAt,
        serverTime: new Date().toISOString(),
      });
    },
  });
  registry.add({
    method: "post",
    path: "/api/spike/visit",
    access: { kind: "public", why: "stage 1.1 proof page visit counter; removed in stage 1.3" },
    summary: "Spike: count one page view",
    handler: (_req: Request, res: Response) => {
      sendData(res, { visits: bump(d.db, "visits").value });
    },
  });
}
