import type { TenantCtx } from "../../db/tenant.js";
import { HttpError, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import type { AuditService } from "../audit/service.js";
import type { AuthStore } from "../auth/repositories/store.js";
import type { AuthContext, AuthService } from "../auth/service.js";
import type { Capabilities } from "../permissions/service.js";
import { Collector } from "../scoring/collector.js";
import { DEFAULT_MENTORSHIP, activityProvider, developmentProvider, durationFactor, improvementIndex } from "../scoring/engine/providers/mentorship.js";
import { scoreAccess } from "../scoring/performance.js";
import { todayIn } from "../tasks/dates.js";
import type { AssignmentRow } from "./repositories/mentorship.js";

export const ACTIVITY_TYPES = ["one_on_one", "feedback", "review", "unblock", "training", "goal_setting"] as const;
const isDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export interface AssignmentView {
  id: string;
  mentor: { id: string; name: string };
  mentee: { id: string; name: string };
  startDate: string;
  endDate: string | null;
  status: "active" | "paused" | "ended";
  goals: string;
  cadenceDays: number;
  activityCount: number;
  lastActivityOn: string | null;
  isDemo: boolean;
  can: { manage: boolean; log: boolean };
}
export interface ActivityView { id: string; type: string; occurredOn: string; durationMinutes: number | null; summary: string; outcome: string | null; by: { id: string; name: string } }
export interface MenteeFactors {
  assignmentId: string;
  mentee: { id: string; name: string };
  overlapDays: number;
  durationFactor: number;
  mentorCount: number;
  creditShare: number;
  improvementIndex: number | null;
  /** Raw changes and scores: only for people who may see the mentee's score. */
  detail: { baselineScore: number | null; currentScore: number | null; scoreDelta: number | null; deliveryDelta: number | null; qualityDelta: number | null; goalAchievement: number | null } | null;
  activities: number;
  expectedActivities: number;
  cadenceDays: number;
}
export interface Effectiveness {
  mentor: { id: string; name: string };
  development: { value: number | null; state: string; sampleSize: number; notes: string[] };
  activity: { value: number | null; state: string; sampleSize: number; notes: string[] };
  menteeCount: number;
  averageDays: number | null;
  mentees: MenteeFactors[];
}
export interface EffectivenessResult { period: { id: string; name: string; status: string }; settings: { minDays: number; k: number }; mentors: Effectiveness[]; caveats: string[] }

/**
 * Mentorship (stage 5.5): who mentors whom and since when, what they did together, and how the mentees changed. A mentor's
 * development score is measured on the CHANGE in the people they mentor, split between mentors, weighted by how long they mentored,
 * and every factor is shown beside it. The same pure maths builds the Mentor scoring model's components.
 */
export class MentorshipService {
  constructor(private readonly o: { store: AuthStore; auth: AuthService; audit: AuditService }) {}

  private ctx(auth: AuthContext, requestId: string): TenantCtx {
    return this.o.auth.tenantCtx(auth, requestId);
  }
  private now = (): string => this.o.auth.iso();
  private world(ctx: TenantCtx) {
    const tdb = this.o.store.tenant(ctx);
    const people = this.o.store.people(tdb);
    const org = this.o.store.orgs.findById(ctx.organizationId);
    return { tdb, repo: this.o.store.mentorship(tdb), cards: this.o.store.scorecards(tdb), people, names: new Map(people.people().map((p) => [p.id, p])), today: todayIn(org?.timezone ?? "UTC", new Date(this.now())) };
  }
  private nm(w: { names: Map<string, { display_name: string }> }, id: string): string {
    return w.names.get(id)?.display_name ?? "Former member";
  }

  // ---------- who may see and do what ----------

  private sees(caps: Capabilities, me: string, a: Pick<AssignmentRow, "mentor_membership_id" | "mentee_membership_id">): boolean {
    if (a.mentor_membership_id === me || a.mentee_membership_id === me) return true;
    const s = caps.scope("mentorship.view");
    return s.all || s.members.has(a.mentor_membership_id) || s.members.has(a.mentee_membership_id);
  }
  private manages(caps: Capabilities, mentee: string): boolean {
    const s = caps.scope("mentorship.manage");
    return s.all || s.members.has(mentee);
  }
  private logs(caps: Capabilities, me: string, a: AssignmentRow): boolean {
    if (!caps.has("mentorship.log")) return false;
    if (a.mentor_membership_id === me) return true;
    const s = caps.scope("mentorship.log");
    return s.all || s.members.has(a.mentor_membership_id) || s.members.has(a.mentee_membership_id);
  }

  private view(w: ReturnType<MentorshipService["world"]>, caps: Capabilities, me: string, a: AssignmentRow, acts: { assignment_id: string; occurred_on: string }[]): AssignmentView {
    const mine = acts.filter((x) => x.assignment_id === a.id);
    return {
      id: a.id, mentor: { id: a.mentor_membership_id, name: this.nm(w, a.mentor_membership_id) }, mentee: { id: a.mentee_membership_id, name: this.nm(w, a.mentee_membership_id) },
      startDate: a.start_date, endDate: a.end_date, status: a.status as AssignmentView["status"], goals: a.goals, cadenceDays: a.cadence_days, activityCount: mine.length, lastActivityOn: mine.length ? mine.map((x) => x.occurred_on).sort().at(-1)! : null, isDemo: a.is_demo === 1,
      can: { manage: caps.has("mentorship.manage") && this.manages(caps, a.mentee_membership_id) && a.status !== "ended", log: this.logs(caps, me, a) && a.status === "active" },
    };
  }

  // ---------- assignments ----------

  list(auth: AuthContext, requestId: string, caps: Capabilities, q: { mentorId?: string; menteeId?: string; status?: string }): AssignmentView[] {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const acts = w.repo.activities();
    return w.repo.assignments()
      .filter((a) => this.sees(caps, ctx.membershipId, a) && (!q.mentorId || a.mentor_membership_id === q.mentorId) && (!q.menteeId || a.mentee_membership_id === q.menteeId) && (!q.status || a.status === q.status))
      .map((a) => this.view(w, caps, ctx.membershipId, a, acts));
  }
  private find(w: ReturnType<MentorshipService["world"]>, caps: Capabilities, me: string, id: string): AssignmentRow {
    const a = w.repo.assignment(id);
    if (!a || !this.sees(caps, me, a)) throw notFound();
    return a;
  }
  one(auth: AuthContext, requestId: string, caps: Capabilities, id: string): AssignmentView {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    return this.view(w, caps, ctx.membershipId, this.find(w, caps, ctx.membershipId, id), w.repo.activities(id));
  }

  create(auth: AuthContext, requestId: string, caps: Capabilities, input: { mentorId: string; menteeId: string; startDate?: string; goals?: string; cadenceDays?: number }): AssignmentView {
    if (!caps.has("mentorship.manage")) throw new HttpError(403, "permission_denied", "You cannot create mentorship assignments.");
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const mentor = w.names.get(input.mentorId);
    const mentee = w.names.get(input.menteeId);
    if (!mentor || !mentee) throw notFound();
    if (!this.manages(caps, input.menteeId)) throw new HttpError(403, "outside_scope", "You can only assign mentors to people inside your scope.");
    if (mentor.archived_at !== null || mentee.archived_at !== null || mentor.status === "left" || mentee.status === "left") throw new HttpError(409, "archived", "Both people must still be part of the organization.");
    if (input.mentorId === input.menteeId) throw new HttpError(400, "same_person", "Nobody mentors themself.");
    const startDate = input.startDate ?? w.today;
    if (!isDay(startDate)) throw new HttpError(400, "invalid_date", "That is not a real date.");
    if (startDate > w.today) throw new HttpError(400, "future_date", "An assignment starts today or earlier.");
    const cadence = input.cadenceDays ?? 14;
    if (!Number.isInteger(cadence) || cadence < 1 || cadence > 90) throw new HttpError(400, "invalid_value", "Meet every 1 to 90 days.");
    const goals = (input.goals ?? "").trim();
    if (goals.length > 1000) throw new HttpError(400, "invalid_text", "Goals are at most 1000 characters.");
    const open = w.repo.assignments().filter((a) => a.status !== "ended");
    if (open.some((a) => a.mentor_membership_id === input.mentorId && a.mentee_membership_id === input.menteeId)) throw new HttpError(409, "duplicate", `${mentor.display_name} already mentors ${mentee.display_name}.`);
    if (open.some((a) => a.mentor_membership_id === input.menteeId && a.mentee_membership_id === input.mentorId)) throw new HttpError(409, "loop", `${mentee.display_name} already mentors ${mentor.display_name}. Two people do not mentor each other.`);
    const id = newId();
    this.o.store.transaction(() => {
      w.repo.insertAssignment({ id, mentorId: input.mentorId, menteeId: input.menteeId, startDate, goals, cadenceDays: cadence, by: ctx.membershipId, now: this.now() });
      this.o.audit.record(w.tdb, ctx, { action: "mentorship.assign", entityType: "mentorship_assignment", entityId: id, summary: `${mentor.display_name} now mentors ${mentee.display_name} (from ${startDate}, a session every ${cadence} days)`, after: { mentorId: input.mentorId, menteeId: input.menteeId, startDate, cadenceDays: cadence } });
    });
    return this.view(w, caps, ctx.membershipId, w.repo.assignment(id)!, []);
  }

  update(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: { goals?: string; cadenceDays?: number; status?: "active" | "paused" | "ended"; endDate?: string }): AssignmentView {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const a = this.find(w, caps, ctx.membershipId, id);
    if (!caps.has("mentorship.manage") || !this.manages(caps, a.mentee_membership_id)) throw new HttpError(403, "permission_denied", "You cannot change this assignment.");
    if (a.status === "ended") throw new HttpError(409, "ended", "An ended assignment cannot be changed.");
    const goals = input.goals === undefined ? a.goals : input.goals.trim();
    if (goals.length > 1000) throw new HttpError(400, "invalid_text", "Goals are at most 1000 characters.");
    const cadence = input.cadenceDays ?? a.cadence_days;
    if (!Number.isInteger(cadence) || cadence < 1 || cadence > 90) throw new HttpError(400, "invalid_value", "Meet every 1 to 90 days.");
    const status = input.status ?? a.status;
    if (!["active", "paused", "ended"].includes(status)) throw new HttpError(400, "invalid_value", "A status is active, paused or ended.");
    let endDate: string | null = null;
    if (status === "ended") {
      endDate = input.endDate ?? w.today;
      if (!isDay(endDate)) throw new HttpError(400, "invalid_date", "That is not a real date.");
      if (endDate > w.today) throw new HttpError(400, "future_date", "An assignment ends today or earlier.");
      if (endDate <= a.start_date) throw new HttpError(400, "before_start", "It cannot end on or before the day it started.");
    } else if (input.endDate !== undefined) throw new HttpError(400, "invalid_value", "An end date goes with ending the assignment.");
    const mentor = this.nm(w, a.mentor_membership_id);
    const mentee = this.nm(w, a.mentee_membership_id);
    this.o.store.transaction(() => {
      w.repo.updateAssignment({ id, goals, cadenceDays: cadence, status, endDate, now: this.now() });
      const what = status !== a.status ? (status === "ended" ? `ended on ${endDate}` : status === "paused" ? "paused" : "resumed") : "changed";
      this.o.audit.record(w.tdb, ctx, { action: status === "ended" ? "mentorship.end" : "mentorship.update", entityType: "mentorship_assignment", entityId: id, summary: `Mentoring of ${mentee} by ${mentor} ${what}`, before: { status: a.status, goals: a.goals, cadenceDays: a.cadence_days }, after: { status, goals, cadenceDays: cadence, endDate } });
    });
    return this.view(w, caps, ctx.membershipId, w.repo.assignment(id)!, w.repo.activities(id));
  }

  // ---------- activities ----------

  activities(auth: AuthContext, requestId: string, caps: Capabilities, id: string): ActivityView[] {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    this.find(w, caps, ctx.membershipId, id);
    return w.repo.activities(id).map((x) => ({ id: x.id, type: x.activity_type, occurredOn: x.occurred_on, durationMinutes: x.duration_minutes, summary: x.summary, outcome: x.outcome, by: { id: x.created_by_membership_id, name: this.nm(w, x.created_by_membership_id) } }));
  }
  logActivity(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: { type: string; occurredOn?: string; durationMinutes?: number | null; summary: string; outcome?: string | null }): ActivityView {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const a = this.find(w, caps, ctx.membershipId, id);
    if (!this.logs(caps, ctx.membershipId, a)) throw new HttpError(403, "permission_denied", "Only the mentor, or someone who manages the assignment, can log what happened.");
    if (a.status === "paused") throw new HttpError(409, "paused", "This assignment is paused. Resume it to log activities.");
    if (!(ACTIVITY_TYPES as readonly string[]).includes(input.type)) throw new HttpError(400, "invalid_value", `An activity is one of: ${ACTIVITY_TYPES.join(", ")}.`);
    const occurredOn = input.occurredOn ?? w.today;
    if (!isDay(occurredOn)) throw new HttpError(400, "invalid_date", "That is not a real date.");
    if (occurredOn > w.today) throw new HttpError(400, "future_date", "Log what has happened, not what is planned.");
    if (occurredOn < a.start_date || (a.end_date !== null && occurredOn >= a.end_date)) throw new HttpError(400, "outside_assignment", "That day is outside the time this person was mentored.");
    const summary = input.summary.trim();
    if (summary.length < 1 || summary.length > 1000) throw new HttpError(400, "invalid_text", "Say what happened, in 1 to 1000 characters.");
    const outcome = input.outcome?.trim() || null;
    if (outcome && outcome.length > 500) throw new HttpError(400, "invalid_text", "The outcome is at most 500 characters.");
    const minutes = input.durationMinutes ?? null;
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 600)) throw new HttpError(400, "invalid_value", "A session lasts 1 to 600 minutes.");
    const actId = newId();
    this.o.store.transaction(() => {
      w.repo.insertActivity({ id: actId, assignmentId: id, type: input.type, occurredOn, minutes, summary, outcome, by: ctx.membershipId, now: this.now() });
      this.o.audit.record(w.tdb, ctx, { action: "mentorship.activity", entityType: "mentorship_assignment", entityId: id, summary: `Logged a ${input.type.replace(/_/g, " ")} for ${this.nm(w, a.mentee_membership_id)} (mentor ${this.nm(w, a.mentor_membership_id)}) on ${occurredOn}`, after: { type: input.type, occurredOn, minutes } });
    });
    return this.activities(auth, requestId, caps, id).find((x) => x.id === actId)!;
  }

  // ---------- ratings ----------

  progress(auth: AuthContext, requestId: string, caps: Capabilities, id: string, periodId?: string) {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const a = this.find(w, caps, ctx.membershipId, id);
    const period = periodId ? w.cards.period(periodId) : undefined;
    if (periodId && !period) throw notFound();
    const entered = w.repo.progress(id).filter((p) => !period || p.period_id === period.id).map((p) => ({ id: p.id, periodId: p.period_id, metric: p.metric_key, value: p.current_value, source: p.source, note: p.note, by: { id: p.entered_by_membership_id, name: this.nm(w, p.entered_by_membership_id) }, at: p.measured_at }));
    let measured: MenteeFactors | null = null;
    if (period) {
      const collector = new Collector(w.tdb, { id: period.id, start: period.start_date, end: period.end_date, open: period.status === "open" }, w.today);
      measured = this.factors(w, caps, ctx.membershipId, collector, a, DEFAULT_MENTORSHIP.minDays, DEFAULT_MENTORSHIP.k);
    }
    return { assignmentId: id, entered, measured };
  }
  rate(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: { periodId: string; value: number; note?: string }) {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const a = this.find(w, caps, ctx.membershipId, id);
    if (!caps.has("mentorship.log")) throw new HttpError(403, "permission_denied", "You cannot enter ratings.");
    const me = ctx.membershipId;
    if (me !== a.mentor_membership_id && me !== a.mentee_membership_id) throw new HttpError(403, "outside_scope", "Only the mentor or the mentee rates how the mentoring is going.");
    if (!w.cards.period(input.periodId)) throw notFound();
    if (!Number.isFinite(input.value) || input.value < 1 || input.value > 5) throw new HttpError(400, "invalid_value", "A rating is from 1 to 5.");
    const note = input.note?.trim() || null;
    if (note && note.length > 500) throw new HttpError(400, "invalid_text", "The note is at most 500 characters.");
    const rid = newId();
    this.o.store.transaction(() => {
      w.repo.insertProgress({ id: rid, assignmentId: id, periodId: input.periodId, value: input.value, source: me === a.mentor_membership_id ? "mentor_entered" : "mentee_entered", note, by: me, now: this.now() });
      this.o.audit.record(w.tdb, ctx, { action: "mentorship.rating", entityType: "mentorship_assignment", entityId: id, summary: `Rated the mentoring of ${this.nm(w, a.mentee_membership_id)} by ${this.nm(w, a.mentor_membership_id)} ${input.value} out of 5`, after: { value: input.value } });
    });
    return this.progress(auth, requestId, caps, id, input.periodId).entered.find((e) => e.id === rid)!;
  }

  // ---------- effectiveness ----------

  private factors(w: ReturnType<MentorshipService["world"]>, caps: Capabilities, me: string, collector: Collector, a: AssignmentRow, minDays: number, k: number): MenteeFactors | null {
    const l = collector.assignmentLink(a.id);
    if (!l) return null;
    const canSee = a.mentor_membership_id === me || a.mentee_membership_id === me || scoreAccess(caps, me, a.mentee_membership_id).scores;
    return {
      assignmentId: a.id, mentee: { id: a.mentee_membership_id, name: this.nm(w, a.mentee_membership_id) }, overlapDays: l.overlapDays, durationFactor: Math.round(durationFactor(l, minDays) * 100) / 100, mentorCount: l.mentorCount, creditShare: Math.round((1 / Math.max(1, l.mentorCount)) * 100) / 100,
      improvementIndex: ((i) => (i === null ? null : Math.round(i * 10) / 10))(improvementIndex(l, k)),
      detail: canSee ? { baselineScore: l.baselineScore, currentScore: l.currentScore, scoreDelta: l.scoreDelta, deliveryDelta: l.deliveryDelta, qualityDelta: l.qualityDelta, goalAchievement: l.goalAchievement === null ? null : Math.round(l.goalAchievement * 10) / 10 } : null,
      activities: l.activities, expectedActivities: Math.round((l.overlapDays / Math.max(1, l.cadenceDays)) * 10) / 10, cadenceDays: l.cadenceDays,
    };
  }

  effectiveness(auth: AuthContext, requestId: string, caps: Capabilities, q: { periodId: string; mentorId?: string }): EffectivenessResult {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const me = ctx.membershipId;
    const period = w.cards.period(q.periodId);
    if (!period) throw notFound();
    const collector = new Collector(w.tdb, { id: period.id, start: period.start_date, end: period.end_date, open: period.status === "open" }, w.today);
    const cfg = DEFAULT_MENTORSHIP;
    const all = w.repo.assignments().filter((a) => this.sees(caps, me, a));
    const mentorIds = [...new Set(all.map((a) => a.mentor_membership_id))].filter((id) => !q.mentorId || id === q.mentorId);
    if (q.mentorId && mentorIds.length === 0) throw notFound();
    const mentors: Effectiveness[] = [];
    for (const mentor of mentorIds) {
      const links = collector.mentorshipFor(mentor).asMentor;
      if (links.length === 0) continue;
      const dev = developmentProvider(links, 2, cfg);
      const act = activityProvider(links);
      const mentees = all.filter((a) => a.mentor_membership_id === mentor).map((a) => this.factors(w, caps, me, collector, a, cfg.minDays, cfg.k)).filter((x): x is MenteeFactors => x !== null);
      mentors.push({
        mentor: { id: mentor, name: this.nm(w, mentor) },
        development: { value: dev.value === null ? null : Math.round(dev.value * 10) / 10, state: dev.state, sampleSize: dev.sampleSize, notes: dev.notes },
        activity: { value: act.value === null ? null : Math.round(act.value * 10) / 10, state: act.state, sampleSize: act.sampleSize, notes: act.notes },
        menteeCount: mentees.length, averageDays: mentees.length ? Math.round(mentees.reduce((n, m) => n + m.overlapDays, 0) / mentees.length) : null, mentees,
      });
    }
    mentors.sort((a, b) => (b.development.value ?? -1) - (a.development.value ?? -1) || a.mentor.name.localeCompare(b.mentor.name));
    const all2 = mentors.flatMap((m) => m.mentees);
    const caveats = ["Mentee results have many causes. This shows how the people someone mentors changed while they were mentored, not what the mentor alone caused.", `Credit is split between a mentee's mentors, and an assignment counts in full only after ${cfg.minDays} days (shorter ones count in proportion). A score change of 10 points moves the improvement index by ${cfg.k * 10} (50 means no change).`, "Mentors are compared only with other mentors. Mentee count and time are shown beside every number because they change what it means."];
    const shared = all2.filter((m) => m.mentorCount > 1).length;
    const short = all2.filter((m) => m.overlapDays < cfg.minDays).length;
    if (shared > 0) caveats.push(`${shared} of ${all2.length} assignments share their mentee with another mentor.`);
    if (short > 0) caveats.push(`${short} of ${all2.length} assignments ran for less than ${cfg.minDays} days in this period, so they count for less.`);
    if (period.status === "open") caveats.push("This period is still open, so mentee scores are provisional and these numbers will move.");
    return { period: { id: period.id, name: period.name, status: period.status }, settings: cfg, mentors, caveats };
  }
}
