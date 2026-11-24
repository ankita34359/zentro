import { HttpError } from "../../lib/errors.js";
import type { AuthStore } from "../auth/repositories/store.js";
import type { AuthContext, AuthService } from "../auth/service.js";
import type { Capabilities } from "../permissions/service.js";
import type { AlignmentService, TreeNode } from "../okr/alignment.js";
import type { OkrService, ObjectiveSummary } from "../okr/service.js";
import type { MeasurementService } from "../kpi/measurements.js";
import { buildSeries, loadSeriesInput } from "../kpi/series.js";
import type { PerformanceService } from "../scoring/performance.js";
import { todayIn } from "../tasks/dates.js";
import type { TaskRow } from "../tasks/repositories/tasks.js";

const open = (status: string): boolean => status !== "completed" && status !== "cancelled";
const BEHIND = new Set(["at_risk", "delayed"]);

export interface ObjectiveLine { id: string; title: string; health: string | null; attainmentPct: number | null; elapsedPct: number; dataState: string }
export interface TeamCard {
  id: string;
  name: string;
  department: string | null;
  memberCount: number;
  /** Named only for people the caller may see; the rest are counted. */
  members: { id: string; name: string; role: string }[];
  hiddenMembers: number;
  /** null = the caller may not see objectives. */
  objectives: ObjectiveLine[] | null;
  kpis: null | { series: number; byStatus: Record<string, number>; missingPeriods: number; items: { kpiId: string; name: string; subject: string; status: string; missing: number }[] };
  tasks: null | { open: number; overdue: number; done: number; blocked: number };
}
export interface TeamPerformance { today: string; teams: TeamCard[] }

export interface ContributionLine { id: string; title: string; level: string; department: string | null; owner: string | null; health: string | null; attainmentPct: number | null; contributionPct: number | null }
export interface LeadershipView {
  today: string;
  objectives: { id: string; title: string; health: string | null; attainmentPct: number | null; elapsedPct: number; dataState: string; owner: string | null; contributors: ContributionLine[] }[];
  risks: { id: string; title: string; level: string; reason: string; kind: "behind_pace" | "overdue" | "no_data" }[];
  kpis: null | { series: number; byStatus: Record<string, number>; missingPeriods: number; attention: { kpiId: string; name: string; subject: string; status: string; label: string; missing: number }[] };
}

export interface Insight { key: string; severity: "attention" | "info"; title: string; summary: string; count: number; to: string; items: { label: string; detail: string; to: string }[] }
export interface InsightsView { today: string; insights: Insight[]; ask: { enabled: false; reason: string }; note: string }

export const EVENT_CATALOG: { type: string; description: string; recorded: boolean }[] = [
  { type: "task.created", description: "A task was created.", recorded: true },
  { type: "task.assigned", description: "A task was assigned to someone.", recorded: true },
  { type: "task.reviewed", description: "A reviewer rated a finished task.", recorded: true },
  { type: "task.outcome_recorded", description: "The outcome of a finished task was written down.", recorded: true },
  { type: "daily_update.submitted", description: "Someone sent their daily update.", recorded: true },
  { type: "objective.at_risk", description: "An objective moved to at risk or delayed.", recorded: true },
  { type: "kpi.measurement_recorded", description: "A KPI value was recorded or corrected.", recorded: true },
  { type: "kpi.threshold", description: "A KPI crossed a warning or critical threshold.", recorded: true },
  { type: "kpi.measurement_missed", description: "A KPI period ended with no value.", recorded: true },
  { type: "task.completed", description: "A task was completed.", recorded: false },
  { type: "review.submitted", description: "A performance review was submitted.", recorded: false },
  { type: "period.closed", description: "A performance period was closed.", recorded: false },
  { type: "score.finalized", description: "A final score was calculated.", recorded: false },
];
export interface IntegrationsView {
  viaSocket: { connected: false; status: string; settings: { name: string; set: boolean }[] };
  events: { type: string; description: string; status: "recorded" | "planned"; last30Days: number | null }[];
  steps: string[];
  note: string;
}
const VIASOCKET_SETTINGS = ["VIASOCKET_ORG_ID", "VIASOCKET_PROJECT_ID", "VIASOCKET_EMBED_SECRET"];

/**
 * The first versions of four pages (batch G): Team Performance, Leadership, rule-based insights and the integrations status. All
 * of it is read-only and counted from rows the caller may already see; nothing here calls an AI model or another service.
 */
export class DashboardService {
  constructor(private readonly o: { store: AuthStore; auth: AuthService; okr: OkrService; alignment: AlignmentService; measurements: MeasurementService; performance: PerformanceService }) {}

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

