import type { AuthContext } from "../auth/service.js";
import type { Capabilities } from "../permissions/service.js";
import type { DashboardService } from "../dashboards/service.js";
import type { KpiService } from "../kpi/service.js";
import type { OkrService } from "../okr/service.js";
import type { OverviewService } from "../overview/service.js";
import type { TaskService } from "../tasks/service.js";

export type RecordType = "objective" | "kpi" | "task" | "person";
export interface ContextRecord { ref: string; type: RecordType; id: string; label: string; to: string }
export interface AiContext { text: string; records: ContextRecord[] }

/** The most Zentro ever sends as records, in characters. Lists are cut to fit, never the question. */
export const MAX_CONTEXT_CHARS = 18_000;
const PREFIX: Record<RecordType, string> = { objective: "O", kpi: "K", task: "T", person: "P" };
const LINK: Record<RecordType, (id: string) => string> = {
  objective: (id) => `/okrs?objective=${id}`,
  kpi: (id) => `/kpis?kpi=${id}`,
  task: (id) => `/my-work/tasks?task=${id}`,
  person: (id) => `/organization/people?person=${id}`,
};
const clean = (s: string): string => s.replace(/[\r\n\t]+/g, " ").replace(/[<>]/g, "").trim().slice(0, 160);
const num = (n: number | null | undefined): string => (n === null || n === undefined ? "no data" : String(n));
const pct = (n: number | null | undefined): string => (n === null || n === undefined ? "no data" : `${n}%`);

/**
 * Builds the records the AI may use, from the SAME permission-checked services the pages use, run as the signed-in person. Nothing here
 * reads a table directly, so the context can never hold more than the person may already see. Reviews, evidence, other organizations,
 * passwords, tokens and settings are not touched at all.
 */
export class AiContextBuilder {
  constructor(private readonly o: { overview: OverviewService; dashboards: DashboardService; okr: OkrService; kpi: KpiService; tasks: TaskService }) {}

  build(auth: AuthContext, requestId: string, caps: Capabilities): AiContext {
    const records: ContextRecord[] = [];
    const counters: Record<RecordType, number> = { objective: 0, kpi: 0, task: 0, person: 0 };
    const refOf = new Map<string, string>();
    const ref = (type: RecordType, id: string, label: string): string => {
      const k = `${type}:${id}`;
      const have = refOf.get(k);
      if (have) return have;
      const r = `${PREFIX[type]}${++counters[type]}`;
      refOf.set(k, r);
      records.push({ ref: r, type, id, label: clean(label), to: LINK[type](id) });
      return r;
    };
    const sections: string[] = [];
    const add = (title: string, lines: string[]) => { if (lines.length > 0) sections.push(`## ${title}\n${lines.join("\n")}`); };

    const ov = this.o.overview.get(auth, requestId, caps);
    add("Today", [`Date: ${ov.today}`, `Your own work: ${ov.personal.open} open, ${ov.personal.overdue} overdue, ${ov.personal.blocked} blocked, ${ov.personal.dueToday} due today, ${ov.personal.completedRecently} finished recently`]);
    if (ov.team) {
      add(`${ov.team.label}`, [
        `People: ${ov.team.people}; open tasks ${ov.team.openTasks}; overdue ${ov.team.overdueTasks}; blocked ${ov.team.blockedTasks}; finished recently ${ov.team.completedRecently}`,
        ...ov.team.needsAttention.slice(0, 8).map((p) => `[${ref("person", p.id, p.name)}] ${clean(p.name)}: ${p.overdue} overdue, ${p.blocked} blocked`),
      ]);
    }
    if (ov.organization) {
      const o = ov.organization;
      add("Organization", [
        `People ${o.people}, departments ${o.departments}, teams ${o.teams}; open tasks ${o.openTasks}; overdue ${o.overdueTasks}`,
        `Tasks by status: ${Object.entries(o.tasksByStatus).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`,
        ...o.departmentLoad.slice(0, 8).map((d) => `${clean(d.name)}: ${d.people} people, ${d.open} open tasks, ${d.overdue} overdue`),
      ]);
    }
    if (caps.has("okr.view")) {
      const objectives = this.o.okr.list(auth, requestId, caps, {}).filter((o) => !o.archived && o.lifecycle === "active").slice(0, 20);
      add("Objectives (active)", objectives.map((o) => `[${ref("objective", o.id, o.title)}] ${clean(o.title)} (${o.level}): health ${o.health ?? "not rated"}; progress ${pct(o.attainmentPct)}; ${o.elapsedPct}% of the time has passed; ${o.keyResultCount} key results${o.owner ? `; owner ${clean(o.owner.name)}` : ""}${o.healthReason ? `; ${clean(o.healthReason)}` : ""}`));
    }
    if (caps.has("kpi.view")) {
      const kpis = this.o.kpi.list(auth, requestId, caps, {}).filter((k) => !k.archived).slice(0, 20);
      add("KPIs (definitions; measured values appear only where listed under Attention or Insights)", kpis.map((k) => `[${ref("kpi", k.id, k.name)}] ${clean(k.name)}: ${k.category}, ${k.frequency}, unit ${k.unit ?? "none"}, default target ${num(k.defaultTarget)}`));
      if (ov.kpis) {
        add("KPI series right now", [
          `Series ${ov.kpis.totals.series}; statuses ${Object.entries(ov.kpis.totals.byStatus).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}; periods with no value recorded ${ov.kpis.totals.missingPeriods}`,
          ...ov.kpis.attention.slice(0, 10).map((a) => `[${ref("kpi", a.kpiId, a.kpiName)}] ${clean(a.kpiName)} for ${clean(a.subject.name)}: ${a.status}; ${clean(a.label)}`),
        ]);
      }
    }
    if (caps.has("task.view")) {
      const w = this.o.tasks.myWork(auth, requestId);
      const line = (t: { id: string; title: string; status: string; dueAt: string | null; blockedReason: string | null }) => `[${ref("task", t.id, t.title)}] ${clean(t.title)}: ${t.status}${t.dueAt ? `, due ${t.dueAt.slice(0, 10)}` : ", no due date"}${t.blockedReason ? `, blocked: ${clean(t.blockedReason)}` : ""}`;
      add("Your tasks that need attention", [...w.overdue.slice(0, 8).map((t) => `overdue ${line(t)}`), ...w.blocked.slice(0, 8).map((t) => `blocked ${line(t)}`), ...w.dueToday.slice(0, 6).map((t) => `due today ${line(t)}`)]);
    }
    if (caps.has("ai.view_insights")) {
      const ins = this.o.dashboards.insights(auth, requestId, caps);
      add("Insights (counted by plain rules)", ins.insights.flatMap((i) => [`${clean(i.title)} [${i.severity}]: ${clean(i.summary)}`, ...i.items.slice(0, 5).map((x) => `  - ${clean(x.label)}: ${clean(x.detail)}`)]));
    }
    let text = sections.join("\n\n");
    if (text.length > MAX_CONTEXT_CHARS) text = `${text.slice(0, MAX_CONTEXT_CHARS)}\n[The records were cut here because they are long.]`;
    // only records that are actually mentioned in the text that was sent are listed as sent
    return { text, records: records.filter((r) => text.includes(`[${r.ref}]`)) };
  }
}
