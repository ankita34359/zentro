-- Stage 2.2: invitations and password-reset tokens. Append-only (docs/database-design.md section 3.1).
-- Only hashes of the secrets are stored: a copy of the database contains no usable link.

-- An invitation is issued for a membership that exists before its person has a login ("invited").
-- organization-owned, so every query goes through the tenant-scoped handle.
CREATE TABLE invitations (
  id                         TEXT PRIMARY KEY,
  organization_id            TEXT NOT NULL REFERENCES organizations(id),
  membership_id              TEXT NOT NULL REFERENCES organization_memberships(id),
  email                      TEXT NOT NULL COLLATE NOCASE,      -- the address the invitation is for
  code_hash                  TEXT NOT NULL UNIQUE,              -- SHA-256 (hex) of the code; the code itself is never stored
  initial_role_id            TEXT REFERENCES roles(id),         -- reserved for 2.3 (role templates); unused in 2.2
  invited_by_membership_id   TEXT NOT NULL REFERENCES organization_memberships(id),
  expires_at                 TEXT NOT NULL,
  accepted_at                TEXT,
  revoked_at                 TEXT,
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL
);
CREATE INDEX idx_invitations_org_created ON invitations (organization_id, created_at);
-- At most one open invitation per address per organization.
CREATE UNIQUE INDEX uq_invitations_open_email ON invitations (organization_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Single-use tokens for password reset (global: a token belongs to a login, not to an organization).
CREATE TABLE auth_tokens (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id),
  purpose             TEXT NOT NULL CHECK (purpose IN ('password_reset', 'email_verify')),
  token_hash          TEXT NOT NULL UNIQUE,                     -- SHA-256 (hex) of the token
  expires_at          TEXT NOT NULL,
  used_at             TEXT,
  revoked_at          TEXT,                                     -- replaced by a newer link
  created_by_user_id  TEXT REFERENCES users(id),
  created_at          TEXT NOT NULL
);
CREATE INDEX idx_auth_tokens_user ON auth_tokens (user_id, purpose);
