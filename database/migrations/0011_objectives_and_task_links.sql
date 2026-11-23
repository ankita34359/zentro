-- Stages 3.1 and 4.2: objectives and key results (with their append-only progress history), and what tasks gain from them:
-- links to an objective or key result, dependencies between tasks, a recorded outcome and a reviewer's quality rating.
-- ADDITIVE (new tables and nullable columns only): the previous version keeps running on the upgraded database and a
-- rollback is safe. Nothing here is ever deleted by the application; objectives and key results are archived.

CREATE TABLE objectives (
  id                        TEXT PRIMARY KEY,
  organization_id           TEXT NOT NULL REFERENCES organizations(id),
  level                     TEXT NOT NULL,                       -- company, department, team, individual (checked in code: the list may grow)
  department_id             TEXT REFERENCES departments(id),     -- department level (and the department a team objective sits in)
  team_id                   TEXT REFERENCES teams(id),           -- team level
  owner_membership_id       TEXT REFERENCES organization_memberships(id),
  title                     TEXT NOT NULL,
  description               TEXT NOT NULL DEFAULT '',
  objective_type            TEXT NOT NULL DEFAULT 'operational', -- strategic, operational, development
  start_date                TEXT NOT NULL,                       -- whole days
  end_date                  TEXT NOT NULL,
  priority                  TEXT NOT NULL DEFAULT 'medium',
  lifecycle                 TEXT NOT NULL DEFAULT 'active',      -- draft, active, completed, cancelled
  visibility                TEXT NOT NULL DEFAULT 'scope',       -- scope, organization (published)
  published_at              TEXT,
  weight                    REAL NOT NULL DEFAULT 1,
  created_by_membership_id  TEXT NOT NULL REFERENCES organization_memberships(id),
  archived_at               TEXT,
  is_demo                   INTEGER NOT NULL DEFAULT 0,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);
CREATE INDEX idx_objectives_org ON objectives (organization_id, level, lifecycle);
CREATE INDEX idx_objectives_owner ON objectives (organization_id, owner_membership_id);

CREATE TABLE key_results (
  id                        TEXT PRIMARY KEY,
  organization_id           TEXT NOT NULL REFERENCES organizations(id),
  objective_id              TEXT NOT NULL REFERENCES objectives(id),
  title                     TEXT NOT NULL,
  description               TEXT NOT NULL DEFAULT '',
  measurement_type          TEXT NOT NULL DEFAULT 'number',      -- percentage, number, currency, count, boolean, custom
  unit                      TEXT,
  direction                 TEXT NOT NULL DEFAULT 'increase',    -- increase, decrease
  progress_method           TEXT NOT NULL DEFAULT 'linear',      -- linear, binary (yes or no), manual (a recorded percentage)
  start_value               REAL NOT NULL DEFAULT 0,
  target_value              REAL NOT NULL,
  current_value             REAL,                                -- NULL = nothing recorded yet (not zero)
  current_as_of             TEXT,
  weight                    REAL NOT NULL DEFAULT 1,
  owner_membership_id       TEXT REFERENCES organization_memberships(id),
  due_date                  TEXT,
  archived_at               TEXT,
  is_demo                   INTEGER NOT NULL DEFAULT 0,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);
CREATE INDEX idx_key_results_objective ON key_results (organization_id, objective_id);

-- Append only. The latest row of a key result is its current value; a correction is a new row that names the one it replaces.
CREATE TABLE objective_progress_history (
  id                        TEXT PRIMARY KEY,
  organization_id           TEXT NOT NULL REFERENCES organizations(id),
  objective_id              TEXT NOT NULL REFERENCES objectives(id),
  key_result_id             TEXT REFERENCES key_results(id),
  recorded_at               TEXT NOT NULL,
  value                     REAL,
  attainment                REAL,                                -- 0 to 1 at the time, or NULL
  source                    TEXT NOT NULL DEFAULT 'manual',      -- manual, task_outcome, target_change, demo
  note                      TEXT,
  recorded_by_membership_id TEXT REFERENCES organization_memberships(id),
  supersedes_id             TEXT REFERENCES objective_progress_history(id)
);
CREATE INDEX idx_progress_history_kr ON objective_progress_history (organization_id, key_result_id, recorded_at);
CREATE INDEX idx_progress_history_objective ON objective_progress_history (organization_id, objective_id, recorded_at);

-- Tasks: alignment, outcome and review.
ALTER TABLE tasks ADD COLUMN objective_id          TEXT REFERENCES objectives(id);
ALTER TABLE tasks ADD COLUMN key_result_id         TEXT REFERENCES key_results(id);
ALTER TABLE tasks ADD COLUMN outcome_summary       TEXT;
ALTER TABLE tasks ADD COLUMN outcome_value         REAL;
ALTER TABLE tasks ADD COLUMN outcome_quality       INTEGER;        -- 1 to 5, set by a reviewer
ALTER TABLE tasks ADD COLUMN outcome_reviewed_at   TEXT;
ALTER TABLE tasks ADD COLUMN outcome_reviewed_by   TEXT REFERENCES organization_memberships(id);
CREATE INDEX idx_tasks_objective ON tasks (organization_id, objective_id);
CREATE INDEX idx_tasks_key_result ON tasks (organization_id, key_result_id);

-- "Task A cannot finish before task B": the service refuses a loop.
CREATE TABLE task_dependencies (
  organization_id           TEXT NOT NULL REFERENCES organizations(id),
  task_id                   TEXT NOT NULL REFERENCES tasks(id),
  depends_on_task_id        TEXT NOT NULL REFERENCES tasks(id),
  created_by_membership_id  TEXT NOT NULL REFERENCES organization_memberships(id),
  created_at                TEXT NOT NULL,
  PRIMARY KEY (task_id, depends_on_task_id)
);
CREATE INDEX idx_task_dependencies_on ON task_dependencies (organization_id, depends_on_task_id);