  teamPerformance(auth: AuthContext, requestId: string, caps: Capabilities): TeamPerformance {
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
      return {
        id: t.id, name: t.name, department: depts.get(t.department_id) ?? null, memberCount: members.length,
        members: shown.map((r) => ({ id: r.membership_id, name: names.get(r.membership_id)!, role: r.membership_type })), hiddenMembers: members.length - shown.length,
        objectives: okrOn ? objectives.filter((o) => o.team?.id === t.id).map((o) => this.line(o)) : null,
        kpis: caps.has("kpi.view") ? { series: teamSeries.length, byStatus, missingPeriods: teamSeries.reduce((n, s) => n + s.missing.length, 0), items: teamSeries.filter((s) => s.status === "critical" || s.status === "warning" || s.missing.length > 0).sort((a, b) => (rank[a.status] ?? 2) - (rank[b.status] ?? 2) || b.missing.length - a.missing.length).slice(0, 5).map((s) => ({ kpiId: s.kpi.id, name: s.kpi.name, subject: subjectName(s), status: s.status, missing: s.missing.length })) } : null,
        tasks: tasksOn ? { open: theirTasks.filter((x) => open(x.status)).length, overdue: theirTasks.filter((x) => open(x.status) && x.due_at !== null && x.due_at < today).length, done: theirTasks.filter((x) => x.status === "completed").length, blocked: theirTasks.filter((x) => x.status === "blocked").length } : null,
      };
    });
    return { today, teams: out.sort((a, b) => (a.department ?? "").localeCompare(b.department ?? "") || a.name.localeCompare(b.name)) };
  }

  // ---------- Leadership ----------

  leadership(auth: AuthContext, requestId: string, caps: Capabilities): LeadershipView {
    const { today } = this.base(auth, requestId);
    const all = this.o.okr.list(auth, requestId, caps, {});
    const byId = new Map(all.map((o) => [o.id, o]));
    const tree = this.o.alignment.tree(auth, requestId, caps, {});
    const flat = (n: TreeNode): TreeNode[] => n.children.flatMap((c) => [c, ...flat(c)]);
    const companyRoots = tree.roots.filter((r) => r.level === "company" && (r.lifecycle === "active" || r.lifecycle === "completed"));
    const objectives = companyRoots.map((r) => {
      const s = byId.get(r.id);
      const contributors = flat(r).filter((c) => c.level === "department" || c.level === "team").map((c): ContributionLine => ({ id: c.id, title: c.title, level: c.level, department: byId.get(c.id)?.department?.name ?? byId.get(c.id)?.team?.name ?? null, owner: c.owner?.name ?? null, health: c.health, attainmentPct: c.attainmentPct, contributionPct: c.contributionPct }));
      return { id: r.id, title: r.title, health: r.health, attainmentPct: r.attainmentPct, elapsedPct: s?.elapsedPct ?? 0, dataState: r.dataState, owner: r.owner?.name ?? null, contributors };
    });
    const gaps = caps.has("okr.view") ? this.o.alignment.gaps(auth, requestId, caps) : null;
    const risks: LeadershipView["risks"] = [];
    for (const g of gaps?.behindPace ?? []) risks.push({ id: g.id, title: g.title, level: g.level, reason: g.reason, kind: "behind_pace" });
    for (const g of gaps?.overdue ?? []) risks.push({ id: g.id, title: g.title, level: g.level, reason: g.reason, kind: "overdue" });
    for (const g of gaps?.noData ?? []) risks.push({ id: g.id, title: g.title, level: g.level, reason: g.reason, kind: "no_data" });
    const k = caps.has("kpi.view") ? this.o.measurements.overview(auth, requestId, caps) : null;
    return {
      today, objectives, risks: risks.slice(0, 20),
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
    return {
      viaSocket: { connected: false, status: "Not connected", settings },
      events: EVENT_CATALOG.map((e) => ({ type: e.type, description: e.description, status: e.recorded ? "recorded" : "planned", last30Days: e.recorded ? counts[e.type] ?? 0 : null })),
      steps: [
        "Create a viaSocket project and note its project and organization ids.",
        "Ask whoever runs the server to add the three settings listed above (their names only are shown here; values are never shown).",
        "Restart Zentro, then come back to this page: the status will say what is still missing.",
        "Connecting and building workflows inside Zentro comes in a later version; today events are recorded so they are ready to send.",
      ],
      note: "Early version. Zentro records these events now; nothing is sent to viaSocket yet.",
    };
  }
}
