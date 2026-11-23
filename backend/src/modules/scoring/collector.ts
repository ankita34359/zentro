import type { TenantDb } from "../../db/tenant.js";
import { KpiRepository, type KpiAssignmentRow, type KpiRow, type MeasurementRow } from "../kpi/repositories/kpi.js";
import { periodEndOf, periodStartOf, type Frequency } from "../kpi/periods.js";
import { currentRows, subjectKeyOf, subjectOfRow } from "../kpi/series.js";
import { keyResultAttainment, objectiveAttainment } from "../okr/attainment.js";
import { OkrRepository, type KeyResultRow, type ObjectiveRow } from "../okr/repositories/okr.js";
import { StructureRepository } from "../organization/repositories/structure.js";
import { PeopleRepository } from "../people/repositories/people.js";
import { addDays } from "../tasks/dates.js";
import { TasksRepository } from "../tasks/repositories/tasks.js";
import { objectiveHealth } from "../okr/health.js";
import { ReviewRepository } from "../reviews/repositories/reviews.js";
import { MentorshipRepository, type ActivityRow, type AssignmentRow } from "../mentorship/repositories/mentorship.js";
import { okrProvider } from "./engine/providers/okr.js";
import { roundHalfUp1 } from "./engine/math.js";
import { ScorecardRepository } from "./repositories/scoring.js";
import type { DepartmentInputs, KeyResultInput, KpiInput, ManagementInputs, MentorshipInputs, TeamInputs, MentorshipLink, ObjectiveInput, ScoreInputs, TaskInput } from "./engine/types.js";

export interface PeriodInfo { id: string; start: string; end: string; open: boolean }

const daysBetweenDays = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string): boolean => aStart <= bEnd && aEnd >= bStart;

/**
 * The input collector (docs/scoring-architecture.md section 1): reads the database ONCE for a period and then builds the
 * `ScoreInputs` snapshot of any person, evaluating who they were as of the period end (their designation, the teams they
 * led, the departments they headed). It computes no scores. For an OPEN period "as of" is today; for a closed one the period
 * end, so a past score never changes because of what happened later.
 */
export class Collector {
  readonly asOf: string;
  private readonly people: PeopleRepository;
  private readonly okr: { objectives: ObjectiveRow[]; krs: Map<string, KeyResultRow[]>; history: Map<string, { day: string; value: number }[]>; assignments: ReturnType<OkrRepository["assignments"]> };
  private readonly kpi: { defs: Map<string, KpiRow>; assignments: KpiAssignmentRow[]; current: MeasurementRow[] };
  private readonly designationOf = new Map<string, string | null>();
  private readonly familyOfDesignation = new Map<string, string | null>();
  private readonly ledTeams = new Map<string, Set<string>>();
  private readonly headedDepts = new Map<string, Set<string>>();
  private readonly teamMembers = new Map<string, Set<string>>();
  private readonly tasks: ReturnType<TasksRepository["list"]>;
  private readonly taskAssignees = new Map<string, Set<string>>();
  private readonly cards: ScorecardRepository;
  private readonly names = new Map<string, string>();
  private readonly mentorLinks: { a: AssignmentRow; overlapDays: number }[] = [];
  private readonly activities: ActivityRow[];
  private readonly parentOf = new Map<string, { id: string; weight: number }>();
  private readonly titleOf = new Map<string, string>();
  private readonly reviews: ReviewRepository;
  private readonly structure: StructureRepository;
  private readonly reportRows: ReturnType<PeopleRepository["reportingRows"]>;
  private readonly deptMembers = new Map<string, Set<string>>();
  private readonly cardCache = new Map<string, { periodId: string; start: string; end: string; total: number | null; delivery: number | null; quality: number | null }[]>();

