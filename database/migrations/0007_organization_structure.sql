-- Stage 2.5: the organization's structure: departments, teams (and sub-teams), role families and designations.
-- ADDITIVE (new tables only), so the previous version keeps running on the upgraded database and a rollback is safe.
-- Nothing is deleted: structure is archived (archived_at) and can be restored. Names are unique among ACTIVE
-- siblings, compared without regard to case. Department and team heads and the membership of people arrive in 2.6.

CREATE TABLE departments (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations(id),
  parent_id        TEXT REFERENCES departments(id),          -- NULL = a top-level department; free depth, at most 8 levels (enforced in code)
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  archived_at      TEXT,
  is_demo          INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_departments_active_name ON departments (organization_id, COALESCE(parent_id, ''), lower(name)) WHERE archived_at IS NULL;
CREATE INDEX idx_departments_org ON departments (organization_id, parent_id);

CREATE TABLE teams (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations(id),
  department_id    TEXT NOT NULL REFERENCES departments(id), -- every team (and sub-team) belongs to one department
  parent_team_id   TEXT REFERENCES teams(id),                -- NULL = directly under the department; a sub-team shares its parent's department
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  archived_at      TEXT,
  is_demo          INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_teams_active_name ON teams (organization_id, department_id, COALESCE(parent_team_id, ''), lower(name)) WHERE archived_at IS NULL;
CREATE INDEX idx_teams_org ON teams (organization_id, department_id, parent_team_id);

CREATE TABLE role_families (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations(id),
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  archived_at      TEXT,
  is_demo          INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_role_families_active_name ON role_families (organization_id, lower(name)) WHERE archived_at IS NULL;

CREATE TABLE designations (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations(id),
  role_family_id   TEXT REFERENCES role_families(id),        -- optional; a designation may stand alone
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  archived_at      TEXT,
  is_demo          INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_designations_active_name ON designations (organization_id, lower(name)) WHERE archived_at IS NULL;
CREATE INDEX idx_designations_family ON designations (organization_id, role_family_id);
