-- Stage 2.4: the audit log and protected roles. Append-only and ADDITIVE (one new column with a default, one new
-- table): the previous version of the app keeps running on the upgraded database, so a rollback stays safe.

-- A role the organization cannot edit or archive (the Owner role: view only, never editable, so an organization can
-- never be left without full control). It is data on the row; code never looks at a role's key or name.
ALTER TABLE roles ADD COLUMN is_protected INTEGER NOT NULL DEFAULT 0;
UPDATE roles SET is_protected = 1 WHERE key = 'owner' AND kind = 'template';

-- Who changed what, when. Append-only: no code path updates or deletes a row (a test greps for it); the only deletion
-- is the whole organization going away with its last member. NO IP addresses (owner decision 2.4; revisit later).
-- before_json / after_json hold only the changed fields and never a secret (links, codes, tokens, passwords).
CREATE TABLE audit_logs (
  id                   TEXT PRIMARY KEY,
  organization_id      TEXT NOT NULL REFERENCES organizations(id),
  actor_user_id        TEXT,                                  -- plain text: the login may be deleted later
  actor_membership_id  TEXT REFERENCES organization_memberships(id),
  actor_type           TEXT NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user', 'system')),
  action               TEXT NOT NULL,                         -- e.g. role.permissions.update
  entity_type          TEXT NOT NULL,
  entity_id            TEXT,
  summary              TEXT NOT NULL,
  before_json          TEXT,
  after_json           TEXT,
  request_id           TEXT,
  created_at           TEXT NOT NULL
);
CREATE INDEX idx_audit_org_created ON audit_logs (organization_id, created_at);
CREATE INDEX idx_audit_org_entity ON audit_logs (organization_id, entity_type, entity_id);