  constructor(tdb: TenantDb, readonly period: PeriodInfo, today: string) {
    this.asOf = period.open || period.end > today ? today : period.end;
    const ref = this.asOf;
    this.people = new PeopleRepository(tdb);
    const structure = new StructureRepository(tdb);
    for (const d of structure.designations()) this.familyOfDesignation.set(d.id, d.role_family_id);
    // the designation each person held on the reference day
    for (const r of this.people.designationRows()) if (r.start_date <= ref && (r.end_date === null || ref < r.end_date)) this.designationOf.set(r.membership_id, r.designation_id);
    for (const p of this.people.people()) if (!this.designationOf.has(p.id) && p.designation_id && p.archived_at === null) this.designationOf.set(p.id, p.designation_id);
    for (const r of this.people.teamRows({ asOf: ref })) {
      this.teamMembers.set(r.team_id, new Set([...(this.teamMembers.get(r.team_id) ?? []), r.membership_id]));
      if (r.membership_type === "lead" || r.membership_type === "deputy_lead") this.ledTeams.set(r.membership_id, new Set([...(this.ledTeams.get(r.membership_id) ?? []), r.team_id]));
    }
    for (const r of this.people.deptRows({ asOf: ref })) if (r.membership_type === "head") this.headedDepts.set(r.membership_id, new Set([...(this.headedDepts.get(r.membership_id) ?? []), r.department_id]));

    this.cards = new ScorecardRepository(tdb);
    this.reviews = new ReviewRepository(tdb);
    this.structure = structure;
    this.reportRows = this.people.reportingRows({ asOf: ref }).filter((r) => r.relationship_type === "primary");
    for (const r of this.people.deptRows({ asOf: ref })) this.deptMembers.set(r.department_id, new Set([...(this.deptMembers.get(r.department_id) ?? []), r.membership_id]));
    for (const p of this.people.people()) this.names.set(p.id, p.display_name);
    const mentorship = new MentorshipRepository(tdb);
    this.activities = mentorship.activities();
    // a paused assignment is not counted: pausing keeps it on record without crediting time nobody was mentoring
    const overlapEnd = [period.end, ref].sort()[0]!;
    for (const a of mentorship.assignments()) {
      if (a.status === "paused") continue;
      const from = a.start_date > period.start ? a.start_date : period.start;
      const lastDay = a.end_date !== null ? addDays(a.end_date, -1) : overlapEnd;
      const to = lastDay < overlapEnd ? lastDay : overlapEnd;
      const overlapDays = to >= from ? daysBetweenDays(from, to) + 1 : 0;
      if (overlapDays > 0) this.mentorLinks.push({ a, overlapDays });
    }

    const okr = new OkrRepository(tdb);
    const krs = new Map<string, KeyResultRow[]>();
    for (const k of okr.keyResults()) krs.set(k.objective_id, [...(krs.get(k.objective_id) ?? []), k]);
    const history = new Map<string, { day: string; value: number }[]>();
    for (const h of okr.allHistory()) if (h.value !== null && h.key_result_id) history.set(h.key_result_id, [...(history.get(h.key_result_id) ?? []), { day: h.recorded_at.slice(0, 10), value: h.value }]);
    for (const o of okr.objectives()) this.titleOf.set(o.id, o.title);
    for (const r of okr.relationships()) this.parentOf.set(r.child_objective_id, { id: r.parent_objective_id, weight: r.contribution_weight });
    this.okr = { objectives: okr.objectives().filter((o) => overlaps(o.start_date, o.end_date, period.start, period.end)), krs, history, assignments: okr.assignments(true) };

    const kpiRepo = new KpiRepository(tdb);
    this.kpi = { defs: new Map(kpiRepo.kpis().map((k) => [k.id, k])), assignments: kpiRepo.assignments(), current: currentRows(kpiRepo.measurements()).filter((m) => m.value_status !== "disputed") };

    const tasksRepo = new TasksRepository(tdb);
    this.tasks = tasksRepo.list({ dueFrom: period.start, dueTo: period.end });
    for (const a of tasksRepo.allAssignments()) if (a.role === "assignee" && a.assignee_membership_id) this.taskAssignees.set(a.task_id, new Set([...(this.taskAssignees.get(a.task_id) ?? []), a.assignee_membership_id]));
  }

  designationOn(m: string): string | null {
    return this.designationOf.get(m) ?? null;
  }
  roleFamilyOn(m: string): string | null {
    const d = this.designationOf.get(m);
    return d ? this.familyOfDesignation.get(d) ?? null : null;
  }
  ledTeamsOf(m: string): string[] {
    return [...(this.ledTeams.get(m) ?? [])];
  }
  headedDepartmentsOf(m: string): string[] {
    return [...(this.headedDepts.get(m) ?? [])];
  }
  membersOfTeam(t: string): string[] {
    return [...(this.teamMembers.get(t) ?? [])];
  }

