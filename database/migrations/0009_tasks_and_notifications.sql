-- Stages 4.1, 4.4 and 4.5: tasks, the daily update, in-app notifications and the event log task changes write.
-- ADDITIVE (new tables only): the previous version keeps running on the upgraded database and a rollback is safe.
-- Dates in this file are whole days (YYYY-MM-DD) in the organization's time zone; times are UTC ISO timestamps.
-- Objective, key result and KPI links on tasks arrive with stages 3.1 and 4.2 as nullable columns added to `tasks`.

CREATE TABLE tasks (
  id                        TEXT PRIMARY KEY,
  organization_id           TEXT NOT NULL REFERENCES organizations(id),
  title                     TEXT NOT NULL,
  description               TEXT NOT NULL DEFAULT '',
  status                    TEXT NOT NULL DEFAULT 'not_started',   -- not_started, in_progress, blocked, under_review, completed, cancelled (checked in code: the list may grow)
  priority                  TEXT NOT NULL DEFAULT 'medium',        -- low, medium, high, critical
  importance_weight         INTEGER NOT NULL DEFAULT 3,            -- 1 to 5, business importance
  progress_pct              INTEGER NOT NULL DEFAULT 0,
  start_date                TEXT,
  due_at                    TEXT,                                  -- a day; NULL = no due date
  estimated_minutes         INTEGER,
  actual_minutes            INTEGER NOT NULL DEFAULT 0,            -- the sum of logged time
  completed_at              TEXT,
  blocked_reason            TEXT,
  team_id                   TEXT REFERENCES teams(id),
  parent_task_id            TEXT REFERENCES tasks(id),
  created_by_membership_id  TEXT NOT NULL REFERENCES organization_memberships(id),
  archived_at               TEXT,
  is_demo                   INTEGER NOT NULL DEFAULT 0,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);
CREATE INDEX idx_tasks_org_status_due ON tasks (organization_id, status, due_at);
CREATE INDEX idx_tasks_org_creator ON tasks (organization_id, created_by_membership_id);

CREATE TABLE task_assignments (
  id                          TEXT PRIMARY KEY,
  organization_id             TEXT NOT NULL REFERENCES organizations(id),
  task_id                     TEXT NOT NULL REFERENCES tasks(id),
  assignee_membership_id      TEXT REFERENCES organization_memberships(id),   -- exactly one of these two
  assignee_team_id            TEXT REFERENCES teams(id),
  role                        TEXT NOT NULL DEFAULT 'assignee',               -- assignee, reviewer, watcher
  assigned_at                 TEXT NOT NULL,
  assigned_by_membership_id   TEXT NOT NULL REFERENCES organization_memberships(id),
  unassigned_at               TEXT
);
CREATE INDEX idx_task_assignments_task ON task_assignments (organization_id, task_id);
CREATE INDEX idx_task_assignments_person ON task_assignments (organization_id, assignee_membership_id, unassigned_at);
CREATE INDEX idx_task_assignments_team ON task_assignments (organization_id, assignee_team_id, unassigned_at);

-- Append-only history of what happened to a task.
CREATE TABLE task_updates (
  id                    TEXT PRIMARY KEY,
  organization_id       TEXT NOT NULL REFERENCES organizations(id),
  task_id               TEXT NOT NULL REFERENCES tasks(id),
  author_membership_id  TEXT NOT NULL REFERENCES organization_memberships(id),
  update_type           TEXT NOT NULL,                                -- status_change, progress, time_log, blocker
  from_status           TEXT,
  to_status             TEXT,
  progress_pct          INTEGER,
  minutes_logged        INTEGER,
  body                  TEXT,
  created_at            TEXT NOT NULL
);
CREATE INDEX idx_task_updates_task ON task_updates (organization_id, task_id, created_at);

CREATE TABLE task_comments (
  id                    TEXT PRIMARY KEY,
  organization_id       TEXT NOT NULL REFERENCES organizations(id),
  task_id               TEXT NOT NULL REFERENCES tasks(id),
  author_membership_id  TEXT NOT NULL REFERENCES organization_memberships(id),
  body                  TEXT NOT NULL,
  edited_at             TEXT,
  deleted_at            TEXT,
  created_at            TEXT NOT NULL
);
CREATE INDEX idx_task_comments_task ON task_comments (organization_id, task_id, created_at);

-- One short update per person per day.
CREATE TABLE daily_updates (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL REFERENCES organizations(id),
  membership_id     TEXT NOT NULL REFERENCES organization_memberships(id),
  update_date       TEXT NOT NULL,
  summary           TEXT NOT NULL,
  blockers          TEXT,
  submitted_at      TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_daily_updates_person_day ON daily_updates (organization_id, membership_id, update_date);

CREATE TABLE notifications (
  id                      TEXT PRIMARY KEY,
  organization_id         TEXT NOT NULL REFERENCES organizations(id),
  recipient_membership_id TEXT NOT NULL REFERENCES organization_memberships(id),
  type                    TEXT NOT NULL,
  title                   TEXT NOT NULL,
  body                    TEXT,
  severity                TEXT NOT NULL DEFAULT 'info',               -- info, warning, critical
  entity_type             TEXT,
  entity_id               TEXT,
  data_json               TEXT,
  dedupe_key              TEXT,
  read_at                 TEXT,
  dismissed_at            TEXT,
  created_at              TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_notifications_dedupe ON notifications (organization_id, recipient_membership_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX idx_notifications_inbox ON notifications (organization_id, recipient_membership_id, read_at, created_at);

-- A missing row means "on". Only in-app delivery exists until the integrations stages add channels.
CREATE TABLE notification_preferences (
  organization_id   TEXT NOT NULL REFERENCES organizations(id),
  membership_id     TEXT NOT NULL REFERENCES organization_memberships(id),
  type              TEXT NOT NULL,
  in_app            INTEGER NOT NULL DEFAULT 1,
  updated_at        TEXT NOT NULL,
  PRIMARY KEY (organization_id, membership_id, type)
);

-- What happened, in business terms, written in the SAME transaction as the change. Nothing reads it yet: the outbox and
-- the integrations (stage 8) will. The unique dedupe key means a producer cannot enqueue the same event twice.
CREATE TABLE automation_events (
  id                    TEXT PRIMARY KEY,
  organization_id       TEXT NOT NULL REFERENCES organizations(id),
  event_type            TEXT NOT NULL,
  entity_type           TEXT NOT NULL,
  entity_id             TEXT NOT NULL,
  actor_membership_id   TEXT REFERENCES organization_memberships(id),
  payload_json          TEXT NOT NULL,
  schema_version        INTEGER NOT NULL DEFAULT 1,
  dedupe_key            TEXT NOT NULL,
  occurred_at           TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_automation_events_dedupe ON automation_events (organization_id, dedupe_key);
CREATE INDEX idx_automation_events_type ON automation_events (organization_id, event_type, occurred_at);
