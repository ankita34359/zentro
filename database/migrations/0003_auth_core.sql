-- Stage 2.1: auth core. Append-only; later stages ALTER these tables, they never edit this file.
-- Shapes follow docs/database-design.md section 3.1. Only the columns this stage needs exist; later stages add
-- the rest with ALTER TABLE ADD COLUMN (2.3 adds the permission catalog, 2.6 the employee fields).

-- A login. Global (not owned by one organization). email is unique ignoring case.
CREATE TABLE users (
  id                      TEXT PRIMARY KEY,
  email                   TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash           TEXT,                       -- scrypt$N$r$p$salt$hash; NULL for demo personas
  name                    TEXT NOT NULL,
  email_verified_at       TEXT,
  status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  is_platform_admin       INTEGER NOT NULL DEFAULT 0, -- reserved; grants nothing in tenant data
  default_organization_id TEXT REFERENCES organizations(id), -- the organization a new session opens in
  last_login_at           TEXT,
  is_demo                 INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);

-- The tenant. Global (it is the tenant itself).
CREATE TABLE organizations (
  id                       TEXT PRIMARY KEY,
  name                     TEXT NOT NULL,
  slug                     TEXT NOT NULL UNIQUE,
  timezone                 TEXT NOT NULL DEFAULT 'UTC',
  fiscal_year_start_month  INTEGER NOT NULL DEFAULT 1,
  status                   TEXT NOT NULL DEFAULT 'active',
  created_by_user_id       TEXT NOT NULL REFERENCES users(id),
  archived_at              TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);

-- A person inside one organization. user_id is nullable so a person can exist before they have a login.
CREATE TABLE organization_memberships (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations(id),
  user_id          TEXT REFERENCES users(id),
  display_name     TEXT NOT NULL,
  work_email       TEXT,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended', 'left')),
  archived_at      TEXT,
  is_demo          INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_membership_org_user ON organization_memberships (organization_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_membership_user ON organization_memberships (user_id);

-- Roles are data (docs/permission-model.md). 2.1 seeds only the Owner role per organization; 2.3 adds the
-- permission catalog, the other templates and the Owner's permission rows.
CREATE TABLE roles (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations(id),
  key              TEXT NOT NULL,
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  kind             TEXT NOT NULL DEFAULT 'template' CHECK (kind IN ('template', 'custom')),
  archived_at      TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_roles_org_key ON roles (organization_id, key);

CREATE TABLE user_role_assignments (
  id                         TEXT PRIMARY KEY,
  organization_id            TEXT NOT NULL REFERENCES organizations(id),
  membership_id              TEXT NOT NULL REFERENCES organization_memberships(id),
  role_id                    TEXT NOT NULL REFERENCES roles(id),
  scope_type                 TEXT NOT NULL CHECK (scope_type IN ('organization', 'department', 'team', 'self')),
  scope_id                   TEXT,
  valid_from                 TEXT NOT NULL,
  valid_to                   TEXT,
  granted_by_membership_id   TEXT REFERENCES organization_memberships(id),
  revoked_at                 TEXT,
  created_at                 TEXT NOT NULL
);
CREATE INDEX idx_assignments_membership ON user_role_assignments (organization_id, membership_id);

-- One row per sign-in. The row id is the SHA-256 of the random session id inside the cookie's JWT, so a copy of the
-- database does not contain anything that can be replayed as a cookie. Global; checked on every request.
CREATE TABLE sessions (
  id                      TEXT PRIMARY KEY,
  user_id                 TEXT NOT NULL REFERENCES users(id),
  active_organization_id  TEXT REFERENCES organizations(id),
  created_at              TEXT NOT NULL,
  last_seen_at            TEXT NOT NULL,
  expires_at              TEXT NOT NULL,           -- sliding (7 days from last activity)
  absolute_expires_at     TEXT NOT NULL,           -- hard stop (30 days from sign-in)
  impersonated_by_user_id TEXT REFERENCES users(id),
  revoked_at              TEXT
);
CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expiry ON sessions (absolute_expires_at);
