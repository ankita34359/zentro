-- Batch L (additive): viaSocket automations. Outgoing signed webhooks (one destination per organization), their delivery log, and named incoming endpoints.

-- The destination. The address and the signing secret are stored ENCRYPTED (the address of a viaSocket hook can itself be a secret) and are never returned by any API:
-- the page shows only the host. No row means nothing is sent.
CREATE TABLE webhook_settings (
  organization_id          TEXT PRIMARY KEY REFERENCES organizations(id),
  url_enc                  TEXT,
  secret_enc               TEXT,
  enabled                  INTEGER NOT NULL DEFAULT 0,
  events_json              TEXT NOT NULL DEFAULT '{}',   -- {"task.created": true, ...}: only the types switched on are sent
  enabled_since            TEXT,                          -- events that happened before this moment are never sent
  secret_created_at        TEXT,
  updated_by_membership_id TEXT REFERENCES organization_memberships(id),
  updated_at               TEXT NOT NULL
);

-- One row per event per organization (a test event has no event_id). payload_json holds exactly what is sent: ids, names and numbers, never a secret.
CREATE TABLE webhook_deliveries (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations(id),
  event_id         TEXT,
  event_type       TEXT NOT NULL,
  status           TEXT NOT NULL,                  -- pending, delivered, retrying, dead
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TEXT,
  last_attempt_at  TEXT,
  response_code    INTEGER,
  error            TEXT,                           -- a short fixed word (timeout, network, blocked_address, payload_too_large, http_500), never a response body
  payload_json     TEXT NOT NULL,
  is_test          INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  delivered_at     TEXT
);
CREATE UNIQUE INDEX uq_webhook_deliveries_event ON webhook_deliveries (organization_id, event_id) WHERE event_id IS NOT NULL;
CREATE INDEX idx_webhook_deliveries_due ON webhook_deliveries (organization_id, status, next_attempt_at);
CREATE INDEX idx_webhook_deliveries_created ON webhook_deliveries (organization_id, created_at);

-- A named incoming endpoint. Only the SHA-256 of the token is stored (the token itself is shown once, when the endpoint is created); the prefix lets a person tell tokens apart.
CREATE TABLE inbound_endpoints (
  id                        TEXT PRIMARY KEY,
  organization_id           TEXT NOT NULL REFERENCES organizations(id),
  name                      TEXT NOT NULL,
  kind                      TEXT NOT NULL,           -- task, kpi_value
  config_json               TEXT NOT NULL DEFAULT '{}',  -- for kpi_value: {kpiId, subject}
  token_hash                TEXT NOT NULL,
  token_prefix              TEXT NOT NULL,
  created_by_membership_id  TEXT NOT NULL REFERENCES organization_memberships(id),
  created_at                TEXT NOT NULL,
  last_used_at              TEXT,
  call_count                INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_inbound_endpoints_org ON inbound_endpoints (organization_id, created_at);
