import path from "node:path";
import { createApp } from "./app.js";
import { describeProblem, loadConfig } from "./config/env.js";
import { createHoldingApp } from "./config/holding.js";
import { migrate } from "./db/migrate.js";
import { openDatabase } from "./db/open.js";
import { findProjectRoot } from "./lib/paths.js";
import { createLogger } from "./lib/logger.js";
import fs from "node:fs";

const root = findProjectRoot();
const port = Number(process.env.PORT) || 3001; // 3001 only for local dev
const version = process.env.APP_VERSION || "dev";
const cronSecret = process.env.CRON_SECRET;
const loaded = loadConfig(process.env);

if (!loaded.ok) {
  // Holding mode: listen anyway, show what is missing (names only), never open the database.
  const log = createLogger("info");
  const names = [...loaded.missing, ...loaded.invalid.map((i) => i.name)];
  const message = describeProblem(loaded);
  createHoldingApp({ message, names, version, cronSecret, log }).listen(port, "0.0.0.0", () => {
    log.warn("holding mode", { port, node: process.versions.node, problem: message });
  });
} else {
  const { config } = loaded;
  const log = createLogger(config.logLevel);
  const dataDir = process.env.DATA_DIR || path.join(root, "data"); // ./data only for local dev
  const { db, file } = openDatabase(dataDir);
  const migrationsDir = path.join(root, "database", "migrations");
  const result = migrate(db, migrationsDir);
  if (result.unknownApplied.length > 0) log.warn("database is newer than this code", { unknown: result.unknownApplied });

  const { app } = createApp({
    db,
    config,
    version,
    cronSecret,
    migrationsTotal: result.total,
    log,
    staticDir: path.join(root, "dist"),
  });
  if (config.registration.mode === "closed") {
    log.warn("registration is closed", { hint: "set REGISTRATION_MODE=code and REGISTRATION_CODE (at least 8 characters) to allow sign-ups" });
  }
  app.listen(port, "0.0.0.0", () => {
    log.info("listening", {
      port,
      node: process.versions.node,
      db: file,
      migrationsApplied: `${result.applied.length}/${result.total}`,
      preMigrationCopy: result.backupFile ? path.basename(result.backupFile) : null,
      cronConfigured: Boolean(cronSecret),
      appAddressSet: Boolean(config.appUrl),
      registration: config.registration.mode,
      staticBuild: fs.existsSync(path.join(root, "dist", "index.html")),
    });
  });
}
