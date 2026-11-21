-- Stage 1.1 spike: one table that proves the database survives redeploys.
-- Portable on purpose: text keys, ISO-8601 UTC text timestamps, no SQLite-only features.
CREATE TABLE spike_counters (
  name       TEXT PRIMARY KEY,
  value      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
