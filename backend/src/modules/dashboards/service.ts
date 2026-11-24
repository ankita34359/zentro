import { HttpError } from "../../lib/errors.js";
import { WEBHOOK_EVENTS } from "../integrations/webhooks.js";
import type { AuthStore } from "../auth/repositories/store.js";
import type { AuthContext, AuthService } from "../auth/service.js";
import type { Capabilities } from "../permissions/service.js";
import type { AlignmentService, TreeNode } from "../okr/alignment.js";
import type { OkrService, ObjectiveSummary } from "../okr/service.js";
import type { MeasurementService } from "../kpi/measurements.js";
import { currentRows, buildSeries, loadSeriesInput, subjectKeyOf, subjectOfRow } from "../kpi/series.js";
import { keyResultAttainment, objectiveAttainment, type Direction, type ProgressMethod } from "../okr/attainment.js";
import type { MentorshipService } from "../mentorship/service.js";
import type { PerformanceService } from "../scoring/performance.js";
import { addDays, todayIn } from "../tasks/dates.js";
import type { TaskRow } from "../tasks/repositories/tasks.js";

const open = (status: string): boolean => status !== "completed" && status !== "cancelled";
const BEHIND = new Set(["at_risk", "delayed"]);

export interface ObjectiveLine { id: string; title: string; health: string | null; attainmentPct: number | null; elapsedPct: number; dataState: string }
export interface MemberScore { total: number | null; status: string; confidence: number; confidenceLabel: string; scoreId: string; scorecardId: string }
export interface TeamCard {
  /** Only when a date range was picked: counted for exactly those dates, out of `sample` tasks of the team's people. */
  activity: null | { completed: number; due: number; dueOnTime: number; sample: number };
  id: string;
  name: string;
  department: string | null;
  memberCount: number;
  /** Named only for people the caller may see; the rest are counted. */
  members: { id: string; name: string; role: string; score: MemberScore | null }[];
  hiddenMembers: number;
  /** The mean of the totals the caller may see, with how many people it rests on. null when nobody visible has a score. */
  average: null | { value: number; n: number; of: number; note: string | null };
  mentoring: null | { pairs: number; activePairs: number; sessions: number; menteesMeasured: number; averageImprovement: number | null; caveat: string };
  /** null = the caller may not see objectives. */
  objectives: ObjectiveLine[] | null;
  kpis: null | { series: number; byStatus: Record<string, number>; missingPeriods: number; items: { kpiId: string; name: string; subject: string; status: string; missing: number }[] };
  tasks: null | { open: number; overdue: number; done: number; blocked: number };
}
export interface TeamComparison { department: string; teams: { id: string; name: string; average: number | null; n: number; eligible: boolean; rank: number | null }[]; note: string }
export interface TeamRange { preset: string; label: string; from: string; to: string; days: number; scores: { period: { id: string; name: string; start: string; end: string } | null; coveragePct: number; note: string } }
export interface TeamPerformance { range: TeamRange | null; today: string; period: { id: string; name: string; status: string } | null; periods: { id: string; name: string; status: string }[]; teams: TeamCard[]; comparisons: TeamComparison[] }

export interface ContributionLine { id: string; title: string; level: string; department: string | null; owner: string | null; health: string | null; attainmentPct: number | null; contributionPct: number | null }
export interface RangeInfo { preset: string; from: string; to: string; days: number }
export interface TrendPoint { date: string; value: number | null }
export interface DrillPerson { id: string; name: string; score: MemberScore | null }
export interface DrillTeam { id: string; name: string; people: number; average: number | null; n: number; objectives: ObjectiveLine[]; members: DrillPerson[] }
export interface DrillDepartment { id: string; name: string; people: number; average: number | null; n: number; objectives: ObjectiveLine[]; teams: DrillTeam[] }
export interface LeadershipView {
  today: string;
  range: RangeInfo;
  period: { id: string; name: string; status: string } | null;
  /** Plain sentences built only from the numbers on this page. */
  summary: string[];
  executiveKpis: { kpiId: string; name: string; unit: string | null; status: string; label: string; target: number | null; missing: number; trend: TrendPoint[]; change: number | null }[];
  departments: DrillDepartment[];
  groupedRisks: { kind: "behind_pace" | "overdue" | "no_data"; level: string; count: number; items: { id: string; title: string; reason: string }[] }[];
  objectives: { id: string; title: string; health: string | null; attainmentPct: number | null; elapsedPct: number; dataState: string; owner: string | null; contributors: ContributionLine[]; trend: TrendPoint[]; change: number | null }[];
  risks: { id: string; title: string; level: string; reason: string; kind: "behind_pace" | "overdue" | "no_data" }[];
  kpis: null | { series: number; byStatus: Record<string, number>; missingPeriods: number; attention: { kpiId: string; name: string; subject: string; status: string; label: string; missing: number }[] };
}

export interface Insight { key: string; severity: "attention" | "info"; title: string; summary: string; count: number; to: string; items: { label: string; detail: string; to: string }[] }
export interface InsightsView { today: string; insights: Insight[]; ask: { enabled: false; reason: string }; note: string }

