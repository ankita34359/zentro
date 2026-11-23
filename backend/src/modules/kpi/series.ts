import type { TenantDb } from "../../db/tenant.js";
import { newId } from "../../lib/ids.js";
import { AutomationEventsRepository } from "../automation/repositories/events.js";
import { deliverNotification } from "../notifications/service.js";
import { NotificationsRepository } from "../notifications/repositories/notifications.js";
import { loadDirectory, type Directory } from "./directory.js";
import { aggregate, coverage, kpiAttainment, levelOf, statusOf, type Aggregation, type KpiDirection, type SeriesStatus, type Threshold } from "./measure.js";
import { completedPeriods, LOOKBACK, periodLabel, type Frequency } from "./periods.js";
import { KpiRepository, type KpiAssignmentRow, type KpiRow, type MeasurementRow } from "./repositories/kpi.js";

export type SubjectKind = "person" | "team" | "department" | "organization";
export interface SubjectKey { kind: SubjectKind; id: string | null }
export const subjectKeyOf = (s: SubjectKey): string => `${s.kind}:${s.id ?? ""}`;
export const subjectOfRow = (m: MeasurementRow): SubjectKey => (m.subject_membership_id ? { kind: "person", id: m.subject_membership_id } : m.subject_team_id ? { kind: "team", id: m.subject_team_id } : m.subject_department_id ? { kind: "department", id: m.subject_department_id } : { kind: "organization", id: null });

/** The current rows: those no other row supersedes. */
export function currentRows(rows: readonly MeasurementRow[]): MeasurementRow[] {
  const replaced = new Set(rows.map((r) => r.supersedes_measurement_id).filter((x): x is string => x !== null));
  return rows.filter((r) => !replaced.has(r.id));
}

export interface Target { assignmentId: string; targetValue: number; targetMax: number | null; weight: number }
export interface Series {
  kpi: KpiRow;
  subject: SubjectKey;
  target: Target | null;
  status: SeriesStatus;
  /** The newest period that has a current value. */
  latest: { periodStart: string; label: string; value: number; attainment: number | null } | null;
  expected: number;
  present: number;
  missing: string[];
  coverage: number | null;
}

/** Everything the series are built from. Loaded once per request or job run. */
export function loadSeriesInput(tdb: TenantDb, today: string) {
  const repo = new KpiRepository(tdb);
  const dir = loadDirectory(tdb, today);
  const kpis = repo.kpis();
  return { today, kpis, assignments: repo.assignments(), thresholds: repo.thresholds(), measurements: repo.measurements(), dir };
}
export type SeriesInput = ReturnType<typeof loadSeriesInput>;

const SPECIFICITY: Record<string, number> = { person: 0, designation: 1, role_family: 2, team: 0, department: 0 };

/** One series per KPI and subject: who is expected to have a value, which periods are missing, and where the latest value stands. */
export function buildSeries(input: SeriesInput): Series[] {
  const out: Series[] = [];
  for (const kpi of input.kpis) {
    const freq = kpi.frequency as Frequency;
    const thresholds = input.thresholds.filter((t) => t.kpi_id === kpi.id).map((t): Threshold => ({ level: t.level as Threshold["level"], comparator: t.comparator as Threshold["comparator"], basis: t.basis as Threshold["basis"], value: t.value }));
    const rows = currentRows(input.measurements.filter((m) => m.kpi_id === kpi.id));
    const bySubject = new Map<string, MeasurementRow[]>();
    for (const r of rows) bySubject.set(subjectKeyOf(subjectOfRow(r)), [...(bySubject.get(subjectKeyOf(subjectOfRow(r))) ?? []), r]);
    // who has the KPI today, with which target (the most specific assignment wins for a person)
    const active = input.assignments.filter((a) => a.kpi_id === kpi.id && a.effective_from <= input.today && (a.effective_to === null || a.effective_to > input.today));
    const targets = new Map<string, { key: SubjectKey; a: KpiAssignmentRow; spec: number }>();
    const put = (key: SubjectKey, a: KpiAssignmentRow, spec: number): void => {
      const k = subjectKeyOf(key);
      const have = targets.get(k);
      if (!have || spec < have.spec) targets.set(k, { key, a, spec });
    };
    for (const a of active) {
      if (a.team_id) put({ kind: "team", id: a.team_id }, a, 0);
      else if (a.department_id) put({ kind: "department", id: a.department_id }, a, 0);
      else for (const m of input.dir.holders(a)) put({ kind: "person", id: m }, a, SPECIFICITY[a.membership_id ? "person" : a.designation_id ? "designation" : "role_family"]!);
    }
    const subjects = new Map<string, SubjectKey>([...targets].map(([k, v]) => [k, v.key]));
    for (const [k, rs] of bySubject) if (!subjects.has(k)) subjects.set(k, subjectOfRow(rs[0]!)); // measured but not assigned (an organization total, or an ended assignment)
    for (const [k, key] of subjects) {
      const t = targets.get(k);
      const mine = (bySubject.get(k) ?? []).sort((x, y) => x.period_start.localeCompare(y.period_start));
      const target: Target | null = t ? { assignmentId: t.a.id, targetValue: t.a.target_value, targetMax: t.a.target_max, weight: t.a.weight } : null;
      const have = new Set(mine.map((r) => r.period_start));
      const expectedPeriods = t ? completedPeriods(freq, input.today, LOOKBACK[freq], t.a.effective_from) : [];
      const missing = expectedPeriods.filter((p) => !have.has(p));
      const newest = mine.at(-1);
      const latest = newest ? { periodStart: newest.period_start, label: periodLabel(freq, newest.period_start), value: newest.value, attainment: kpiAttainment(kpi.direction as KpiDirection, newest.value, target?.targetValue ?? null, target?.targetMax ?? null) } : null;
      if (!t && !newest) continue;
      out.push({
        kpi, subject: key, target,
        status: statusOf(newest?.value ?? null, target?.targetValue ?? null, thresholds),
        latest, expected: expectedPeriods.length, present: expectedPeriods.length - missing.length, missing, coverage: coverage(expectedPeriods.length - missing.length, expectedPeriods.length),
      });
    }
  }
  return out;
}

