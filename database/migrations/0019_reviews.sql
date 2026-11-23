-- Stage 5.6: performance reviews. One review per reviewer, person and period. `shared_summary` and `development_focus` are what the
-- person themself may read once the review is submitted; `private_notes` are for the reviewer and people allowed to read private
-- notes, and are NEVER shown to the person reviewed. ADDITIVE (one new table).

CREATE TABLE performance_reviews (
  id                          TEXT PRIMARY KEY,
  organization_id             TEXT NOT NULL REFERENCES organizations(id),
  period_id                   TEXT NOT NULL REFERENCES performance_periods(id),
  subject_membership_id       TEXT NOT NULL REFERENCES organization_memberships(id),
  reviewer_membership_id      TEXT NOT NULL REFERENCES organization_memberships(id),
  status                      TEXT NOT NULL DEFAULT 'draft',        -- draft, submitted, acknowledged
  rating                      INTEGER,                              -- 1 to 5, optional
  shared_summary              TEXT NOT NULL DEFAULT '',
  development_focus           TEXT NOT NULL DEFAULT '',
  private_notes               TEXT NOT NULL DEFAULT '',
  submitted_at                TEXT,
  acknowledged_at             TEXT,
  is_demo                     INTEGER NOT NULL DEFAULT 0,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_performance_reviews ON performance_reviews (organization_id, period_id, subject_membership_id, reviewer_membership_id);
CREATE INDEX idx_performance_reviews_subject ON performance_reviews (organization_id, subject_membership_id, period_id);
