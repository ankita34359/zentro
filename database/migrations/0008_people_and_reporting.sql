-- Stage 2.6: people and reporting lines.
-- ADDITIVE (new tables and nullable columns only), so the previous version keeps running on the upgraded database and a
-- rollback is safe. Everything here is effective-dated: a row is ACTIVE on day D when start_date <= D and
-- (end_date IS NULL or D < end_date), so "ended on the 1st" means the person was last in it on the 31st.
-- Nothing is deleted: a change ends the old row and starts a new one, so "who headed Engineering in Q2" stays answerable.

ALTER TABLE organization_memberships ADD COLUMN designation_id  TEXT REFERENCES designations(id); -- cached copy of the open designation_assignments row
ALTER TABLE organization_memberships ADD COLUMN employee_code   TEXT;
ALTER TABLE organization_memberships ADD COLUMN employment_type TEXT;                              -- full_time, part_time, contractor, internship (checked in code, not by CHECK: the list may grow)
ALTER TABLE organization_memberships ADD COLUMN start_date      TEXT;
ALTER TABLE organization_memberships ADD COLUMN end_date        TEXT;

CREATE TABLE designation_assignments (
  id                          TEXT PRIMARY KEY,
  organization_id             TEXT NOT NULL REFERENCES organizations(id),
  membership_id               TEXT NOT NULL REFERENCES organization_memberships(id),
  designation_id              TEXT NOT NULL REFERENCES designations(id),
  start_date                  TEXT NOT NULL,
  end_date                    TEXT,
  reason                      TEXT,
  created_by_membership_id    TEXT REFERENCES organization_memberships(id),
  created_at                  TEXT NOT NULL
);
CREATE INDEX idx_designation_assignments_person ON designation_assignments (organization_id, membership_id, start_date);
CREATE UNIQUE INDEX uq_designation_assignments_open ON designation_assignments (organization_id, membership_id) WHERE end_date IS NULL;

CREATE TABLE department_memberships (
  id                          TEXT PRIMARY KEY,
  organization_id             TEXT NOT NULL REFERENCES organizations(id),
  department_id               TEXT NOT NULL REFERENCES departments(id),
  membership_id               TEXT NOT NULL REFERENCES organization_memberships(id),
  membership_type             TEXT NOT NULL DEFAULT 'member',  -- head, deputy, member
  start_date                  TEXT NOT NULL,
  end_date                    TEXT,
  created_by_membership_id    TEXT REFERENCES organization_memberships(id),
  created_at                  TEXT NOT NULL
);
CREATE INDEX idx_department_memberships_dept ON department_memberships (organization_id, department_id, end_date);
CREATE INDEX idx_department_memberships_person ON department_memberships (organization_id, membership_id, end_date);
CREATE UNIQUE INDEX uq_department_memberships_open ON department_memberships (organization_id, department_id, membership_id) WHERE end_date IS NULL;

CREATE TABLE team_memberships (
  id                          TEXT PRIMARY KEY,
  organization_id             TEXT NOT NULL REFERENCES organizations(id),
  team_id                     TEXT NOT NULL REFERENCES teams(id),
  membership_id               TEXT NOT NULL REFERENCES organization_memberships(id),
  membership_type             TEXT NOT NULL DEFAULT 'member',  -- lead, deputy_lead, member
  allocation_pct              INTEGER NOT NULL DEFAULT 100,
  start_date                  TEXT NOT NULL,
  end_date                    TEXT,
  created_by_membership_id    TEXT REFERENCES organization_memberships(id),
  created_at                  TEXT NOT NULL
);
CREATE INDEX idx_team_memberships_team ON team_memberships (organization_id, team_id, end_date);
CREATE INDEX idx_team_memberships_person ON team_memberships (organization_id, membership_id, end_date);
CREATE UNIQUE INDEX uq_team_memberships_open ON team_memberships (organization_id, team_id, membership_id) WHERE end_date IS NULL;

CREATE TABLE reporting_relationships (
  id                          TEXT PRIMARY KEY,
  organization_id             TEXT NOT NULL REFERENCES organizations(id),
  subordinate_membership_id   TEXT NOT NULL REFERENCES organization_memberships(id),
  manager_membership_id       TEXT NOT NULL REFERENCES organization_memberships(id),
  relationship_type           TEXT NOT NULL DEFAULT 'primary', -- primary, secondary, dotted, project
  start_date                  TEXT NOT NULL,
  end_date                    TEXT,
  reason                      TEXT,
  created_by_membership_id    TEXT REFERENCES organization_memberships(id),
  created_at                  TEXT NOT NULL
);
CREATE INDEX idx_reporting_sub ON reporting_relationships (organization_id, subordinate_membership_id, end_date);
CREATE INDEX idx_reporting_mgr ON reporting_relationships (organization_id, manager_membership_id, end_date);
-- one open primary manager per person at a time; changing manager ends the old row first
CREATE UNIQUE INDEX uq_reporting_primary_open ON reporting_relationships (organization_id, subordinate_membership_id) WHERE relationship_type = 'primary' AND end_date IS NULL;
CREATE UNIQUE INDEX uq_reporting_open ON reporting_relationships (organization_id, subordinate_membership_id, manager_membership_id, relationship_type) WHERE end_date IS NULL;
