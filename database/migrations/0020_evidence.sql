-- Stage 4.3: evidence. A piece of evidence is a link and/or a small file with a title, who it is about, how confidential it is and
-- whether someone has verified it. It points at the records it supports (a task, an objective, a key result, a KPI value) through
-- evidence_links (checked in the application: the target is polymorphic). Files are capped and stored here, served only by an
-- authenticated route. ADDITIVE (new tables only).

CREATE TABLE evidence (
  id                          TEXT PRIMARY KEY,
  organization_id             TEXT NOT NULL REFERENCES organizations(id),
  evidence_type               TEXT NOT NULL,
  title                       TEXT NOT NULL,
  description                 TEXT NOT NULL DEFAULT '',
  source                      TEXT NOT NULL DEFAULT 'manual',        -- manual, upload, demo
  external_ref                TEXT,                                  -- a link
  related_membership_id       TEXT REFERENCES organization_memberships(id),
  occurred_on                 TEXT NOT NULL,
  submitted_by_membership_id  TEXT NOT NULL REFERENCES organization_memberships(id),
  verification_status         TEXT NOT NULL DEFAULT 'unverified',    -- unverified, verified, rejected, needs_info
  verified_by_membership_id   TEXT REFERENCES organization_memberships(id),
  verified_at                 TEXT,
  verification_note           TEXT,
  confidentiality             TEXT NOT NULL DEFAULT 'scope',         -- organization, scope, restricted
  is_demo                     INTEGER NOT NULL DEFAULT 0,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL
);
CREATE INDEX idx_evidence_org ON evidence (organization_id, created_at);

CREATE TABLE evidence_files (
  id                          TEXT PRIMARY KEY,
  organization_id             TEXT NOT NULL REFERENCES organizations(id),
  evidence_id                 TEXT NOT NULL REFERENCES evidence(id),
  filename                    TEXT NOT NULL,
  content_type                TEXT NOT NULL,
  size_bytes                  INTEGER NOT NULL,
  sha256                      TEXT NOT NULL,
  data                        BLOB NOT NULL,
  created_at                  TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_evidence_files_evidence ON evidence_files (organization_id, evidence_id);

CREATE TABLE evidence_links (
  id                          TEXT PRIMARY KEY,
  organization_id             TEXT NOT NULL REFERENCES organizations(id),
  evidence_id                 TEXT NOT NULL REFERENCES evidence(id),
  target_type                 TEXT NOT NULL,                         -- task, objective, key_result, kpi_measurement
  target_id                   TEXT NOT NULL,
  created_at                  TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_evidence_links ON evidence_links (organization_id, evidence_id, target_type, target_id);
CREATE INDEX idx_evidence_links_target ON evidence_links (organization_id, target_type, target_id);
