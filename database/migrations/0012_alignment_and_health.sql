-- Stage 3.2: alignment between objectives (a parent/child graph with contribution weights), who works on an objective,
-- and the cached health of each objective. ADDITIVE (new tables and nullable columns only): the previous version keeps
-- running on the upgraded database and a rollback is safe.

ALTER TABLE objectives ADD COLUMN health             TEXT;     -- not_started, on_track, at_risk, delayed, completed, no_data (NULL = not computed yet / cancelled)
ALTER TABLE objectives ADD COLUMN health_reason      TEXT;
ALTER TABLE objectives ADD COLUMN health_computed_at TEXT;

-- "This objective contributes to that one." A child may have one active parent, and a parent must sit at a higher level.
CREATE TABLE objective_relationships (
  id                        TEXT PRIMARY KEY,
  organization_id           TEXT NOT NULL REFERENCES organizations(id),
  parent_objective_id       TEXT NOT NULL REFERENCES objectives(id),
  child_objective_id        TEXT NOT NULL REFERENCES objectives(id),
  relationship_type         TEXT NOT NULL DEFAULT 'contributes_to',
  contribution_weight       REAL NOT NULL DEFAULT 1,
  created_by_membership_id  TEXT NOT NULL REFERENCES organization_memberships(id),
  created_at                TEXT NOT NULL,
  ended_at                  TEXT
);
CREATE INDEX idx_objective_relationships_parent ON objective_relationships (organization_id, parent_objective_id);
CREATE INDEX idx_objective_relationships_child ON objective_relationships (organization_id, child_objective_id);
CREATE UNIQUE INDEX uq_objective_relationships_open ON objective_relationships (parent_objective_id, child_objective_id, relationship_type) WHERE ended_at IS NULL;

-- A person, team or department that works on (or reviews) an objective besides its owner.
CREATE TABLE objective_assignments (
  id                        TEXT PRIMARY KEY,
  organization_id           TEXT NOT NULL REFERENCES organizations(id),
  objective_id              TEXT NOT NULL REFERENCES objectives(id),
  assignee_membership_id    TEXT REFERENCES organization_memberships(id),   -- exactly one of these three
  assignee_team_id          TEXT REFERENCES teams(id),
  assignee_department_id    TEXT REFERENCES departments(id),
  role                      TEXT NOT NULL DEFAULT 'contributor',            -- contributor, reviewer
  start_date                TEXT NOT NULL,
  end_date                  TEXT,
  assigned_by_membership_id TEXT NOT NULL REFERENCES organization_memberships(id),
  created_at                TEXT NOT NULL
);
CREATE INDEX idx_objective_assignments_objective ON objective_assignments (organization_id, objective_id);
