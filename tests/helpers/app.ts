import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Express } from "express";
import type Database from "better-sqlite3";
import { createApp, type AppOptions } from "../../backend/src/app.js";
import { loadConfig, type Config } from "../../backend/src/config/env.js";
import { migrate } from "../../backend/src/db/migrate.js";
import { openDatabase } from "../../backend/src/db/open.js";
import { createLogger } from "../../backend/src/lib/logger.js";

export const migrationsDir = path.resolve(import.meta.dirname, "../../database/migrations");
export const CRON = "cron-secret-for-tests";
/** Obviously fake values, long enough to pass validation. */
export const FAKE_ENV = {
  SESSION_SECRET: "test-session-secret-0123456789-abcdefghij",
  ENCRYPTION_KEY: "test-encryption-key-9876543210-zyxwvutsrq",
  APP_URL: "https://zentro.test",
} as const;
/** The browser's Origin header for a request from the test site (state-changing /api calls must send it). */
export const ORIGIN = "https://zentro.test";

export function testConfig(extra: NodeJS.ProcessEnv = {}): Config {
  const r = loadConfig({ ...FAKE_ENV, ...extra });
  if (!r.ok) throw new Error("test config invalid");
  return r.config;
}

export interface TestApp {
  app: Express;
  db: Database.Database;
  dir: string;
  lines: string[];
  registry: ReturnType<typeof createApp>["registry"];
  tick: ReturnType<typeof createApp>["tick"];
  cleanup: () => void;
}

export function makeTestApp(over: Partial<AppOptions> = {}): TestApp {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zentro-test-"));
  const { db } = openDatabase(dir);
  const result = migrate(db, migrationsDir);
  const lines: string[] = [];
  const built = createApp({
    db,
    config: testConfig(),
    version: "test",
    cronSecret: CRON,
    migrationsTotal: result.total,
    log: createLogger("debug", (l) => lines.push(l)),
    apiRequestsPerMinute: 1_000_000, // the matrices send thousands of calls from one address; the limit has its own tests
    ...over,
  });
  return {
    ...built,
    db,
    dir,
    lines,
    cleanup: () => {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const tmpDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "zentro-tmp-"));
