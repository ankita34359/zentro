-- Stage 2.8: the demo data framework (Load and Remove demo data, View as a demo person).
-- ADDITIVE (one new table): the previous version keeps running on the upgraded database and a rollback is safe.
-- Demo rows live in the real tables flagged `is_demo = 1` (people, structure, tasks...); this table records each load so the
-- Settings screen can say what is loaded and refuse a second load. Sessions already have `impersonated_by_user_id` (stage 2.1).

CREATE TABLE demo_data_batches (
  id                        TEXT PRIMARY KEY,
  organization_id           TEXT NOT NULL REFERENCES organizations(id),
  created_by_membership_id  TEXT NOT NULL REFERENCES organization_memberships(id),
  status                    TEXT NOT NULL DEFAULT 'loaded',    -- loaded, removed
  counts_json               TEXT NOT NULL DEFAULT '{}',
  created_at                TEXT NOT NULL,
  removed_at                TEXT,
  removed_by_membership_id  TEXT REFERENCES organization_memberships(id)
);
-- at most one batch is loaded at a time in an organization
CREATE UNIQUE INDEX uq_demo_batches_loaded ON demo_data_batches (organization_id) WHERE status = 'loaded';
CREATE INDEX idx_demo_batches_org ON demo_data_batches (organization_id, created_at);
