import type { TenantCtx } from "../../db/tenant.js";
import { HttpError, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import type { AuditService } from "../audit/service.js";
import type { AuthStore } from "../auth/repositories/store.js";
import type { AuthContext, AuthService } from "../auth/service.js";
import type { Capabilities } from "../permissions/service.js";
import type { ReviewRow } from "./repositories/reviews.js";

export interface ReviewView {
  id: string;
  period: { id: string; name: string };
  subject: { id: string; name: string };
  reviewer: { id: string; name: string };
  status: "draft" | "submitted" | "acknowledged";
  rating: number | null;
  sharedSummary: string;
  developmentFocus: string;
  /** Present ONLY for the reviewer and people allowed to read private notes. It is never sent to the person reviewed. */
  privateNotes?: string;
  submittedAt: string | null;
  acknowledgedAt: string | null;
  can: { edit: boolean; acknowledge: boolean };
}
export interface ReviewInput { rating?: number | null; sharedSummary?: string; developmentFocus?: string; privateNotes?: string; submit?: boolean }

/**
 * Performance reviews (stage 5.6). A review has a part the person may read (summary, development focus) once it is submitted, and
 * private notes that only the reviewer and people with `reviews.read_private` over the person can read: the person reviewed never
 * receives the field at all. Nothing written in a review is copied into the audit log, only that it was written.
 */
export class ReviewService {
  constructor(private readonly o: { store: AuthStore; auth: AuthService; audit: AuditService }) {}

  private ctx(auth: AuthContext, requestId: string): TenantCtx {
    return this.o.auth.tenantCtx(auth, requestId);
  }
  private now = (): string => this.o.auth.iso();
  private world(ctx: TenantCtx) {
    const tdb = this.o.store.tenant(ctx);
    const people = this.o.store.people(tdb);
    return { tdb, repo: this.o.store.reviews(tdb), cards: this.o.store.scorecards(tdb), names: new Map(people.people().map((p) => [p.id, p])) };
  }
  private nm(w: ReturnType<ReviewService["world"]>, id: string): string {
    return w.names.get(id)?.display_name ?? "Former member";
  }
  private inScope(caps: Capabilities, key: string, subject: string): boolean {
    const s = caps.scope(key);
    return s.all || s.members.has(subject);
  }

  /** What the caller may read of one review, or null when none of it. */
  private view(w: ReturnType<ReviewService["world"]>, caps: Capabilities, me: string, r: ReviewRow, periodName: string): ReviewView | null {
    const isAuthor = r.reviewer_membership_id === me;
    const isSubject = r.subject_membership_id === me;
    const submitted = r.status !== "draft";
    let shared = false;
    let priv = false;
    if (isAuthor) {
      shared = true;
      priv = true;
    } else if (isSubject) shared = submitted;
    else if (submitted && this.inScope(caps, "reviews.read_shared", r.subject_membership_id)) {
      shared = true;
      priv = this.inScope(caps, "reviews.read_private", r.subject_membership_id);
    }
    if (!shared) return null;
    const v: ReviewView = {
      id: r.id, period: { id: r.period_id, name: periodName }, subject: { id: r.subject_membership_id, name: this.nm(w, r.subject_membership_id) }, reviewer: { id: r.reviewer_membership_id, name: this.nm(w, r.reviewer_membership_id) },
      status: r.status as ReviewView["status"], rating: r.rating, sharedSummary: r.shared_summary, developmentFocus: r.development_focus, submittedAt: r.submitted_at, acknowledgedAt: r.acknowledged_at,
      can: { edit: isAuthor && r.status !== "acknowledged", acknowledge: isSubject && r.status === "submitted" },
    };
    if (priv) v.privateNotes = r.private_notes;
    return v;
  }

  list(auth: AuthContext, requestId: string, caps: Capabilities, q: { periodId: string; subjectId?: string }): ReviewView[] {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const period = w.cards.period(q.periodId);
    if (!period) throw notFound();
    return (q.subjectId ? w.repo.forSubject(q.subjectId, period.id) : w.repo.forPeriod(period.id))
      .map((r) => this.view(w, caps, ctx.membershipId, r, period.name))
      .filter((v): v is ReviewView => v !== null);
  }

  private clean(input: ReviewInput, base?: ReviewRow) {
    const rating = input.rating === undefined ? base?.rating ?? null : input.rating;
    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw new HttpError(400, "invalid_value", "A rating is a whole number from 1 to 5.");
    const sharedSummary = (input.sharedSummary ?? base?.shared_summary ?? "").trim();
    const developmentFocus = (input.developmentFocus ?? base?.development_focus ?? "").trim();
    const privateNotes = (input.privateNotes ?? base?.private_notes ?? "").trim();
    if (sharedSummary.length > 4000 || developmentFocus.length > 2000 || privateNotes.length > 4000) throw new HttpError(400, "invalid_text", "That is too long: the summary and the private notes take up to 4000 characters, the development focus 2000.");
    return { rating, sharedSummary, developmentFocus, privateNotes };
  }

  create(auth: AuthContext, requestId: string, caps: Capabilities, input: ReviewInput & { periodId: string; subjectId: string }): ReviewView {
    if (!caps.has("reviews.write")) throw new HttpError(403, "permission_denied", "You cannot write reviews.");
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const period = w.cards.period(input.periodId);
    const subject = w.names.get(input.subjectId);
    if (!period || !subject) throw notFound();
    if (!this.inScope(caps, "reviews.write", input.subjectId)) throw new HttpError(403, "outside_scope", "You can only review people inside your scope.");
    if (input.subjectId === ctx.membershipId) throw new HttpError(400, "self_review", "You cannot review yourself.");
    if (w.repo.find(period.id, input.subjectId, ctx.membershipId)) throw new HttpError(409, "exists", `You already started a review of ${subject.display_name} for ${period.name}. Edit it instead.`);
    const c = this.clean(input);
    if (input.submit && c.sharedSummary === "") throw new HttpError(400, "summary_required", "Write the summary the person will read before submitting.");
    const id = newId();
    const now = this.now();
    this.o.store.transaction(() => {
      w.repo.insert({ id, periodId: period.id, subjectId: input.subjectId, reviewerId: ctx.membershipId, ...c, submittedAt: input.submit ? now : null, now });
      this.o.audit.record(w.tdb, ctx, { action: input.submit ? "review.submit" : "review.create", entityType: "performance_review", entityId: id, summary: `${input.submit ? "Submitted" : "Started"} a review of ${subject.display_name} for "${period.name}"`, after: { status: input.submit ? "submitted" : "draft", rating: c.rating, hasPrivateNotes: c.privateNotes !== "" } });
    });
    return this.view(w, caps, ctx.membershipId, w.repo.review(id)!, period.name)!;
  }

  update(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: ReviewInput): ReviewView {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const r = w.repo.review(id);
    const period = r ? w.cards.period(r.period_id) : undefined;
    if (!r || !period || r.reviewer_membership_id !== ctx.membershipId) throw notFound(); // only the author may open it for editing
    if (!caps.has("reviews.write")) throw new HttpError(403, "permission_denied", "You cannot write reviews.");
    if (r.status === "acknowledged") throw new HttpError(409, "acknowledged", "The person has acknowledged this review, so it can no longer be changed.");
    const c = this.clean(input, r);
    const submitting = input.submit === true && r.status === "draft";
    if (submitting && c.sharedSummary === "") throw new HttpError(400, "summary_required", "Write the summary the person will read before submitting.");
    const now = this.now();
    this.o.store.transaction(() => {
      w.repo.update({ id, ...c, status: submitting ? "submitted" : r.status, submittedAt: submitting ? now : r.submitted_at, now });
      this.o.audit.record(w.tdb, ctx, { action: submitting ? "review.submit" : "review.update", entityType: "performance_review", entityId: id, summary: `${submitting ? "Submitted" : "Changed"} the review of ${this.nm(w, r.subject_membership_id)} for "${period.name}"`, before: { status: r.status, rating: r.rating }, after: { status: submitting ? "submitted" : r.status, rating: c.rating, hasPrivateNotes: c.privateNotes !== "" } });
    });
    return this.view(w, caps, ctx.membershipId, w.repo.review(id)!, period.name)!;
  }

  acknowledge(auth: AuthContext, requestId: string, caps: Capabilities, id: string): ReviewView {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const r = w.repo.review(id);
    const period = r ? w.cards.period(r.period_id) : undefined;
    if (!r || !period || r.subject_membership_id !== ctx.membershipId || r.status === "draft") throw notFound();
    if (r.status === "acknowledged") throw new HttpError(409, "already_acknowledged", "You already acknowledged this review.");
    this.o.store.transaction(() => {
      w.repo.acknowledge(id, this.now());
      this.o.audit.record(w.tdb, ctx, { action: "review.acknowledge", entityType: "performance_review", entityId: id, summary: `Acknowledged the review for "${period.name}" written by ${this.nm(w, r.reviewer_membership_id)}`, before: { status: "submitted" }, after: { status: "acknowledged" } });
    });
    return this.view(w, caps, ctx.membershipId, w.repo.review(id)!, period.name)!;
  }
}
