-- Stage 5.4: saved peer comparisons. A saved comparison is a SNAPSHOT: it stores the cohort that was compared and the results as they
-- were, so it does not change when scores are recalculated. ADDITIVE (one new table).

CREATE TABLE performance_comparisons (
  id                          TEXT PRIMARY KEY,
  organization_id             TEXT NOT NULL REFERENCES organizations(id),
  name                        TEXT NOT NULL,
  comparison_type             TEXT NOT NULL DEFAULT 'peer',
  period_id                   TEXT NOT NULL REFERENCES performance_periods(id),
  cohort_json                 TEXT NOT NULL,                        -- role family, department, listed people, minimum tenure
  normalization_method        TEXT NOT NULL,                        -- raw, percentile, percentile_z
  cohort_size                 INTEGER NOT NULL,
  results_json                TEXT NOT NULL,
  created_by_membership_id    TEXT NOT NULL REFERENCES organization_memberships(id),
  created_at                  TEXT NOT NULL
);
CREATE INDEX idx_performance_comparisons_org ON performance_comparisons (organization_id, period_id, created_at);