  // ---------- objectives ----------

  private objectiveInput(o: ObjectiveRow): ObjectiveInput {
    const keyResults: KeyResultInput[] = (this.okr.krs.get(o.id) ?? []).map((k) => {
      // the value recorded on or before the reference day; none recorded by then = no data
      const upTo = (this.okr.history.get(k.id) ?? []).filter((h) => h.day <= this.asOf);
      return { id: k.id, title: k.title, direction: k.direction as "increase" | "decrease", method: k.progress_method as KeyResultInput["method"], start: k.start_value, target: k.target_value, current: upTo.length ? upTo[upTo.length - 1]!.value : null, weight: k.weight };
    });
    const att = objectiveAttainment(keyResults.map((k) => ({ attainment: keyResultAttainment({ direction: k.direction, method: k.method, start: k.start, target: k.target, current: k.current, weight: k.weight }).value, weight: k.weight })));
    const parent = this.parentOf.get(o.id);
    const health = objectiveHealth({ lifecycle: o.lifecycle, startDate: o.start_date, endDate: o.end_date, today: this.asOf, progress: att.value }).health;
    return { id: o.id, title: o.title, level: o.level, weight: o.weight, lifecycle: o.lifecycle, keyResults, start: o.start_date, end: o.end_date, health, parent: parent ? { id: parent.id, title: this.titleOf.get(parent.id) ?? "Objective", weight: parent.weight } : null };
  }
  private objectivesFor(m: string): ScoreInputs["objectives"] {
    const mine = (o: ObjectiveRow): boolean => o.owner_membership_id === m || this.okr.assignments.some((a) => a.objective_id === o.id && a.assignee_membership_id === m && a.start_date <= this.period.end && (a.end_date === null || a.end_date >= this.period.start));
    const led = new Set(this.ledTeamsOf(m));
    const headed = new Set(this.headedDepartmentsOf(m));
    const live = this.okr.objectives.filter((o) => !o.archived_at || o.archived_at.slice(0, 10) > this.period.end);
    return {
      personal: live.filter((o) => o.level === "individual" && mine(o)).map((o) => this.objectiveInput(o)),
      team: live.filter((o) => o.level === "team" && (mine(o) || (o.team_id !== null && led.has(o.team_id)))).map((o) => this.objectiveInput(o)),
      department: live.filter((o) => o.level === "department" && (mine(o) || (o.department_id !== null && headed.has(o.department_id)))).map((o) => this.objectiveInput(o)),
      company: live.filter((o) => o.level === "company" && mine(o)).map((o) => this.objectiveInput(o)),
    };
  }

  // ---------- KPIs ----------

