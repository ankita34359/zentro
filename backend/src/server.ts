import path from "node:path";
import { createApp } from "./app.js";
import { openDatabase } from "./db/open.js";
import { migrate } from "./db/migrate.js";
import { findProjectRoot } from "./lib/paths.js";

const root = findProjectRoot();
const dataDir = process.env.DATA_DIR || path.join(root, "data"); // ./data only for local dev
const port = Number(process.env.PORT) || 3001; // 3001 only for local dev

const { db, file } = openDatabase(dataDir);
const result = migrate(db, path.join(root, "database", "migrations"));

const app = createApp({
  db,
  dbFile: file,
  version: process.env.APP_VERSION || "dev",
  appName: process.env.APP_NAME || "zentro",
  cronSecret: process.env.CRON_SECRET,
  staticDir: path.join(root, "dist"),
});

app.listen(port, "0.0.0.0", () => {
  console.log(
    `zentro listening on 0.0.0.0:${port} | node ${process.versions.node} | db ${file} | migrations applied ${result.applied.length}/${result.total}`,
  );
});
