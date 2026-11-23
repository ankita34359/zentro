-- Stage 5.2: performance periods, scorecards and score runs. A score run is IMMUTABLE: a recalculation with different inputs
-- adds run n+1, and the earlier runs stay forever (that list is the score-change history). Each run stores the exact inputs
-- snapshot and the model it used, so it can be recomputed and verified later. ADDITIVE (new tables only).

CREATE TABLE performance_periods (
  id                          TEXT PRIMARY KEY,
  organization_id             TEXT NOT NULL REFERENCES organizations(id),
  name                        TEXT NOT NULL,
  period_type                 TEXT NOT NULL DEFAULT 'quarter',      -- month, quarter, year, custom
  start_date                  TEXT NOT NULL,
  end_date                    TEXT NOT NULL,                        -- the last day of the period (inclusive)
  status                      TEXT NOT NULL DEFAULT 'open',         -- open, closed, locked
  closed_at                   TEXT,
  closed_by_membership_id     TEXT REFERENCES organization_memberships(id),
  is_demo                     INTEGER NOT NULL DEFAULT 0,
  created_at                  TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_performance_periods_name ON performance_periods (organization_id, name);

CREATE TABLE performance_scorecards (
  id                          TEXT PRIMARY KEY,
  organization_id             TEXT NOT NULL REFERENCES organizations(id),
  subject_type                TEXT NOT NULL DEFAULT 'membership',
  subject_key                 TEXT NOT NULL,                        -- m:<id>
  subject_membership_id       TEXT REFERENCES organization_memberships(id),
  period_id                   TEXT NOT NULL REFERENCES performance_periods(id),
  scoring_model_id            TEXT NOT NULL REFERENCES scoring_models(id),
  status                      TEXT NOT NULL DEFAULT 'open',         -- open, final
  latest_score_id             TEXT,
  is_demo                     INTEGER NOT NULL DEFAULT 0,
  created_at                  TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_performance_scorecards_subject ON performance_scorecards (organization_id, subject_key, period_id);
CREATE INDEX idx_performance_scorecards_period ON performance_scorecards (organization_id, period_id);

CREATE TABLE performance_scores (
  id                          TEXT PRIMARY KEY,
  organization_id             TEXT NOT NULL REFERENCES organizations(id),
  scorecard_id                TEXT NOT NULL REFERENCES performance_scorecards(id),
  run_number                  INTEGER NOT NULL,
  scoring_model_id            TEXT NOT NULL REFERENCES scoring_models(id),
  model_version               INTEGER NOT NULL,
  engine_version              TEXT NOT NULL,
  status                      TEXT NOT NULL,                        -- final, provisional, insufficient
  total_score                 REAL,
  confidence                  REAL NOT NULL,
  weight_coverage             REAL NOT NULL,
  inputs_hash                 TEXT NOT NULL,
  trigger                     TEXT NOT NULL DEFAULT 'manual',       -- scheduled, manual, period_close, recalculation
  explanation_json            TEXT NOT NULL,
  inputs_json                 TEXT NOT NULL,                        -- the exact snapshot the engine read
  model_json                  TEXT NOT NULL,                        -- the model as it was, so verification never depends on later edits
  computed_at                 TEXT NOT NULL,
  computed_by_membership_id   TEXT REFERENCES organization_memberships(id)
);
CREATE UNIQUE INDEX uq_performance_scores_run ON performance_scores (scorecard_id, run_number);
CREATE INDEX idx_performance_scores_org ON performance_scores (organization_id, scorecard_id);

CREATE TABLE performance_score_components (
  id                          TEXT PRIMARY KEY,
  organization_id             TEXT NOT NULL REFERENCES organizations(id),
  score_id                    TEXT NOT NULL REFERENCES performance_scores(id),
  component_key               TEXT NOT NULL,
  label                       TEXT NOT NULL,
  provider_key                TEXT NOT NULL,
  raw_value                   REAL,
  normalized_score            REAL,
  weight                      REAL NOT NULL,
  effective_weight            REAL NOT NULL,
  contribution_points         REAL,
  data_state                  TEXT NOT NULL,                        -- ok, insufficient, missing
  sample_size                 INTEGER NOT NULL DEFAULT 0,
  min_sample                  INTEGER NOT NULL DEFAULT 0,
  coverage                    REAL NOT NULL DEFAULT 0,
  inputs_json                 TEXT NOT NULL DEFAULT '[]',           -- the records that contributed (refs and values)
  notes_json                  TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX idx_performance_score_components_score ON performance_score_components (organization_id, score_id);
