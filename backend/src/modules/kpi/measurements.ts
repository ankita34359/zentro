import type { TenantCtx } from "../../db/tenant.js";
import { HttpError, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import type { AuditService } from "../audit/service.js";
import type { AuthStore } from "../auth/repositories/store.js";
import type { AuthContext, AuthService } from "../auth/service.js";
import { EventWriter } from "../automation/events.js";
import type { ScopeSet } from "../permissions/resolver.js";
import type { Capabilities } from "../permissions/service.js";
import { todayIn } from "../tasks/dates.js";
import type { Directory } from "./directory.js";
import { kpiAttainment, levelOf, type KpiDirection, type SeriesStatus, type Threshold } from "./measure.js";
import { completedPeriods, isPeriodStart, LOOKBACK, periodEndOf, periodLabel, periodStarts, periodStartOf, type Frequency } from "./periods.js";
import type { KpiRow, MeasurementRow } from "./repositories/kpi.js";
import { applySeriesAlerts, buildSeries, currentRows, loadSeriesInput, subjectKeyOf, subjectLabel, subjectOfRow, type Series, type SubjectKey, type SubjectKind } from "./series.js";

export interface SubjectView { kind: SubjectKind; id: string | null; name: string }
export interface MeasurementRowView { id: string; value: number; valueStatus: string; recordedAt: string; recordedBy: { id: string; name: string } | null; source: string; note: string | null; current: boolean; supersedes: string | null }
export interface PeriodView {
  start: string;
  end: string;
  label: string;
  /** recorded (has a current value), missing (the period has ended and has none), open (still running, no value yet) or not_expected (before the KPI was assigned). */
  state: "recorded" | "missing" | "open" | "not_expected";
  value: number | null;
  valueStatus: string | null;
  attainmentPct: number | null;
  level: "excellent" | "warning" | "critical" | null;
  corrections: number;
  rows: MeasurementRowView[];
}
export interface HistoryView {
  kpi: { id: string; name: string; unit: string | null; frequency: string; direction: string; aggregation: string };
  subject: SubjectView;
  target: { targetValue: number; targetMax: number | null; weight: number } | null;
  /** Thresholds as lines on the chart, in the KPI's own unit (a percentage of the target is converted using the target). */
  lines: { level: string; comparator: string; value: number }[];
  periods: PeriodView[];
  expected: number;
  present: number;
  missingCount: number;
  coveragePct: number | null;
  status: SeriesStatus;
  can: { record: boolean };
}
export interface OverviewView {
  totals: { series: number; byStatus: Record<string, number>; missingPeriods: number; kpis: number };
  kpis: { id: string; name: string; category: string; frequency: string; series: number; byStatus: Record<string, number>; missingPeriods: number; coveragePct: number | null }[];
  attention: { kpiId: string; kpiName: string; subject: SubjectView; status: SeriesStatus; label: string; value: number | null; missing: number }[];
}
export interface MeasurementInput {
  subject: { type: SubjectKind; id?: string };
  periodStart: string;
  value: number;
  valueStatus?: string;
  note?: string;
  supersedes?: string;
}

const isDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * KPI measurements (stage 3.4). Append only: a value is recorded for a SUBJECT (a person, team, department, or the organization)
 * and a PERIOD of the KPI's frequency. A second value for the same period is refused unless it says which row it corrects, and
 * a correction needs a reason; the old row stays, marked as replaced. A period with no row is MISSING and is shown as missing,
 * never as zero. Who may see or record a value follows the subject: people, teams and departments in scope, yourself, and the
 * organization total only over everyone.
 */
export class MeasurementService {
  constructor(private readonly o: { store: AuthStore; auth: AuthService; audit: AuditService; events: EventWriter }) {}

  private ctx(auth: AuthContext, requestId: string): TenantCtx {
    return this.o.auth.tenantCtx(auth, requestId);
  }
  private now = (): string => this.o.auth.iso();
  private world(ctx: TenantCtx) {
    const tdb = this.o.store.tenant(ctx);
    const org = this.o.store.orgs.findById(ctx.organizationId);
    const today = todayIn(org?.timezone ?? "UTC", new Date(this.now()));
    const input = loadSeriesInput(tdb, today);
    return { tdb, repo: this.o.store.kpi(tdb), today, input, dir: input.dir };
  }

  // ---------- who may see and record what ----------

  private sees(dir: Directory, scope: ScopeSet, me: string, s: SubjectKey): boolean {
    if (scope.all) return true;
    if (s.kind === "organization") return false;
    if (s.kind === "person") return s.id === me || scope.members.has(s.id!);
    if (s.kind === "team") return scope.teams.has(s.id!) || (dir.teamMembers.get(s.id!)?.has(me) ?? false);
    return scope.departments.has(s.id!) || (dir.deptMembers.get(s.id!)?.has(me) ?? false);
  }
  private records(scope: ScopeSet, me: string, s: SubjectKey): boolean {
    if (scope.all) return true;
    if (s.kind === "organization") return false;
    if (s.kind === "person") return s.id === me || scope.members.has(s.id!);
    if (s.kind === "team") return scope.teams.has(s.id!);
    return scope.departments.has(s.id!);
  }
  private requireView(caps: Capabilities): ScopeSet {
    if (!caps.has("kpi.view")) throw new HttpError(403, "permission_denied", "Not allowed");
    return caps.scope("kpi.view");
  }
  private subjectView(dir: Directory, s: SubjectKey): SubjectView {
    return { kind: s.kind, id: s.id, name: s.kind === "organization" ? "The whole organization" : subjectLabel(dir, s) };
  }
  /** Checks the subject exists in this organization (a missing or foreign id is a 404). */
  private resolveSubject(dir: Directory, raw: { type: string; id?: string | null }): SubjectKey {
    if (raw.type === "organization") return { kind: "organization", id: null };
    if (!raw.id) throw new HttpError(400, "validation_failed", "Request did not pass validation", [{ path: "subject.id", message: "Say which person, team or department" }]);
    if (raw.type === "person") {
      if (!dir.names.has(raw.id)) throw notFound();
      return { kind: "person", id: raw.id };
    }
    if (raw.type === "team") {
      if (!dir.teams.has(raw.id)) throw notFound();
      return { kind: "team", id: raw.id };
    }
    if (raw.type === "department") {
      if (!dir.depts.has(raw.id)) throw notFound();
      return { kind: "department", id: raw.id };
    }
    throw new HttpError(400, "invalid_value", "A subject is a person, team, department or organization.");
  }
  private seriesFor(input: ReturnType<MeasurementService["world"]>["input"], kpiId: string, s: SubjectKey): Series | undefined {
    return buildSeries(input).find((x) => x.kpi.id === kpiId && subjectKeyOf(x.subject) === subjectKeyOf(s));
  }

  // ---------- recording ----------

  record(auth: AuthContext, requestId: string, caps: Capabilities, kpiId: string, input: MeasurementInput): HistoryView {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const me = ctx.membershipId;
    const viewScope = this.requireView(caps);
    const k = w.repo.kpi(kpiId);
    if (!k) throw notFound();
    const subject = this.resolveSubject(w.dir, input.subject);
    if (!this.sees(w.dir, viewScope, me, subject)) throw notFound();
    if (k.archived_at) throw new HttpError(409, "archived", "This KPI is archived.");
    if (!caps.has("kpi.record")) throw new HttpError(403, "permission_denied", "You cannot record KPI values.");
    if (!this.records(caps.scope("kpi.record"), me, subject)) throw new HttpError(403, "outside_scope", subject.kind === "organization" ? "The organization's own values need permission over everyone." : "You can record values for people, teams and departments in your scope, and your own.");
    const freq = k.frequency as Frequency;
    if (!isDay(input.periodStart) || !isPeriodStart(freq, input.periodStart)) throw new HttpError(400, "invalid_period", `A ${freq} KPI is recorded for a whole period, named by its first day (for example ${periodStartOf(freq, w.today)}).`);
    if (input.periodStart > w.today) throw new HttpError(400, "future_period", "That period has not started yet.");
    if (!Number.isFinite(input.value) || Math.abs(input.value) > 1e12) throw new HttpError(400, "invalid_number", "The value must be a number.");
    const valueStatus = input.valueStatus ?? "recorded";
    if (!["recorded", "estimated", "disputed"].includes(valueStatus)) throw new HttpError(400, "invalid_value", "A value is recorded, estimated or disputed.");
    const note = (input.note ?? "").trim();
    if (note.length > 1000) throw new HttpError(400, "invalid_text", "The note is at most 1000 characters.");
    const key = subjectKeyOf(subject);
    const rows = currentRows(w.repo.measurements(kpiId)).filter((r) => subjectKeyOf(subjectOfRow(r)) === key && r.period_start === input.periodStart);
    const existing = rows[0];
    if (existing && !input.supersedes) throw new HttpError(409, "period_recorded", `A value is already recorded for ${periodLabel(freq, input.periodStart)}. To change it, record a correction that names it, with a reason.`, { currentId: existing.id });
    if (input.supersedes) {
      const target = w.repo.measurement(input.supersedes);
      if (!target || target.kpi_id !== kpiId) throw notFound();
      if (!existing || existing.id !== target.id) throw new HttpError(409, "not_current", "That value has already been corrected, or belongs to another period or subject. Correct the current one.", { currentId: existing?.id ?? null });
      if (!note) throw new HttpError(400, "reason_required", "Say why the value is being corrected.");
    }
    const series = this.seriesFor(w.input, kpiId, subject);
    const id = newId();
    const nowIso = this.now();
    this.o.store.transaction(() => {
      w.repo.insertMeasurement({
        id, kpiId, assignmentId: series?.target?.assignmentId ?? null, membershipId: subject.kind === "person" ? subject.id : null, teamId: subject.kind === "team" ? subject.id : null, departmentId: subject.kind === "department" ? subject.id : null,
        periodStart: input.periodStart, periodEnd: periodEndOf(freq, input.periodStart), value: input.value, valueStatus, by: me, source: "manual", note: note || null, supersedesId: input.supersedes ?? null, now: nowIso,
      });
      const who = this.subjectView(w.dir, subject).name;
      this.o.audit.record(w.tdb, ctx, {
        action: input.supersedes ? "kpi.measurement_correct" : "kpi.measurement",
        entityType: "kpi",
        entityId: kpiId,
        summary: input.supersedes ? `Corrected the value of "${k.name}" for ${who}, ${periodLabel(freq, input.periodStart)}: ${existing!.value} → ${input.value}` : `Recorded ${input.value}${k.unit ? ` ${k.unit}` : ""} for "${k.name}", ${who}, ${periodLabel(freq, input.periodStart)}`,
        before: input.supersedes ? { value: existing!.value } : null,
        after: { value: input.value, period: input.periodStart, status: valueStatus },
      });
      this.o.events.record(w.tdb, ctx, { eventType: "kpi.measurement_recorded", entityType: "kpi", entityId: kpiId, dedupeKey: `kpi.measurement:${id}`, payload: { kpiId, subject: key, period: input.periodStart, value: input.value, correction: !!input.supersedes } });
      // thresholds are checked on every write (the hourly job checks again)
      const fresh = loadSeriesInput(w.tdb, w.today);
      const mine = buildSeries(fresh).filter((x) => x.kpi.id === kpiId && subjectKeyOf(x.subject) === key);
      applySeriesAlerts(w.tdb, fresh, mine, nowIso, { missed: false });
    });
    return this.history(auth, requestId, caps, kpiId, { subject: key });
  }

  // ---------- reading ----------

  /** `subject` is "person:<id>", "team:<id>", "department:<id>" or "organization". */
  history(auth: AuthContext, requestId: string, caps: Capabilities, kpiId: string, q: { subject: string; from?: string; to?: string }): HistoryView {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const scope = this.requireView(caps);
    const k = w.repo.kpi(kpiId);
    if (!k || (k.archived_at && !caps.scope("kpi.configure").all)) throw notFound();
    const [type, id] = q.subject.split(":");
    const subject = this.resolveSubject(w.dir, { type: type ?? "", id: id || undefined });
    if (!this.sees(w.dir, scope, ctx.membershipId, subject)) throw notFound();
    const freq = k.frequency as Frequency;
    const key = subjectKeyOf(subject);
    const all = w.repo.measurements(kpiId).filter((r) => subjectKeyOf(subjectOfRow(r)) === key);
    const currentIds = new Set(currentRows(all).map((r) => r.id));
    const series = this.seriesFor(w.input, kpiId, subject);
    const target = series?.target ?? null;
    const asg = target ? w.input.assignments.find((a) => a.id === target.assignmentId) : undefined;
    const thresholds = w.input.thresholds.filter((t) => t.kpi_id === kpiId);
    const typed: Threshold[] = thresholds.map((t) => ({ level: t.level as Threshold["level"], comparator: t.comparator as Threshold["comparator"], basis: t.basis as Threshold["basis"], value: t.value }));
    const defaultFrom = completedPeriods(freq, w.today, LOOKBACK[freq])[0] ?? periodStartOf(freq, w.today);
    const earliestRow = all[0]?.period_start;
    const from = q.from && isDay(q.from) ? q.from : earliestRow && earliestRow < defaultFrom ? earliestRow : defaultFrom;
    const to = q.to && isDay(q.to) ? q.to : w.today;
    const firstExpected = asg?.effective_from ?? earliestRow ?? null;
    const currentStart = periodStartOf(freq, w.today);
    let expected = 0;
    let present = 0;
    const periods: PeriodView[] = periodStarts(freq, from, to, 120).map((start) => {
      const rows = all.filter((r) => r.period_start === start);
      const cur = rows.find((r) => currentIds.has(r.id));
      const end = periodEndOf(freq, start);
      const completed = end < w.today;
      const isExpected = completed && firstExpected !== null && end >= firstExpected;
      if (isExpected) {
        expected += 1;
        if (cur) present += 1;
      }
      return {
        start, end, label: periodLabel(freq, start),
        state: cur ? "recorded" : start >= currentStart ? "open" : isExpected ? "missing" : "not_expected",
        value: cur?.value ?? null, valueStatus: cur?.value_status ?? null,
        attainmentPct: cur && kpiAttainment(k.direction as KpiDirection, cur.value, target?.targetValue ?? null, target?.targetMax ?? null) !== null ? Math.round(kpiAttainment(k.direction as KpiDirection, cur.value, target?.targetValue ?? null, target?.targetMax ?? null)! * 100) : null,
        level: cur ? levelOf(cur.value, target?.targetValue ?? null, typed) : null,
        corrections: rows.length - 1 < 0 ? 0 : rows.length - 1,
        rows: rows.map((r): MeasurementRowView => ({ id: r.id, value: r.value, valueStatus: r.value_status, recordedAt: r.recorded_at, recordedBy: r.recorded_by_membership_id ? { id: r.recorded_by_membership_id, name: w.dir.names.get(r.recorded_by_membership_id) ?? "Former member" } : null, source: r.source, note: r.note, current: currentIds.has(r.id), supersedes: r.supersedes_measurement_id })),
      };
    });
    const lines = thresholds.flatMap((t) => {
      const v = t.basis === "percent_of_target" ? (target && target.targetValue > 0 ? (target.targetValue * t.value) / 100 : null) : t.value;
      return v === null ? [] : [{ level: t.level, comparator: t.comparator, value: v }];
    });
    return {
      kpi: { id: k.id, name: k.name, unit: k.unit, frequency: k.frequency, direction: k.direction, aggregation: k.aggregation },
      subject: this.subjectView(w.dir, subject),
      target: target ? { targetValue: target.targetValue, targetMax: target.targetMax, weight: target.weight } : null,
      lines, periods, expected, present, missingCount: expected - present,
      coveragePct: expected === 0 ? null : Math.round((present / expected) * 100),
      status: series?.status ?? "no_data",
      can: { record: caps.has("kpi.record") && this.records(caps.scope("kpi.record"), ctx.membershipId, subject) && !k.archived_at },
    };
  }

  /** The subjects of a KPI the caller may see a series for: for the KPI panel's subject picker. */
  subjects(auth: AuthContext, requestId: string, caps: Capabilities, kpiId: string): { subject: SubjectView; status: SeriesStatus; missing: number; latest: string | null; canRecord: boolean }[] {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const scope = this.requireView(caps);
    const k = w.repo.kpi(kpiId);
    if (!k || (k.archived_at && !caps.scope("kpi.configure").all)) throw notFound();
    const recordScope = caps.has("kpi.record") ? caps.scope("kpi.record") : null;
    return buildSeries(w.input)
      .filter((s) => s.kpi.id === kpiId && this.sees(w.dir, scope, ctx.membershipId, s.subject))
      .map((s) => ({ subject: this.subjectView(w.dir, s.subject), status: s.status, missing: s.missing.length, latest: s.latest ? `${s.latest.label}: ${s.latest.value}` : null, canRecord: recordScope !== null && this.records(recordScope, ctx.membershipId, s.subject) }))
      .sort((a, b) => a.subject.name.localeCompare(b.subject.name))
      .slice(0, 300);
  }

  overview(auth: AuthContext, requestId: string, caps: Capabilities): OverviewView {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const scope = this.requireView(caps);
    const visible = buildSeries(w.input).filter((s) => this.sees(w.dir, scope, ctx.membershipId, s.subject));
    const per = new Map<string, OverviewView["kpis"][number] & { exp: number; pres: number }>();
    const totals: OverviewView["totals"] = { series: visible.length, byStatus: {}, missingPeriods: 0, kpis: 0 };
    for (const s of visible) {
      totals.byStatus[s.status] = (totals.byStatus[s.status] ?? 0) + 1;
      totals.missingPeriods += s.missing.length;
      const e = per.get(s.kpi.id) ?? { id: s.kpi.id, name: s.kpi.name, category: s.kpi.category, frequency: s.kpi.frequency, series: 0, byStatus: {}, missingPeriods: 0, coveragePct: null, exp: 0, pres: 0 };
      e.series += 1;
      e.byStatus[s.status] = (e.byStatus[s.status] ?? 0) + 1;
      e.missingPeriods += s.missing.length;
      e.exp += s.expected;
      e.pres += s.present;
      per.set(s.kpi.id, e);
    }
    totals.kpis = per.size;
    const rank: Record<string, number> = { critical: 0, warning: 1 };
    const attention = visible
      .filter((s) => s.status === "critical" || s.status === "warning" || s.missing.length > 0)
      .sort((a, b) => (rank[a.status] ?? 2) - (rank[b.status] ?? 2) || b.missing.length - a.missing.length || a.kpi.name.localeCompare(b.kpi.name))
      .slice(0, 12)
      .map((s) => ({ kpiId: s.kpi.id, kpiName: s.kpi.name, subject: this.subjectView(w.dir, s.subject), status: s.status, label: s.latest ? `${s.latest.label}: ${s.latest.value}${s.kpi.unit ? ` ${s.kpi.unit}` : ""}` : "No value yet", value: s.latest?.value ?? null, missing: s.missing.length }));
    return {
      totals,
      kpis: [...per.values()].map(({ exp, pres, ...rest }) => ({ ...rest, coveragePct: exp === 0 ? null : Math.round((pres / exp) * 100) })).sort((a, b) => a.name.localeCompare(b.name)),
      attention,
    };
  }
}
export type { KpiRow, MeasurementRow };