/** The aggregate of a series' current values over the periods from `from` to `to` (used by scoring later; shown on the KPI's page). */
export function windowValue(kpi: KpiRow, rows: readonly MeasurementRow[], from: string, to: string): number | null {
  return aggregate(rows.filter((r) => r.period_start >= from && r.period_start <= to && r.value_status !== "disputed").sort((a, b) => a.period_start.localeCompare(b.period_start)).map((r) => r.value), kpi.aggregation as Aggregation);
}

// ---------- alerts: the same facts, written once ----------

const subjectLabel = (dir: Directory, s: SubjectKey): string => (s.kind === "person" ? dir.names.get(s.id!) ?? "Former member" : s.kind === "team" ? dir.teams.get(s.id!)?.name ?? "Team" : s.kind === "department" ? dir.depts.get(s.id!)?.name ?? "Department" : "the organization");
export { subjectLabel };

/**
 * Tells the right people (and writes the business event) when a series' latest value sits at a warning or critical level, and when
 * its most recent completed period has no value. Every notice and event has a dedupe key (KPI, subject, period, level), so running
 * this on every write and every hour never repeats a notice. Returns how many notices were created.
 */
export function applySeriesAlerts(tdb: TenantDb, input: SeriesInput, series: readonly Series[], nowIso: string, opts: { missed: boolean }): number {
  const events = new AutomationEventsRepository(tdb);
  const notes = new NotificationsRepository(tdb);
  const thresholdsOf = (kpiId: string) => input.thresholds.filter((t) => t.kpi_id === kpiId);
  let created = 0;
  for (const s of series) {
    const subj = subjectKeyOf(s.subject);
    const who = subjectLabel(input.dir, s.subject);
    const recipients = input.dir.listeners(s.subject.kind, s.subject.id);
    const unit = s.kpi.unit ? ` ${s.kpi.unit}` : "";
    if ((s.status === "warning" || s.status === "critical") && s.latest) {
      const th = thresholdsOf(s.kpi.id).find((t) => t.level === s.status);
      const key = `kpi.threshold:${s.kpi.id}:${subj}:${s.latest.periodStart}:${s.status}`;
      const pct = s.target && s.target.targetValue > 0 ? ` (${Math.round((s.latest.value / s.target.targetValue) * 100)}% of the target ${s.target.targetValue})` : "";
      events.insert({ id: newId(), eventType: "kpi.threshold", entityType: "kpi", entityId: s.kpi.id, actorId: null, payloadJson: JSON.stringify({ kpiId: s.kpi.id, subject: subj, period: s.latest.periodStart, level: s.status, value: s.latest.value }), dedupeKey: key, now: nowIso });
      if (th && th.notify === 1 && recipients.length > 0) {
        created += deliverNotification(notes, { recipients, type: "kpi.threshold", title: `${s.status === "critical" ? "Critical" : "Warning"}: ${s.kpi.name}${s.subject.kind === "person" ? ` (${who})` : ` for ${who}`}`, body: `${s.latest.label}: ${s.latest.value}${unit}${pct}.`, severity: s.status === "critical" ? "critical" : "warning", entityType: "kpi", entityId: s.kpi.id, dedupeKey: key }, nowIso);
      }
    }
    if (opts.missed && s.target) {
      const last = completedPeriods(s.kpi.frequency as Frequency, input.today, 1, input.assignments.find((a) => a.id === s.target!.assignmentId)?.effective_from)[0];
      if (last && s.missing.includes(last) && recipients.length > 0) {
        const key = `kpi.missed:${s.kpi.id}:${subj}:${last}`;
        events.insert({ id: newId(), eventType: "kpi.measurement_missed", entityType: "kpi", entityId: s.kpi.id, actorId: null, payloadJson: JSON.stringify({ kpiId: s.kpi.id, subject: subj, period: last }), dedupeKey: key, now: nowIso });
        created += deliverNotification(notes, { recipients, type: "kpi.missing", title: `No value yet: ${s.kpi.name}${s.subject.kind === "person" ? ` (${who})` : ` for ${who}`}`, body: `${periodLabel(s.kpi.frequency as Frequency, last)} has ended and no value was recorded.`, severity: "info", entityType: "kpi", entityId: s.kpi.id, dedupeKey: key }, nowIso);
      }
    }
  }
  return created;
}
