-- Stage 5.1: scoring models. A model is a list of components (provider, weight, minimum sample, settings): DATA, edited under
-- Settings → Scoring. Editing creates version n+1 (a draft until activated); an older version stays, retired, because every score
-- records the version it used. ADDITIVE (new tables only).

CREATE TABLE scoring_models (
  id                        TEXT PRIMARY KEY,
  organization_id           TEXT NOT NULL REFERENCES organizations(id),
  name                      TEXT NOT NULL,
  template_key              TEXT,                                  -- which role template it started from (employee, ceo, ...), for display
  version                   INTEGER NOT NULL DEFAULT 1,
  status                    TEXT NOT NULL DEFAULT 'draft',         -- draft, active, retired
  subject_type              TEXT NOT NULL DEFAULT 'membership',
  role_family_id            TEXT REFERENCES role_families(id),     -- applies to people whose designation belongs to this family (as of the period end)
  designation_id            TEXT REFERENCES designations(id),      -- or to this designation (the most specific wins)
  is_default                INTEGER NOT NULL DEFAULT 0,            -- the model used when nothing more specific applies
  min_weight_coverage       REAL NOT NULL DEFAULT 0.6,
  min_confidence_for_final  REAL NOT NULL DEFAULT 0.6,
  config_json               TEXT NOT NULL DEFAULT '{}',            -- bands
  supersedes_model_id       TEXT REFERENCES scoring_models(id),
  created_by_membership_id  TEXT NOT NULL REFERENCES organization_memberships(id),
  is_demo                   INTEGER NOT NULL DEFAULT 0,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_scoring_models_name_version ON scoring_models (organization_id, name, version);
CREATE INDEX idx_scoring_models_org ON scoring_models (organization_id, status);

CREATE TABLE scoring_model_components (
  id                  TEXT PRIMARY KEY,
  organization_id     TEXT NOT NULL REFERENCES organizations(id),
  scoring_model_id    TEXT NOT NULL REFERENCES scoring_models(id),
  component_key       TEXT NOT NULL,
  label               TEXT NOT NULL,
  weight              REAL NOT NULL,
  provider_key        TEXT NOT NULL,
  min_sample          INTEGER NOT NULL DEFAULT 1,
  config_json         TEXT NOT NULL DEFAULT '{}',
  sort_order          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_scoring_model_components_model ON scoring_model_components (organization_id, scoring_model_id);