  private kpiInput(a: KpiAssignmentRow, rows: MeasurementRow[], subject: string): KpiInput | null {
    const def = this.kpi.defs.get(a.kpi_id);
    if (!def || def.archived_at) return null;
    const freq = def.frequency as Frequency;
    const winStart = a.effective_from > this.period.start ? a.effective_from : this.period.start;
    const winEnd = a.effective_to !== null && addDays(a.effective_to, -1) < this.asOf ? addDays(a.effective_to, -1) : this.asOf;
    if (winStart > winEnd || winStart > this.period.end) return null;
    // the periods of the KPI's frequency that have fully ended inside the window: those are the values it should have
    const expected: string[] = [];
    for (let st = periodStartOf(freq, winStart); periodEndOf(freq, st) <= winEnd && expected.length < 400; st = addDays(periodEndOf(freq, st), 1)) expected.push(st);
    const want = new Set(expected);
    const mine = rows.filter((r) => r.kpi_id === def.id && subjectKeyOf(subjectOfRow(r)) === subject && want.has(r.period_start)).sort((x, y) => x.period_start.localeCompare(y.period_start));
    return { assignmentId: a.id, kpiId: def.id, name: def.name, category: def.category, unit: def.unit, direction: def.direction as KpiInput["direction"], aggregation: def.aggregation as KpiInput["aggregation"], target: a.target_value, targetMax: a.target_max, weight: a.weight, expectedPeriods: expected.length, values: mine.map((r) => ({ period: r.period_start, value: r.value })) };
  }
  private kpisFor(m: string): KpiInput[] {
    const des = this.designationOn(m);
    const fam = this.roleFamilyOn(m);
    const out: KpiInput[] = [];
    const seen = new Set<string>();
    // most specific first: a person's own assignment of a KPI wins over a designation's, which wins over a role family's
    const rank = (a: KpiAssignmentRow): number => (a.membership_id === m ? 0 : a.designation_id ? 1 : 2);
    const mineA = this.kpi.assignments.filter((a) => a.membership_id === m || (des !== null && a.designation_id === des) || (fam !== null && a.role_family_id === fam)).sort((x, y) => rank(x) - rank(y));
    for (const a of mineA) {
      if (seen.has(a.kpi_id)) continue;
      const k = this.kpiInput(a, this.kpi.current, `person:${m}`);
      if (k) {
        seen.add(a.kpi_id);
        out.push(k);
      }
    }
    return out;
  }
  private teamKpisFor(m: string): KpiInput[] {
    const led = new Set(this.ledTeamsOf(m));
    const out: KpiInput[] = [];
    for (const a of this.kpi.assignments) {
      if (a.team_id === null || !led.has(a.team_id)) continue;
      const k = this.kpiInput(a, this.kpi.current, `team:${a.team_id}`);
      if (k) out.push(k);
    }
    return out;
  }

  // ---------- tasks ----------

  private taskInput(t: ReturnType<TasksRepository["list"]>[number]): TaskInput {
    const doneOn = t.status === "completed" && t.completed_at !== null ? t.completed_at.slice(0, 10) : null;
    const done = doneOn !== null && doneOn <= this.asOf; // finished AFTER the reference day = not finished then
    return { id: t.id, title: t.title, importance: t.importance_weight, priority: t.priority as TaskInput["priority"], dueAt: t.due_at!, status: done ? "completed" : t.status === "cancelled" ? "cancelled" : "in_progress", completedOn: done ? doneOn : null, estimatedMinutes: t.estimated_minutes, actualMinutes: t.actual_minutes > 0 ? t.actual_minutes : null, quality: done ? t.outcome_quality : null };
  }
  private tasksFor(m: string): TaskInput[] {
    return this.tasks.filter((t) => t.due_at !== null && !t.archived_at && (this.taskAssignees.get(t.id)?.has(m) ?? false)).map((t) => this.taskInput(t));
  }
  private teamTasksFor(m: string): TaskInput[] {
    const led = this.ledTeamsOf(m);
    if (led.length === 0) return [];
    const members = new Set(led.flatMap((t) => this.membersOfTeam(t)));
    const teams = new Set(led);
    return this.tasks.filter((t) => t.due_at !== null && !t.archived_at && ((t.team_id !== null && teams.has(t.team_id)) || [...(this.taskAssignees.get(t.id) ?? [])].some((a) => members.has(a)))).map((t) => this.taskInput(t));
  }

  // ---------- mentorship ----------

  /** A score was just written for this person: what was remembered about their scores is out of date. */
  forget(m: string): void {
    this.cardCache.delete(m);
  }

  /** How many people are (directly or further down) under this person: leaders are scored after the people they answer for. */
  private reachMemo = new Map<string, number>();
  reach(m: string): number {
    const known = this.reachMemo.get(m);
    if (known !== undefined) return known;
    const seen = new Set<string>([m]);
    const queue = [m];
    while (queue.length > 0) {
      const next = queue.pop()!;
      const below = [...this.answerableFor(next), ...this.headedDepartmentsOf(next).flatMap((d) => [...(this.deptMembers.get(d) ?? [])])];
      for (const x of below) if (!seen.has(x)) { seen.add(x); queue.push(x); }
    }
    this.reachMemo.set(m, seen.size - 1);
    return seen.size - 1;
  }

  /** True for people who mentor someone in this period: their mentees' scores must be calculated before theirs. */
  mentorsAnyone(m: string): boolean {
    return this.mentorLinks.some((l) => l.a.mentor_membership_id === m);
  }