export const EVENT_CATALOG: { type: string; description: string; recorded: boolean }[] = [
  { type: "task.created", description: "A task was created.", recorded: true },
  { type: "task.assigned", description: "A task was assigned to someone.", recorded: true },
  { type: "task.completed", description: "A task was completed.", recorded: true },
  { type: "task.overdue", description: "An open task passed its due date.", recorded: true },
  { type: "task.reviewed", description: "A reviewer rated a finished task.", recorded: true },
  { type: "task.outcome_recorded", description: "The outcome of a finished task was written down.", recorded: true },
  { type: "daily_update.submitted", description: "Someone sent their daily update.", recorded: true },
  { type: "objective.at_risk", description: "An objective moved to at risk or delayed.", recorded: true },
  { type: "kpi.measurement_recorded", description: "A KPI value was recorded or corrected.", recorded: true },
  { type: "kpi.threshold", description: "A KPI crossed a warning or critical threshold.", recorded: true },
  { type: "kpi.measurement_missed", description: "A KPI period ended with no value.", recorded: true },
  { type: "evidence.verified", description: "Evidence was verified, rejected or sent back for more information.", recorded: true },
  { type: "review.submitted", description: "A performance review was submitted.", recorded: true },
  { type: "period.closed", description: "A performance period was closed.", recorded: false },
  { type: "score.finalized", description: "A final score was calculated.", recorded: false },
];
const SENDABLE = new Set(WEBHOOK_EVENTS.map((e) => e.type));
export interface IntegrationsView {
  viaSocket: { connected: boolean; status: string; settings: { name: string; set: boolean }[] };
  /** The webhook and incoming endpoints are real (batch L). */
  automations: { webhook: { configured: boolean; enabled: boolean }; endpoints: number };
  /** Still not built: shown as Planned. */
  planned: { name: string; note: string }[];
  events: { type: string; description: string; status: "available" | "recorded" | "planned"; last30Days: number | null }[];
  steps: string[];
  note: string;
}
const VIASOCKET_SETTINGS = ["VIASOCKET_ORG_ID", "VIASOCKET_PROJECT_ID", "VIASOCKET_EMBED_SECRET"];

/**
 * The first versions of four pages (batch G): Team Performance, Leadership, rule-based insights and the integrations status. All
 * of it is read-only and counted from rows the caller may already see; nothing here calls an AI model or another service.
 */
export class DashboardService {
  constructor(private readonly o: { store: AuthStore; auth: AuthService; okr: OkrService; alignment: AlignmentService; measurements: MeasurementService; performance: PerformanceService; mentorship: MentorshipService }) {}

  private base(auth: AuthContext, requestId: string) {
    if (!auth.organizationId || !auth.membershipId) throw new HttpError(403, "no_organization", "Join or create an organization first.");
    const ctx = this.o.auth.tenantCtx(auth, requestId);
    const tdb = this.o.store.tenant(ctx);
    const org = this.o.store.orgs.findById(ctx.organizationId);
    return { ctx, tdb, today: todayIn(org?.timezone ?? "UTC", new Date(this.o.auth.iso())) };
  }
  private line(o: ObjectiveSummary): ObjectiveLine {
    return { id: o.id, title: o.title, health: o.health, attainmentPct: o.attainmentPct, elapsedPct: o.elapsedPct, dataState: o.dataState };
  }

  // ---------- Team Performance ----------

  /** The period scores are read for: the one asked for, else the newest open one, else the newest. */
  private pick(tdb: ReturnType<AuthStore["tenant"]>, id?: string) {
    const periods = this.o.store.scorecards(tdb).periods();
    const chosen = (id ? periods.find((p) => p.id === id) : undefined) ?? periods.find((p) => p.status === "open") ?? periods[0];
    return { periods: periods.map((p) => ({ id: p.id, name: p.name, status: p.status })), period: chosen ? { id: chosen.id, name: chosen.name, status: chosen.status } : null, all: periods };
  }
  private scoresOf(auth: AuthContext, requestId: string, caps: Capabilities, periodId: string | null): Map<string, MemberScore> {
    if (!periodId) return new Map();
    return new Map(this.o.performance.scorecards(auth, requestId, caps, { periodId }).map((c) => [c.subject.id, { total: c.total, status: c.status, confidence: Math.round(c.confidence * 100) / 100, confidenceLabel: c.confidenceLabel, scoreId: c.scoreId, scorecardId: c.scorecardId }]));
  }
  /** What happened in exactly the dates picked: tasks finished inside them, tasks that fell due inside them, and how many of those were finished by their due date. */
  private activity(tasks: TaskRow[], w: { from: string; to: string }): TeamCard["activity"] {
    const inside = (d: string | null): boolean => d !== null && d.slice(0, 10) >= w.from && d.slice(0, 10) <= w.to;
    const due = tasks.filter((x) => inside(x.due_at));
    return { completed: tasks.filter((x) => inside(x.completed_at)).length, due: due.length, dueOnTime: due.filter((x) => x.completed_at !== null && x.due_at !== null && x.completed_at.slice(0, 10) <= x.due_at.slice(0, 10)).length, sample: tasks.length };
  }
  private mean(values: number[]): number | null {
    return values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;
  }

