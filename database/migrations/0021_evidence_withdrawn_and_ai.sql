-- Batch J (additive): withdrawing evidence, and the AI layer's organization switch and request log.

-- Evidence can be withdrawn by the person who attached it while it is still unverified. Nothing is hard-deleted:
-- the row stays (verification_status becomes 'withdrawn'), is hidden from lists and counts, and who/when is kept here and in the audit log.
ALTER TABLE evidence ADD COLUMN withdrawn_at TEXT;
ALTER TABLE evidence ADD COLUMN withdrawn_by_membership_id TEXT REFERENCES organization_memberships(id);

-- One row per organization once an administrator has touched the switch. No row means AI is OFF (the default).
CREATE TABLE organization_ai_settings (
  organization_id          TEXT PRIMARY KEY REFERENCES organizations(id),
  enabled                  INTEGER NOT NULL DEFAULT 0,
  updated_by_membership_id TEXT REFERENCES organization_memberships(id),
  updated_at               TEXT NOT NULL
);

-- Every AI request, successful or not. It holds the SHAPE of the request (who, when, how long the question was, which records were
-- included, how it ended) and never the question text, the answer, the context sent, or any key.
CREATE TABLE ai_requests (
  id                  TEXT PRIMARY KEY,
  organization_id     TEXT NOT NULL REFERENCES organizations(id),
  membership_id       TEXT NOT NULL REFERENCES organization_memberships(id),
  question_length     INTEGER NOT NULL,
  record_count        INTEGER NOT NULL DEFAULT 0,
  records_json        TEXT NOT NULL DEFAULT '[]',   -- [{type, id}] only
  status              TEXT NOT NULL,                 -- succeeded, failed, blocked
  error_code          TEXT,
  provider            TEXT,
  model               TEXT,
  tokens_in           INTEGER,
  tokens_out          INTEGER,
  duration_ms         INTEGER,
  created_at          TEXT NOT NULL
);
CREATE INDEX idx_ai_requests_org_day ON ai_requests (organization_id, created_at);
CREATE INDEX idx_ai_requests_member_day ON ai_requests (organization_id, membership_id, created_at);
