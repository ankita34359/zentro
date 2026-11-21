-- Stage 1.2: bookkeeping for the 5-minute tick and the jobs it runs (docs/database-design.md section 3.11).
-- organization_id is plain TEXT (no foreign key): this is an operational log, NULL for platform jobs, and SQLite
-- cannot add a foreign key to an existing table later without rebuilding it.
CREATE TABLE scheduled_job_runs (
  id              TEXT PRIMARY KEY,
  job_name        TEXT NOT NULL,
  organization_id TEXT,
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  status          TEXT NOT NULL,
  summary_json    TEXT,
  error           TEXT
);

CREATE INDEX idx_scheduled_job_runs_job_started ON scheduled_job_runs (job_name, started_at);