  /** A date range for Team Performance: this month, last month, this quarter or custom dates (at most two years). Null when none was asked for. */
  private teamRange(today: string, q: { range?: string; from?: string; to?: string }): { preset: string; label: string; from: string; to: string; days: number } | null {
    if (!q.range) return null;
    const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
    const pad = (n: number): string => String(n).padStart(2, "0");
    const first = (yy: number, mm: number): string => `${yy}-${pad(mm)}-01`;
    const lastOf = (yy: number, mm: number): string => addDays(first(mm === 12 ? yy + 1 : yy, mm === 12 ? 1 : mm + 1), -1);
    let r: { preset: string; label: string; from: string; to: string };
    if (q.range === "this_month") r = { preset: q.range, label: "This month", from: first(y, m), to: today };
    else if (q.range === "last_month") { const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1]; r = { preset: q.range, label: "Last month", from: first(py, pm), to: lastOf(py, pm) }; }
    else if (q.range === "this_quarter") { const qs = Math.floor((m - 1) / 3) * 3 + 1; r = { preset: q.range, label: "This quarter", from: first(y, qs), to: today }; }
    else if (q.range === "custom") {
      const day = /^\d{4}-\d{2}-\d{2}$/;
      if (!q.from || !q.to || !day.test(q.from) || !day.test(q.to) || Number.isNaN(Date.parse(q.from)) || Number.isNaN(Date.parse(q.to))) throw new HttpError(400, "invalid_date", "Pick a start and an end date.");
      if (q.to < q.from) throw new HttpError(400, "invalid_date", "The end of the range comes before its start.");
      if (Math.round((Date.parse(q.to) - Date.parse(q.from)) / 86_400_000) > 730) throw new HttpError(400, "invalid_date", "A range is at most two years.");
      r = { preset: "custom", label: `${q.from} to ${q.to}`, from: q.from, to: q.to > today ? today : q.to };
    } else throw new HttpError(400, "invalid_value", "Choose this month, last month, this quarter or custom dates.");
    return { ...r, days: Math.max(1, Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86_400_000) + 1) };
  }

  teamPerformance(auth: AuthContext, requestId: string, caps: Capabilities, q: { periodId?: string; range?: string; from?: string; to?: string } = {}): TeamPerformance {
    const { ctx, tdb, today } = this.base(auth, requestId);
    const me = ctx.membershipId;
    const structure = this.o.store.structure(tdb);
    const people = this.o.store.people(tdb);
    const scope = caps.scope("org.view");
    const depts = new Map(structure.departments().map((d) => [d.id, d.name]));
    const teams = structure.teams().filter((t) => t.archived_at === null && (scope.all || scope.teams.has(t.id) || scope.departments.has(t.department_id)));
    const names = new Map(people.people().filter((p) => p.archived_at === null && p.status !== "left").map((p) => [p.id, p.display_name]));
    const rows = people.teamRows({ asOf: today });
    const seePeople = caps.scope("people.view");
    const canName = (m: string): boolean => m === me || seePeople.all || seePeople.members.has(m);
    const window = this.teamRange(today, q);
    const picked = this.pick(tdb, q.periodId);
    let { periods, period } = picked;
    let teamRange: TeamRange | null = null;
    if (window) {
      // scores belong to scoring periods, so the range uses the period that overlaps it most and says how much of the range that period covers; no overlap means no scores, never a guess
      let best: { p: (typeof picked.all)[number]; overlap: number } | null = null;
      for (const p of picked.all) {
        const overlap = Math.round((Date.parse(p.end_date < window.to ? p.end_date : window.to) - Date.parse(p.start_date > window.from ? p.start_date : window.from)) / 86_400_000) + 1;
        if (overlap > 0 && (!best || overlap > best.overlap)) best = { p, overlap };
      }
      period = best ? { id: best.p.id, name: best.p.name, status: best.p.status } : null;
      const coveragePct = best ? Math.min(100, Math.round((best.overlap / window.days) * 100)) : 0;
      teamRange = { ...window, scores: { period: best ? { id: best.p.id, name: best.p.name, start: best.p.start_date, end: best.p.end_date } : null, coveragePct, note: best ? `Scores come from the scoring period "${best.p.name}" (${best.p.start_date} to ${best.p.end_date}), which covers ${coveragePct}% of this range. Task numbers below are counted for exactly the dates you picked.` : "No scoring period overlaps these dates, so there are no scores for this range. Task numbers below are still counted for exactly the dates you picked." } };
    }
    const scores = this.scoresOf(auth, requestId, caps, period?.id ?? null);
    const okrOn = caps.has("okr.view");
    const objectives = okrOn ? this.o.okr.list(auth, requestId, caps, { level: "team" }).filter((o) => o.lifecycle === "active" || o.lifecycle === "completed") : [];
    const kpiScope = caps.scope("kpi.view");
    const series = caps.has("kpi.view") ? buildSeries(loadSeriesInput(tdb, today)) : [];
    const taskScope = caps.scope("task.view");
    const tasksOn = caps.has("task.view");
    const tasksRepo = this.o.store.tasks(tdb);
    const allTasks = tasksOn ? tasksRepo.list() : [];
    const doers = new Map<string, string[]>();
    if (tasksOn) for (const a of tasksRepo.activeAssignments()) if (a.role === "assignee" && a.assignee_membership_id) doers.set(a.task_id, [...(doers.get(a.task_id) ?? []), a.assignee_membership_id]);
    // mentoring, from what the caller may already see
    const mentoringOn = caps.has("mentorship.view");
    const pairs = mentoringOn ? this.o.mentorship.list(auth, requestId, caps, {}) : [];
    const effect = mentoringOn && period ? this.o.mentorship.effectiveness(auth, requestId, caps, { periodId: period.id }) : null;
    const improvement = new Map<string, number>();
    for (const m of effect?.mentors ?? []) for (const x of m.mentees) if (x.improvementIndex !== null) improvement.set(x.mentee.id, x.improvementIndex);
    const out: TeamCard[] = teams.map((t) => {
      const members = rows.filter((r) => r.team_id === t.id && names.has(r.membership_id));
      const ids = new Set(members.map((r) => r.membership_id));
      const shown = members.filter((r) => canName(r.membership_id));
      const mine = (m: string): boolean => taskScope.all || taskScope.members.has(m) || m === me;
      const theirTasks = allTasks.filter((x: TaskRow) => (doers.get(x.id) ?? []).some((d) => ids.has(d) && mine(d)));
      const teamSeries = series.filter((s) => (s.subject.kind === "team" && s.subject.id === t.id && (kpiScope.all || kpiScope.teams.has(t.id) || [...ids].some((m) => kpiScope.members.has(m)))) || (s.subject.kind === "person" && s.subject.id !== null && ids.has(s.subject.id) && (kpiScope.all || kpiScope.members.has(s.subject.id) || s.subject.id === me)));
      const subjectName = (s: (typeof series)[number]): string => (s.subject.kind === "team" ? "The team" : names.get(s.subject.id ?? "") ?? "Someone");
      const byStatus: Record<string, number> = {};
      for (const s of teamSeries) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
      const rank: Record<string, number> = { critical: 0, warning: 1 };
      // a score is shown only for people whose score the caller may read (the list is already filtered), and their name only where `people.view` allows
      const visibleScores = members.map((r) => scores.get(r.membership_id)).filter((x): x is MemberScore => x !== undefined && x.total !== null);
      const avg = this.mean(visibleScores.map((x) => x.total as number));
      const tp = pairs.filter((p) => ids.has(p.mentor.id) || ids.has(p.mentee.id));
      const measured = tp.map((p) => improvement.get(p.mentee.id)).filter((x): x is number => x !== undefined);
      return {
        id: t.id, name: t.name, department: depts.get(t.department_id) ?? null, memberCount: members.length,
        members: shown.map((r) => ({ id: r.membership_id, name: names.get(r.membership_id)!, role: r.membership_type, score: scores.get(r.membership_id) ?? null })), hiddenMembers: members.length - shown.length,
        average: avg === null ? null : { value: avg, n: visibleScores.length, of: members.length, note: visibleScores.length < 3 ? `Based on only ${visibleScores.length} of ${members.length} ${members.length === 1 ? "person" : "people"}: read it with care.` : visibleScores.length < members.length ? `Based on ${visibleScores.length} of ${members.length} people (the others have no score you can see yet).` : null },
        mentoring: mentoringOn ? { pairs: tp.length, activePairs: tp.filter((p) => p.status === "active").length, sessions: tp.reduce((n, p) => n + p.activityCount, 0), menteesMeasured: measured.length, averageImprovement: this.mean(measured), caveat: "Mentee results have many causes. 50 means no change; this shows how mentees changed, not what a mentor alone caused." } : null,
        objectives: okrOn ? objectives.filter((o) => o.team?.id === t.id).map((o) => this.line(o)) : null,
        kpis: caps.has("kpi.view") ? { series: teamSeries.length, byStatus, missingPeriods: teamSeries.reduce((n, s) => n + s.missing.length, 0), items: teamSeries.filter((s) => s.status === "critical" || s.status === "warning" || s.missing.length > 0).sort((a, b) => (rank[a.status] ?? 2) - (rank[b.status] ?? 2) || b.missing.length - a.missing.length).slice(0, 5).map((s) => ({ kpiId: s.kpi.id, name: s.kpi.name, subject: subjectName(s), status: s.status, missing: s.missing.length })) } : null,
        activity: tasksOn && window ? this.activity(theirTasks, window) : null,
        tasks: tasksOn ? { open: theirTasks.filter((x) => open(x.status)).length, overdue: theirTasks.filter((x) => open(x.status) && x.due_at !== null && x.due_at < today).length, done: theirTasks.filter((x) => x.status === "completed").length, blocked: theirTasks.filter((x) => x.status === "blocked").length } : null,
      };
    });
    // teams are compared with teams of the same kind: the other teams of their department, and only with enough scored people
    const comparisons: TeamComparison[] = [];
    for (const dept of new Set(out.map((c) => c.department).filter((d): d is string => d !== null))) {
      const group = out.filter((c) => c.department === dept);
      if (group.length < 2) continue;
      const rowsC = group.map((c) => ({ id: c.id, name: c.name, average: c.average?.value ?? null, n: c.average?.n ?? 0, eligible: (c.average?.n ?? 0) >= 3 }));
      const ranked = rowsC.filter((r) => r.eligible).sort((a, b) => (b.average as number) - (a.average as number));
      comparisons.push({ department: dept, teams: rowsC.map((r) => ({ ...r, rank: ranked.length >= 2 ? ranked.findIndex((x) => x.id === r.id) + 1 || null : null })), note: ranked.length >= 2 ? "Teams of the same department, ranked only when at least 3 people on each have a score. Teams do different work: read the gap as a question, not a verdict." : "Not enough data to compare: a team needs at least 3 people with a score you can see, and at least 2 such teams." });
    }
    return { range: teamRange, today, period, periods, teams: out.sort((a, b) => (a.department ?? "").localeCompare(b.department ?? "") || a.name.localeCompare(b.name)), comparisons };
  }

  // ---------- Leadership ----------

  private rangeOf(today: string, q: { range?: string; from?: string; to?: string }): RangeInfo {
    const days: Record<string, number> = { "30d": 30, "90d": 90, "180d": 180, "365d": 365 };
    const day = /^\d{4}-\d{2}-\d{2}$/;
    if (q.from && q.to && day.test(q.from) && day.test(q.to)) {
      if (q.to < q.from) throw new HttpError(400, "invalid_date", "The end of the range comes before its start.");
      const span = Math.round((Date.parse(q.to) - Date.parse(q.from)) / 86_400_000);
      if (span > 730) throw new HttpError(400, "invalid_date", "A range is at most two years.");
      return { preset: "custom", from: q.from, to: q.to > today ? today : q.to, days: span };
    }
    const preset = q.range && days[q.range] ? q.range : "90d";
    return { preset, from: addDays(today, -days[preset]!), to: today, days: days[preset]! };
  }
  /** Six evenly spaced days from the start of the range to its end. */
  private dates(r: RangeInfo): string[] {
    const step = Math.max(1, (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 / 5);
    return Array.from({ length: 6 }, (_, i) => (i === 5 ? r.to : addDays(r.from, Math.round(step * i))));
  }

  leadership(auth: AuthContext, requestId: string, caps: Capabilities, q: { range?: string; from?: string; to?: string; periodId?: string } = {}): LeadershipView {
    const { ctx, tdb, today } = this.base(auth, requestId);
    const range = this.rangeOf(today, q);
    const dates = this.dates(range);
    const all = this.o.okr.list(auth, requestId, caps, {});
    const byId = new Map(all.map((o) => [o.id, o]));
    const tree = this.o.alignment.tree(auth, requestId, caps, {});
    const flat = (n: TreeNode): TreeNode[] => n.children.flatMap((c) => [c, ...flat(c)]);
    const companyRoots = tree.roots.filter((r) => r.level === "company" && (r.lifecycle === "active" || r.lifecycle === "completed"));
    // attainment of an objective on each day of the range, from the values recorded up to that day (no value yet = no data, never 0)
    const okrRepo = this.o.store.okr(tdb);
    const krs = new Map<string, ReturnType<typeof okrRepo.keyResults>>();
    for (const k of okrRepo.keyResults()) krs.set(k.objective_id, [...(krs.get(k.objective_id) ?? []), k]);
    const hist = new Map<string, { day: string; value: number }[]>();
    for (const h of okrRepo.allHistory()) if (h.value !== null && h.key_result_id) hist.set(h.key_result_id, [...(hist.get(h.key_result_id) ?? []), { day: h.recorded_at.slice(0, 10), value: h.value }]);
    const attainmentOn = (objectiveId: string, day: string): number | null => {
      const att = objectiveAttainment((krs.get(objectiveId) ?? []).map((k) => {
        const upTo = (hist.get(k.id) ?? []).filter((h) => h.day <= day);
        return { attainment: keyResultAttainment({ direction: k.direction as Direction, method: k.progress_method as ProgressMethod, start: k.start_value, target: k.target_value, current: upTo.length ? upTo[upTo.length - 1]!.value : null, weight: k.weight }).value, weight: k.weight };
      }));
      return att.dataState === "ok" && att.value !== null ? Math.round(att.value * 100) : null;
    };
    const trendOf = (id: string): { trend: TrendPoint[]; change: number | null } => {
      const trend = dates.map((date) => ({ date, value: attainmentOn(id, date) }));
      const first = trend.find((p) => p.value !== null);
      const last = trend[trend.length - 1]!;
      return { trend, change: first && last.value !== null && first !== last ? last.value - (first.value as number) : null };
    };
    const objectives = companyRoots.map((r) => {
      const s = byId.get(r.id);
      const contributors = flat(r).filter((c) => c.level === "department" || c.level === "team").map((c): ContributionLine => ({ id: c.id, title: c.title, level: c.level, department: byId.get(c.id)?.department?.name ?? byId.get(c.id)?.team?.name ?? null, owner: c.owner?.name ?? null, health: c.health, attainmentPct: c.attainmentPct, contributionPct: c.contributionPct }));
      return { id: r.id, title: r.title, health: r.health, attainmentPct: r.attainmentPct, elapsedPct: s?.elapsedPct ?? 0, dataState: r.dataState, owner: r.owner?.name ?? null, contributors, ...trendOf(r.id) };
    });
    const gaps = caps.has("okr.view") ? this.o.alignment.gaps(auth, requestId, caps) : null;
    const risks: LeadershipView["risks"] = [];
    for (const g of gaps?.behindPace ?? []) risks.push({ id: g.id, title: g.title, level: g.level, reason: g.reason, kind: "behind_pace" });
    for (const g of gaps?.overdue ?? []) risks.push({ id: g.id, title: g.title, level: g.level, reason: g.reason, kind: "overdue" });
    for (const g of gaps?.noData ?? []) risks.push({ id: g.id, title: g.title, level: g.level, reason: g.reason, kind: "no_data" });
    // personal objectives are grouped (one line per kind) so they do not drown the rest
    const own = risks.filter((r) => r.level !== "individual");
    const groupedRisks: LeadershipView["groupedRisks"] = (["behind_pace", "overdue", "no_data"] as const).flatMap((kind) => {
      const items = risks.filter((r) => r.level === "individual" && r.kind === kind);
      return items.length ? [{ kind, level: "individual", count: items.length, items: items.slice(0, 8).map((i) => ({ id: i.id, title: i.title, reason: i.reason })) }] : [];
    });
    const k = caps.has("kpi.view") ? this.o.measurements.overview(auth, requestId, caps) : null;

    // executive KPIs: the organization-level series, each with its last six periods and the change across them
    const input = caps.has("kpi.view") ? loadSeriesInput(tdb, today) : null;
    const orgSeries = input ? buildSeries(input).filter((s) => s.subject.kind === "organization") : [];
    const executiveKpis: LeadershipView["executiveKpis"] = input ? orgSeries.map((s) => {
      const rows = currentRows(input.measurements.filter((m) => m.kpi_id === s.kpi.id)).filter((m) => subjectKeyOf(subjectOfRow(m)) === subjectKeyOf(s.subject));
      const have = new Map(rows.map((m) => [m.period_start, m.value]));
      const periods = [...new Set([...have.keys(), ...s.missing])].sort().slice(-6);
      const trend: TrendPoint[] = periods.map((date) => ({ date, value: have.get(date) ?? null }));
      const vals = trend.filter((p) => p.value !== null);
      return { kpiId: s.kpi.id, name: s.kpi.name, unit: s.kpi.unit, status: s.status, label: s.latest?.label ?? "No value yet", target: s.target?.targetValue ?? null, missing: s.missing.length, trend, change: vals.length >= 2 ? Math.round(((vals[vals.length - 1]!.value as number) - (vals[0]!.value as number)) * 100) / 100 : null };
    }) : [];

    // drill-down: department -> team -> person, with scores only where the caller may read them
    const { period } = this.pick(tdb, q.periodId);
    const scores = this.scoresOf(auth, requestId, caps, period?.id ?? null);
    const structure = this.o.store.structure(tdb);
    const people = this.o.store.people(tdb);
    const names = new Map(people.people().filter((p) => p.archived_at === null && p.status !== "left").map((p) => [p.id, p.display_name]));
    const seePeople = caps.scope("people.view");
    const canName = (m: string): boolean => m === ctx.membershipId || seePeople.all || seePeople.members.has(m);
    const teamRows = people.teamRows({ asOf: today });
    const deptRows = people.deptRows({ asOf: today });
    const oList = all.filter((o) => o.lifecycle === "active" || o.lifecycle === "completed");
    const avgOf = (ids: string[]): { average: number | null; n: number } => {
      const v = ids.map((m) => scores.get(m)?.total).filter((x): x is number => x !== undefined && x !== null);
      return { average: this.mean(v), n: v.length };
    };
    const departments: DrillDepartment[] = structure.departments().filter((d) => d.archived_at === null).map((d) => {
      const dTeams = structure.teams().filter((t) => t.archived_at === null && t.department_id === d.id);
      const dPeople = [...new Set(deptRows.filter((r) => r.department_id === d.id && names.has(r.membership_id)).map((r) => r.membership_id))];
      return {
        id: d.id, name: d.name, people: dPeople.length, ...avgOf(dPeople), objectives: oList.filter((o) => o.department?.id === d.id && o.level === "department").map((o) => this.line(o)),
        teams: dTeams.map((t) => {
          const ids = [...new Set(teamRows.filter((r) => r.team_id === t.id && names.has(r.membership_id)).map((r) => r.membership_id))];
          return { id: t.id, name: t.name, people: ids.length, ...avgOf(ids), objectives: oList.filter((o) => o.team?.id === t.id).map((o) => this.line(o)), members: ids.filter(canName).map((m) => ({ id: m, name: names.get(m)!, score: scores.get(m) ?? null })) };
        }),
      };
    }).filter((d) => d.people > 0 || d.teams.length > 0);

    // the summary: sentences made only of the numbers above
    const summary: string[] = [];
    const behind = objectives.filter((o) => o.health === "at_risk" || o.health === "delayed");
    summary.push(objectives.length === 0 ? "There is no active company objective yet." : `${objectives.length} company ${objectives.length === 1 ? "objective is" : "objectives are"} active; ${behind.length} ${behind.length === 1 ? "is" : "are"} behind pace${behind.length ? ` (${behind.slice(0, 3).map((o) => `${o.title}: ${o.attainmentPct ?? 0}% done with ${o.elapsedPct}% of the time passed`).join("; ")})` : ""}.`);
    const moved = objectives.filter((o) => o.change !== null);
    if (moved.length) summary.push(`Over the last ${range.days} days: ${moved.map((o) => `${o.title} ${o.change! >= 0 ? "rose" : "fell"} ${Math.abs(o.change!)} points`).join("; ")}.`);
    if (k) summary.push(k.totals.series === 0 ? "No KPI has a value yet." : `${k.totals.series} KPI series: ${Object.entries(k.totals.byStatus).filter(([, n]) => n > 0).map(([s, n]) => `${n} ${s.replace("_", " ")}`).join(", ")}${k.totals.missingPeriods > 0 ? `; ${k.totals.missingPeriods} missing ${k.totals.missingPeriods === 1 ? "period" : "periods"}` : ""}.`);
    const allScored = [...scores.values()].filter((x) => x.total !== null);
    if (period) summary.push(allScored.length ? `In ${period.name}, ${allScored.length} ${allScored.length === 1 ? "person has" : "people have"} a score you can see; the average is ${this.mean(allScored.map((x) => x.total as number))}.` : `In ${period.name}, no score you can see has been calculated yet.`);
    if (risks.length) summary.push(`${risks.length} ${risks.length === 1 ? "objective is" : "objectives are"} flagged: ${risks.filter((r) => r.kind === "behind_pace").length} behind pace, ${risks.filter((r) => r.kind === "overdue").length} past their end date, ${risks.filter((r) => r.kind === "no_data").length} with no data.`);

    return {
      today, range, period, summary, executiveKpis, departments, groupedRisks, objectives, risks: own.slice(0, 20),
      kpis: k ? { series: k.totals.series, byStatus: k.totals.byStatus, missingPeriods: k.totals.missingPeriods, attention: k.attention.slice(0, 6).map((a) => ({ kpiId: a.kpiId, name: a.kpiName, subject: a.subject.name, status: a.status, label: a.label, missing: a.missing })) } : null,
    };
  }

  // ---------- rule-based insights (no AI) ----------

  insights(auth: AuthContext, requestId: string, caps: Capabilities): InsightsView {
    const { ctx, tdb, today } = this.base(auth, requestId);
    const out: Insight[] = [];
    if (caps.has("okr.view")) {
      const objs = this.o.okr.list(auth, requestId, caps, {}).filter((o) => o.lifecycle === "active");
      const behind = objs.filter((o) => o.health !== null && BEHIND.has(o.health));
      if (behind.length > 0) out.push({ key: "behind_pace", severity: "attention", count: behind.length, title: `${behind.length} ${behind.length === 1 ? "objective is" : "objectives are"} behind pace`, summary: "Progress is behind the share of time that has passed.", to: "/okrs?health=at_risk", items: behind.slice(0, 6).map((o) => ({ label: o.title, detail: `${o.attainmentPct ?? 0}% done, ${o.elapsedPct}% of the time has passed (${o.health === "delayed" ? "delayed" : "at risk"})`, to: `/okrs?objective=${o.id}` })) });
      const nodata = objs.filter((o) => o.dataState === "none" || o.health === "no_data");
      if (nodata.length > 0) out.push({ key: "no_data", severity: "info", count: nodata.length, title: `${nodata.length} ${nodata.length === 1 ? "objective has" : "objectives have"} no recorded value`, summary: "Nothing has been recorded yet, so its progress is unknown (not zero).", to: "/okrs?health=no_data", items: nodata.slice(0, 6).map((o) => ({ label: o.title, detail: `${o.elapsedPct}% of the time has passed`, to: `/okrs?objective=${o.id}` })) });
    }
    if (caps.has("task.view")) {
      const scope = caps.scope("task.view");
      const tasksRepo = this.o.store.tasks(tdb);
      const doers = new Map<string, string[]>();
      for (const a of tasksRepo.activeAssignments()) if (a.role === "assignee" && a.assignee_membership_id) doers.set(a.task_id, [...(doers.get(a.task_id) ?? []), a.assignee_membership_id]);
      const late = tasksRepo.list().filter((t) => open(t.status) && t.due_at !== null && t.due_at < today && (scope.all || (doers.get(t.id) ?? []).some((d) => scope.members.has(d) || d === ctx.membershipId)));
      if (late.length > 0) out.push({ key: "overdue_tasks", severity: "attention", count: late.length, title: `${late.length} ${late.length === 1 ? "task is" : "tasks are"} overdue`, summary: "Open tasks whose due date has passed.", to: "/my-work/tasks", items: late.sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? "")).slice(0, 6).map((t) => ({ label: t.title, detail: `due ${t.due_at}`, to: `/my-work/tasks?task=${t.id}` })) });
    }
    if (caps.has("kpi.view")) {
      const k = this.o.measurements.overview(auth, requestId, caps);
      const miss = k.attention.filter((a) => a.missing > 0);
      if (miss.length > 0) out.push({ key: "kpi_missing", severity: "attention", count: miss.length, title: `${miss.length} KPI ${miss.length === 1 ? "series has" : "series have"} missing months`, summary: "A period ended with no value: it is shown as missing, never as zero.", to: "/kpis?view=overview", items: miss.slice(0, 6).map((a) => ({ label: `${a.kpiName} (${a.subject.name})`, detail: `${a.missing} missing`, to: `/kpis?kpi=${a.kpiId}` })) });
    }
    const period = this.o.store.scorecards(tdb).periods().find((p) => p.status === "open");
    if (period) {
      const low = this.o.performance.scorecards(auth, requestId, caps, { periodId: period.id }).filter((c) => c.confidenceLabel === "low" && c.total !== null);
      if (low.length > 0) out.push({ key: "low_confidence", severity: "info", count: low.length, title: `${low.length} ${low.length === 1 ? "score has" : "scores have"} low confidence`, summary: `In ${period.name}: the score rests on little data, so read it with care.`, to: `/performance?period=${period.id}`, items: low.slice(0, 6).map((c) => ({ label: c.subject.name, detail: `${c.total?.toFixed(1)}, confidence ${Math.round(c.confidence * 100)}% (${Math.round(c.weightCoverage * 100)}% of the weight had data)`, to: `/performance?period=${period.id}&person=${c.subject.id}` })) });
    }
    return {
      today, insights: out.sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === "attention" ? -1 : 1)),
      ask: { enabled: false, reason: "An AI provider has to be connected first. Nothing on this page was written by an AI." },
      note: "These insights are plain rules applied to your own data, with the numbers shown. Early version.",
    };
  }

  // ---------- integrations status ----------

  integrations(auth: AuthContext, requestId: string): IntegrationsView {
    const { tdb } = this.base(auth, requestId);
    const since = new Date(new Date(this.o.auth.iso()).getTime() - 30 * 86_400_000).toISOString();
    const counts = this.o.store.events(tdb).countsByType(since);
    // only WHETHER a setting exists is read, never its value
    const settings = VIASOCKET_SETTINGS.map((name) => ({ name, set: (process.env[name] ?? "") !== "" }));
    const hook = this.o.store.integrations(tdb).settings();
    const webhook = { configured: Boolean(hook?.url_enc), enabled: hook?.enabled === 1 && Boolean(hook?.url_enc) };
    const endpoints = this.o.store.integrations(tdb).endpoints().length;
    return {
      viaSocket: { connected: webhook.enabled, status: webhook.enabled ? "Sending events" : webhook.configured ? "Address saved, switched off" : "Not connected", settings },
      automations: { webhook, endpoints },
      planned: [
        { name: "The viaSocket flow builder inside Zentro (stages 8.1 and 8.2)", note: "Today you build flows in viaSocket itself and connect them with the webhook address and the incoming endpoints." },
        { name: "Notification channels, report distribution and inbound evidence (8.5)", note: "Not built." },
        { name: "AI-approved integration actions (8.6)", note: "Not built." },
        { name: "Alerts (M91)", note: "Planned for its own later batch." },
      ],
      events: EVENT_CATALOG.map((e) => ({ type: e.type, description: e.description, status: SENDABLE.has(e.type) ? "available" as const : e.recorded ? "recorded" as const : "planned" as const, last30Days: e.recorded ? counts[e.type] ?? 0 : null })),
      steps: [
        "In viaSocket, create a flow that starts with a webhook and copy the address it gives you.",
        "Below, under Send events, paste that address, press Save, and copy the signing secret shown once (it is never shown again).",
        "Switch on the events you want, switch the webhook on, and press Send test event: the delivery log below shows whether viaSocket answered.",
        "To send things INTO Zentro, create an incoming endpoint below, copy its token (shown once) and use the endpoint's address and token in a viaSocket \"send a request\" step.",
      ],
      note: "Available events are sent to your webhook when switched on. Recorded events are kept in Zentro but not sent yet. Planned events do not exist yet.",
    };
  }
}
