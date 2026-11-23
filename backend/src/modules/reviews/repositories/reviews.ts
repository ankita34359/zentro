import type { TenantDb } from "../../../db/tenant.js";

export interface ReviewRow {
  id: string; period_id: string; subject_membership_id: string; reviewer_membership_id: string; status: string; rating: number | null;
  shared_summary: string; development_focus: string; private_notes: string; submitted_at: string | null; acknowledged_at: string | null; is_demo: number; created_at: string; updated_at: string;
}
const COLS = "id, period_id, subject_membership_id, reviewer_membership_id, status, rating, shared_summary, development_focus, private_notes, submitted_at, acknowledged_at, is_demo, created_at, updated_at";

/** Performance reviews for ONE organization. */
export class ReviewRepository {
  constructor(private readonly tdb: TenantDb) {}

  forPeriod(periodId: string): ReviewRow[] {
    return this.tdb.all<ReviewRow>(`SELECT ${COLS} FROM performance_reviews WHERE organization_id = @organization_id AND period_id = @periodId ORDER BY created_at, rowid`, { periodId });
  }
  forSubject(subjectId: string, periodId?: string): ReviewRow[] {
    return this.tdb.all<ReviewRow>(`SELECT ${COLS} FROM performance_reviews WHERE organization_id = @organization_id AND subject_membership_id = @subjectId AND (@periodId IS NULL OR period_id = @periodId) ORDER BY created_at, rowid`, { subjectId, periodId: periodId ?? null });
  }
  review(id: string): ReviewRow | undefined {
    return this.tdb.get<ReviewRow>(`SELECT ${COLS} FROM performance_reviews WHERE organization_id = @organization_id AND id = @id`, { id });
  }
  find(periodId: string, subjectId: string, reviewerId: string): ReviewRow | undefined {
    return this.tdb.get<ReviewRow>(`SELECT ${COLS} FROM performance_reviews WHERE organization_id = @organization_id AND period_id = @periodId AND subject_membership_id = @subjectId AND reviewer_membership_id = @reviewerId`, { periodId, subjectId, reviewerId });
  }
  insert(r: { id: string; periodId: string; subjectId: string; reviewerId: string; rating: number | null; sharedSummary: string; developmentFocus: string; privateNotes: string; isDemo?: boolean; submittedAt?: string | null; now: string }): void {
    this.tdb.run(
      "INSERT INTO performance_reviews (id, organization_id, period_id, subject_membership_id, reviewer_membership_id, status, rating, shared_summary, development_focus, private_notes, submitted_at, is_demo, created_at, updated_at) VALUES (@id, @organization_id, @periodId, @subjectId, @reviewerId, @status, @rating, @sharedSummary, @developmentFocus, @privateNotes, @submittedAt, @isDemo, @now, @now)",
      { ...r, status: r.submittedAt ? "submitted" : "draft", submittedAt: r.submittedAt ?? null, isDemo: r.isDemo ? 1 : 0 },
    );
  }
  update(r: { id: string; rating: number | null; sharedSummary: string; developmentFocus: string; privateNotes: string; status: string; submittedAt: string | null; now: string }): void {
    this.tdb.run("UPDATE performance_reviews SET rating = @rating, shared_summary = @sharedSummary, development_focus = @developmentFocus, private_notes = @privateNotes, status = @status, submitted_at = @submittedAt, updated_at = @now WHERE organization_id = @organization_id AND id = @id", r);
  }
  acknowledge(id: string, now: string): void {
    this.tdb.run("UPDATE performance_reviews SET status = 'acknowledged', acknowledged_at = @now, updated_at = @now WHERE organization_id = @organization_id AND id = @id", { id, now });
  }
}
