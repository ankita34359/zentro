-- Stage 3.4: KPI measurements. ADDITIVE (one new table). APPEND-ONLY: a correction is a new row that names the row it
-- replaces (supersedes_measurement_id); the "current" value of a period is the row no other row supersedes. A period with no
-- row is MISSING: it is never stored as zero.

CREATE TABLE kpi_measurements (
  id                          TEXT PRIMARY KEY,
  organization_id             TEXT NOT NULL REFERENCES organizations(id),
  kpi_id                      TEXT NOT NULL REFERENCES kpis(id),
  kpi_assignment_id           TEXT REFERENCES kpi_assignments(id),
  subject_membership_id       TEXT REFERENCES organization_memberships(id),   -- at most one of the three subjects; none = the organization as a whole
  subject_team_id             TEXT REFERENCES teams(id),
  subject_department_id       TEXT REFERENCES departments(id),
  period_start                TEXT NOT NULL,                                   -- the first day of the period (see periods.ts)
  period_end                  TEXT NOT NULL,
  value                       REAL NOT NULL,
  value_status                TEXT NOT NULL DEFAULT 'recorded',                -- recorded, estimated, disputed
  recorded_at                 TEXT NOT NULL,
  recorded_by_membership_id   TEXT REFERENCES organization_memberships(id),
  source                      TEXT NOT NULL DEFAULT 'manual',                  -- manual, task, integration, import, demo
  source_ref                  TEXT,
  note                        TEXT,
  supersedes_measurement_id   TEXT REFERENCES kpi_measurements(id)
);
CREATE INDEX idx_kpi_measurements_series ON kpi_measurements (organization_id, kpi_id, period_start);
CREATE INDEX idx_kpi_measurements_person ON kpi_measurements (organization_id, subject_membership_id);
-- a row can be replaced only once, so the chain of corrections stays a straight line
CREATE UNIQUE INDEX uq_kpi_measurements_supersedes ON kpi_measurements (supersedes_measurement_id) WHERE supersedes_measurement_id IS NOT NULL;
