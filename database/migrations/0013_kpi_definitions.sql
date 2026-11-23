-- Stage 3.3: KPI definitions, who they are assigned to (with targets) and their warning/critical thresholds.
-- ADDITIVE (new tables only). Measurements arrive with 3.4 in their own migration.

CREATE TABLE kpis (
  id                  TEXT PRIMARY KEY,
  organization_id     TEXT NOT NULL REFERENCES organizations(id),
  key                 TEXT NOT NULL,                       -- a short name made of letters, digits and dashes, unique per organization
  name                TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  category            TEXT NOT NULL DEFAULT 'delivery',    -- delivery, quality, impact, financial, growth, people, health (checked in code)
  unit                TEXT,
  value_type          TEXT NOT NULL DEFAULT 'number',      -- number, percentage, currency, count
  direction           TEXT NOT NULL DEFAULT 'higher_is_better', -- higher_is_better, lower_is_better, target_range
  frequency           TEXT NOT NULL DEFAULT 'monthly',     -- daily, weekly, monthly, quarterly, annual
  aggregation         TEXT NOT NULL DEFAULT 'sum',         -- sum, avg, last, min, max: how several measurements in a period become one
  data_source         TEXT NOT NULL DEFAULT 'manual',
  default_target      REAL,
  default_target_max  REAL,
  created_by_membership_id TEXT NOT NULL REFERENCES organization_memberships(id),
  archived_at         TEXT,
  is_demo             INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_kpis_key ON kpis (organization_id, key);
CREATE INDEX idx_kpis_org ON kpis (organization_id, category);

-- Exactly one of the five subjects is set. A designation or role family applies to everyone who holds it at calculation time.
CREATE TABLE kpi_assignments (
  id                        TEXT PRIMARY KEY,
  organization_id           TEXT NOT NULL REFERENCES organizations(id),
  kpi_id                    TEXT NOT NULL REFERENCES kpis(id),
  membership_id             TEXT REFERENCES organization_memberships(id),
  team_id                   TEXT REFERENCES teams(id),
  department_id             TEXT REFERENCES departments(id),
  designation_id            TEXT REFERENCES designations(id),
  role_family_id            TEXT REFERENCES role_families(id),
  target_value              REAL NOT NULL,
  target_max                REAL,
  weight                    REAL NOT NULL DEFAULT 1,
  effective_from            TEXT NOT NULL,
  effective_to              TEXT,
  assigned_by_membership_id TEXT NOT NULL REFERENCES organization_memberships(id),
  created_at                TEXT NOT NULL
);
CREATE INDEX idx_kpi_assignments_kpi ON kpi_assignments (organization_id, kpi_id);

-- level: excellent, warning, critical. comparator: lt, lte, gt, gte. basis: absolute (the value itself) or percent_of_target.
CREATE TABLE kpi_thresholds (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL REFERENCES organizations(id),
  kpi_id            TEXT NOT NULL REFERENCES kpis(id),
  level             TEXT NOT NULL,
  comparator        TEXT NOT NULL,
  basis             TEXT NOT NULL DEFAULT 'absolute',
  value             REAL NOT NULL,
  notify            INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL
);
CREATE INDEX idx_kpi_thresholds_kpi ON kpi_thresholds (organization_id, kpi_id);
