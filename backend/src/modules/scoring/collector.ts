import type { TenantDb } from "../../db/tenant.js";
import { KpiRepository, type KpiAssignmentRow, type KpiRow, type MeasurementRow } from "../kpi/repositories/kpi.js";
import { periodEndOf, periodStartOf, type Frequency } from "../kpi/periods.js";
import { currentRows, subjectKeyOf, subjectOfRow } from "../kpi/series.js";
import { OkrRepository, type KeyResultRow, type ObjectiveRow } from "../okr/repositories/okr.js";
import { StructureRepository } from "../organization/repositories/structure.js";
import { PeopleRepository } from "../people/repositories/people.js";
import { addDays } from "../tasks/dates.js";
import { TasksRepository } from "../tasks/repositories/tasks.js";
import type { KeyResultInput, KpiInput, ObjectiveInput, ScoreInputs, TaskInput } from "./engine/types.js";

export interface PeriodInfo { id: string; start: string; end: string; open: boolean }

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

    const okr = new OkrRepository(tdb);
    const krs = new Map<string, KeyResultRow[]>();
    for (const k of okr.keyResults()) krs.set(k.objective_id, [...(krs.get(k.objective_id) ?? []), k]);
    const history = new Map<string, { day: string; value: number }[]>();
    for (const h of okr.allHistory()) if (h.value !== null && h.key_result_id) history.set(h.key_result_id, [...(history.get(h.key_result_id) ?? []), { day: h.recorded_at.slice(0, 10), value: h.value }]);
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
    return { id: o.id, title: o.title, level: o.level, weight: o.weight, lifecycle: o.lifecycle, keyResults };
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

  /** The snapshot for one person. */
  inputsFor(m: string, label: string): ScoreInputs {
    return {
      subject: { type: "membership", id: m, label },
      period: { start: this.period.start, end: this.period.end, open: this.period.open },
      asOf: this.asOf,
      objectives: this.objectivesFor(m),
      kpis: this.kpisFor(m),
      teamKpis: this.teamKpisFor(m),
      tasks: this.tasksFor(m),
      teamTasks: this.teamTasksFor(m),
    };
  }
}