  /** The mentee's latest total (and the delivery and quality parts) in each period they have a score for. */
  private scoresOfMentee(mentee: string) {
    const cached = this.cardCache.get(mentee);
    if (cached) return cached;
    const periods = new Map(this.cards.periods().map((p) => [p.id, p]));
    const out: { periodId: string; start: string; end: string; total: number | null; delivery: number | null; quality: number | null }[] = [];
    for (const c of this.cards.scorecardsOfSubject(`m:${mentee}`)) {
      const p = periods.get(c.period_id);
      if (!p || !c.latest_score_id) continue;
      const comps = this.cards.componentsOf(c.latest_score_id);
      const score = this.cards.scoresOf(c.id).find((x) => x.id === c.latest_score_id);
      const part = (provider: string): number | null => comps.find((k) => k.provider_key === provider)?.normalized_score ?? null;
      out.push({ periodId: p.id, start: p.start_date, end: p.end_date, total: score?.total_score ?? null, delivery: part("tasks.delivery"), quality: part("quality.impact") });
    }
    out.sort((x, y) => x.start.localeCompare(y.start));
    this.cardCache.set(mentee, out);
    return out;
  }

  private goalAchievement(mentee: string): number | null {
    const dev = this.okr.objectives.filter((o) => o.level === "individual" && o.objective_type === "development" && o.owner_membership_id === mentee && (!o.archived_at || o.archived_at.slice(0, 10) > this.period.end)).map((o) => this.objectiveInput(o));
    const r = okrProvider(dev, 1, "development");
    return r.state === "ok" ? r.value : null;
  }

  private linkOf(l: { a: AssignmentRow; overlapDays: number }, counterpart: string, mentee: string): MentorshipLink {
    const mentorCount = this.mentorLinks.filter((x) => x.a.mentee_membership_id === mentee).length;
    const scores = this.scoresOfMentee(mentee);
    const current = scores.find((s) => s.periodId === this.period.id && s.total !== null) ?? null;
    // baseline: the last score from before the assignment started, else the first one inside it; always from an EARLIER period than this one
    const earlier = scores.filter((s) => s.total !== null && s.start < this.period.start);
    const baseline = [...earlier].reverse().find((s) => s.end < l.a.start_date) ?? earlier.find((s) => s.start >= l.a.start_date) ?? null;
    const both = current !== null && baseline !== null;
    const diff = (a: number | null | undefined, b: number | null | undefined): number | null => (both && a !== null && a !== undefined && b !== null && b !== undefined ? roundHalfUp1(a - b) : null);
    const acts = this.activities.filter((x) => x.assignment_id === l.a.id && x.occurred_on >= (l.a.start_date > this.period.start ? l.a.start_date : this.period.start) && x.occurred_on <= [this.period.end, this.asOf].sort()[0]!).length;
    return {
      assignmentId: l.a.id, counterpart: { id: counterpart, name: this.names.get(counterpart) ?? "Former member" }, overlapDays: l.overlapDays, mentorCount, baselineScore: baseline?.total ?? null, currentScore: current?.total ?? null,
      scoreDelta: diff(current?.total, baseline?.total), deliveryDelta: diff(current?.delivery, baseline?.delivery), qualityDelta: diff(current?.quality, baseline?.quality), goalAchievement: this.goalAchievement(mentee), activities: acts, cadenceDays: l.a.cadence_days,
    };
  }

  /** The mentor's view of one assignment (the counterpart is the mentee), or null when it does not count in this period. */
  assignmentLink(assignmentId: string): MentorshipLink | null {
    const l = this.mentorLinks.find((x) => x.a.id === assignmentId);
    return l ? this.linkOf(l, l.a.mentee_membership_id, l.a.mentee_membership_id) : null;
  }
  mentorIds(): string[] {
    return [...new Set(this.mentorLinks.map((l) => l.a.mentor_membership_id))];
  }

