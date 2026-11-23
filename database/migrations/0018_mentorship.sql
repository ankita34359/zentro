-- Stage 5.5: mentorship. An assignment links a mentor and a mentee over time: it starts on `start_date` and, when it ends, stops
-- applying on `end_date` (half open, like every other effective-dated table). Activities are what the mentor did; progress rows are
-- ratings entered by people (the measured deltas are computed from stored scores and are not stored here). ADDITIVE (new tables only).

CREATE TABLE mentorship_assignments (
  id                          TEXT PRIMARY KEY,
  organization_id             TEXT NOT NULL REFERENCES organizations(id),
  mentor_membership_id        TEXT NOT NULL REFERENCES organization_memberships(id),
  mentee_membership_id        TEXT NOT NULL REFERENCES organization_memberships(id),
  start_date                  TEXT NOT NULL,
  end_date                    TEXT,
  status                      TEXT NOT NULL DEFAULT 'active',       -- active, paused, ended
  goals                       TEXT NOT NULL DEFAULT '',
  cadence_days                INTEGER NOT NULL DEFAULT 14,
  created_by_membership_id    TEXT NOT NULL REFERENCES organization_memberships(id),
  is_demo                     INTEGER NOT NULL DEFAULT 0,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL
);
CREATE INDEX idx_mentorship_assignments_mentor ON mentorship_assignments (organization_id, mentor_membership_id);
CREATE INDEX idx_mentorship_assignments_mentee ON mentorship_assignments (organization_id, mentee_membership_id);

CREATE TABLE mentorship_activities (
  id                          TEXT PRIMARY KEY,
  organization_id             TEXT NOT NULL REFERENCES organizations(id),
  assignment_id               TEXT NOT NULL REFERENCES mentorship_assignments(id),
  activity_type               TEXT NOT NULL,                        -- one_on_one, feedback, review, unblock, training, goal_setting
  occurred_on                 TEXT NOT NULL,                        -- the day it happened
  duration_minutes            INTEGER,
  summary                     TEXT NOT NULL,
  outcome                     TEXT,
  created_by_membership_id    TEXT NOT NULL REFERENCES organization_memberships(id),
  is_demo                     INTEGER NOT NULL DEFAULT 0,
  created_at                  TEXT NOT NULL
);
CREATE INDEX idx_mentorship_activities_assignment ON mentorship_activities (organization_id, assignment_id, occurred_on);

CREATE TABLE mentorship_progress (
  id                          TEXT PRIMARY KEY,
  organization_id             TEXT NOT NULL REFERENCES organizations(id),
  assignment_id               TEXT NOT NULL REFERENCES mentorship_assignments(id),
  period_id                   TEXT NOT NULL REFERENCES performance_periods(id),
  metric_key                  TEXT NOT NULL,                        -- skill_rating
  current_value               REAL NOT NULL,                        -- 1 to 5
  source                      TEXT NOT NULL,                        -- mentor_entered, mentee_entered
  note                        TEXT,
  entered_by_membership_id    TEXT NOT NULL REFERENCES organization_memberships(id),
  is_demo                     INTEGER NOT NULL DEFAULT 0,
  measured_at                 TEXT NOT NULL
);
CREATE INDEX idx_mentorship_progress_assignment ON mentorship_progress (organization_id, assignment_id, period_id);