  mentorshipFor(m: string): MentorshipInputs {
    return {
      asMentor: this.mentorLinks.filter((l) => l.a.mentor_membership_id === m).map((l) => this.linkOf(l, l.a.mentee_membership_id, l.a.mentee_membership_id)),
      asMentee: this.mentorLinks.filter((l) => l.a.mentee_membership_id === m).map((l) => this.linkOf(l, l.a.mentor_membership_id, m)),
    };
  }

  // ---------- leadership (stage 5.6) ----------

  private directReports(m: string): string[] {
    return this.reportRows.filter((r) => r.manager_membership_id === m).map((r) => r.subordinate_membership_id);
  }
  /** The people someone answers for: their direct reports and the members of the teams they lead. */
  private answerableFor(m: string): string[] {
    const set = new Set<string>(this.directReports(m));
    for (const t of this.ledTeamsOf(m)) for (const x of this.membersOfTeam(t)) set.add(x);
    set.delete(m);
    return [...set];
  }
  private totalIn(person: string, periodId: string): number | null {
    return this.scoresOfMentee(person).find((s) => s.periodId === periodId)?.total ?? null;
  }
  private baselineTotal(person: string): number | null {
    const earlier = this.scoresOfMentee(person).filter((s) => s.start < this.period.start && s.total !== null);
    return earlier.length ? earlier[earlier.length - 1]!.total : null;
  }
  teamFor(m: string): TeamInputs {
    return { members: this.answerableFor(m).map((p) => ({ baseline: this.baselineTotal(p), current: this.totalIn(p, this.period.id) })) };
  }
  departmentFor(m: string): DepartmentInputs {
    const names = new Map(this.structure.departments().map((d) => [d.id, d.name]));
    return {
      departments: this.headedDepartmentsOf(m).map((d) => {
        const totals = [...(this.deptMembers.get(d) ?? [])].filter((p) => p !== m).map((p) => this.totalIn(p, this.period.id)).filter((x): x is number => x !== null);
        return { name: names.get(d) ?? "Department", people: totals.length, mean: totals.length ? Math.round((totals.reduce((a, b) => a + b, 0) / totals.length) * 10) / 10 : null };
      }),
    };
  }
  managementFor(m: string, graceDays = 14): ManagementInputs {
    const due = addDays(this.period.end, graceDays);
    const mine = new Map(this.reviews.forPeriod(this.period.id).filter((r) => r.reviewer_membership_id === m && r.status !== "draft" && r.submitted_at !== null).map((r) => [r.subject_membership_id, r.submitted_at as string]));
    return { reports: this.directReports(m).map((p) => ({ submitted: mine.has(p), onTime: (mine.get(p) ?? "9999").slice(0, 10) <= due })), graceDays, periodOpen: this.period.open };
  }
  orgFor(): { objectives: ObjectiveInput[] } {
    return { objectives: this.okr.objectives.filter((o) => (o.level === "company" || o.level === "department") && (!o.archived_at || o.archived_at.slice(0, 10) > this.period.end)).map((o) => this.objectiveInput(o)) };
  }

  /**
   * The snapshot for one person. `needs` are the provider keys of the model that will score it: only the sections those providers
   * read are collected (mentorship, team, management, department, organization), so a snapshot holds what the score used and no more.
   */
  inputsFor(m: string, label: string, needs?: ReadonlySet<string>): ScoreInputs {
    const want = (prefix: string): boolean => (needs ? [...needs].some((k) => k.startsWith(prefix)) : false);
    const extra: NonNullable<ScoreInputs["extra"]> = {};
    if (want("mentorship.")) extra.mentorship = this.mentorshipFor(m);
    if (want("team.development")) extra.team = this.teamFor(m);
    if (want("mgmt.")) extra.management = this.managementFor(m);
    if (want("dept.team_performance")) extra.department = this.departmentFor(m);
    if (want("org.health")) extra.org = this.orgFor();
    return {
      subject: { type: "membership", id: m, label },
      period: { start: this.period.start, end: this.period.end, open: this.period.open },
      asOf: this.asOf,
      objectives: this.objectivesFor(m),
      kpis: this.kpisFor(m),
      teamKpis: this.teamKpisFor(m),
      tasks: this.tasksFor(m),
      teamTasks: this.teamTasksFor(m),
      ...(Object.keys(extra).length > 0 ? { extra } : {}),
    };
  }
}
