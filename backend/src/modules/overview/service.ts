import { HttpError } from "../../lib/errors.js";
import type { AuthStore } from "../auth/repositories/store.js";
import type { AuthContext, AuthService } from "../auth/service.js";
import type { Capabilities } from "../permissions/service.js";
import { addDays, todayIn } from "../tasks/dates.js";
import type { TaskService } from "../tasks/service.js";
import type { AssignmentRow, TaskRow } from "../tasks/repositories/tasks.js";

const open = (status: string): boolean => status !== "completed" && status !== "cancelled";
const WINDOW_DAYS = 14;

export interface ChecklistItem { key: string; label: string; to: string; done: boolean; stage: string | null }
export interface Overview {
  today: string;
  /** What the page shows, chosen from what the caller may see (never from a job title). */
  preset: "personal" | "team" | "executive";
  personal: { open: number; overdue: number; dueToday: number; blocked: number; completedRecently: number; unreadNotifications: number; next: { id: string; title: string; reasons: string[] } | null };
  /** The people and tasks inside the caller's scope, when it reaches beyond themselves. */
  team: null | {
    label: string;
    people: number;
    openTasks: number;
    overdueTasks: number;
    blockedTasks: number;
    completedRecently: number;
    needsAttention: { id: string; name: string; overdue: number; blocked: number }[];
  };
  /** Organization-wide numbers, for people whose permissions reach everyone. */
  organization: null | {
    people: number;
    departments: number;
    teams: number;
    tasksByStatus: Record<string, number>;
    overdueTasks: number;
    openTasks: number;
    completedByDay: { date: string; count: number }[];
    departmentLoad: { id: string; name: string; people: number; open: number; overdue: number }[];
  };
  checklist: ChecklistItem[];
  flags: { demoLoaded: boolean; canManageDemo: boolean; canSetUp: boolean };
}

/**
 * The Overview page's numbers (stage 6.1). Every figure is counted from real rows at the moment of the request. The widgets
 * adapt to what the caller may see: everyone gets their own work; someone whose scope reaches other people also gets the team
 * widget; someone who may see everyone gets the organization widgets.
 */
export class OverviewService {
  constructor(private readonly o: { store: AuthStore; auth: AuthService; tasks: TaskService }) {}

  get(auth: AuthContext, requestId: string, caps: Capabilities): Overview {
    if (!auth.organizationId || !auth.membershipId) throw new HttpError(403, "no_organization", "Join or create an organization first.");
    const ctx = this.o.auth.tenantCtx(auth, requestId);
    const tdb = this.o.store.tenant(ctx);
    const me = ctx.membershipId;
    const org = this.o.store.orgs.findById(ctx.organizationId);
    const today = todayIn(org?.timezone ?? "UTC", new Date(this.o.auth.iso()));
    const work = this.o.tasks.myWork(auth, requestId);
    const tasksRepo = this.o.store.tasks(tdb);
    const people = this.o.store.people(tdb);
    const structure = this.o.store.structure(tdb);
    const demo = this.o.store.demo(tdb);

    const live = people.people().filter((p) => p.archived_at === null && p.status !== "left");
    const names = new Map(people.people().map((p) => [p.id, p.display_name]));
    const depts = structure.departments().filter((d) => d.archived_at === null);
    const teams = structure.teams().filter((t) => t.archived_at === null);
    const tasks = tasksRepo.list();
    const assigns = new Map<string, AssignmentRow[]>();
    for (const a of tasksRepo.activeAssignments()) if (a.role === "assignee") assigns.set(a.task_id, [...(assigns.get(a.task_id) ?? []), a]);
    const doers = (t: TaskRow): string[] => (assigns.get(t.id) ?? []).flatMap((a) => (a.assignee_membership_id ? [a.assignee_membership_id] : []));
    const overdue = (t: TaskRow): boolean => open(t.status) && t.due_at !== null && t.due_at < today;
    const since = addDays(today, -WINDOW_DAYS);
    const doneRecently = (t: TaskRow): boolean => t.status === "completed" && t.completed_at !== null && t.completed_at.slice(0, 10) >= since;

    const scope = caps.scope("task.view");
    const orgWide = scope.all && caps.scope("org.view").all;
    const others = [...scope.members].filter((m) => m !== me);

    let team: Overview["team"] = null;
    if (!scope.all && others.length > 0) {
      const inScope = new Set(scope.members);
      const mine = tasks.filter((t) => inScope.has(t.created_by_membership_id) || doers(t).some((d) => inScope.has(d)));
      const per = new Map<string, { overdue: number; blocked: number }>();
      for (const t of mine) for (const d of doers(t)) if (inScope.has(d) && d !== me) {
        const x = per.get(d) ?? { overdue: 0, blocked: 0 };
        if (overdue(t)) x.overdue += 1;
        if (open(t.status) && t.status === "blocked") x.blocked += 1;
        per.set(d, x);
      }
      team = {
        label: scope.departments.size > 0 ? "Your department" : "Your people",
        people: others.filter((m) => live.some((p) => p.id === m)).length,
        openTasks: mine.filter((t) => open(t.status)).length,
        overdueTasks: mine.filter(overdue).length,
        blockedTasks: mine.filter((t) => t.status === "blocked").length,
        completedRecently: mine.filter(doneRecently).length,
        needsAttention: [...per.entries()].filter(([, v]) => v.overdue + v.blocked > 0).sort((a, b) => b[1].overdue + b[1].blocked - (a[1].overdue + a[1].blocked)).slice(0, 5).map(([id, v]) => ({ id, name: names.get(id) ?? "Former member", ...v })),
      };
    }

    let organization: Overview["organization"] = null;
    if (orgWide) {
      const byStatus: Record<string, number> = {};
      for (const t of tasks) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      const days: { date: string; count: number }[] = [];
      for (let i = WINDOW_DAYS - 1; i >= 0; i--) days.push({ date: addDays(today, -i), count: 0 });
      for (const t of tasks) if (t.status === "completed" && t.completed_at) {
        const d = days.find((x) => x.date === t.completed_at!.slice(0, 10));
        if (d) d.count += 1;
      }
      const deptOf = new Map<string, string[]>();
      for (const r of people.deptRows({ asOf: today })) deptOf.set(r.membership_id, [...(deptOf.get(r.membership_id) ?? []), r.department_id]);
      const load = new Map<string, { people: Set<string>; open: number; overdue: number }>(depts.map((d) => [d.id, { people: new Set<string>(), open: 0, overdue: 0 }]));
      for (const p of live) for (const d of deptOf.get(p.id) ?? []) load.get(d)?.people.add(p.id);
      for (const t of tasks) if (open(t.status)) {
        const seen = new Set<string>();
        for (const m of doers(t)) for (const d of deptOf.get(m) ?? []) if (!seen.has(d)) {
          seen.add(d);
          const x = load.get(d);
          if (x) {
            x.open += 1;
            if (overdue(t)) x.overdue += 1;
          }
        }
      }
      organization = {
        people: live.length,
        departments: depts.length,
        teams: teams.length,
        tasksByStatus: byStatus,
        overdueTasks: tasks.filter(overdue).length,
        openTasks: tasks.filter((t) => open(t.status)).length,
        completedByDay: days,
        departmentLoad: depts.map((d) => ({ id: d.id, name: d.name, people: load.get(d.id)!.people.size, open: load.get(d.id)!.open, overdue: load.get(d.id)!.overdue })).filter((d) => d.people > 0).sort((a, b) => b.open - a.open).slice(0, 8),
      };
    }

    const reportingLines = people.reportingRows({ asOf: today }).length;
    const first = work.suggested[0];
    return {
      today,
      preset: orgWide ? "executive" : team ? "team" : "personal",
      personal: {
        open: work.counts.open,
        overdue: work.counts.overdue,
        dueToday: work.counts.dueToday,
        blocked: work.counts.blocked,
        completedRecently: work.counts.completedRecently,
        unreadNotifications: this.o.store.notifications(tdb).unreadCount(me),
        next: first ? { id: first.task.id, title: first.task.title, reasons: first.reasons } : null,
      },
      team,
      organization,
      checklist: [
        { key: "departments", label: "Create departments", to: "/settings/structure", done: depts.length > 0, stage: null },
        { key: "people", label: "Add or invite people", to: "/organization/people", done: live.length > 1, stage: null },
        { key: "reporting", label: "Set reporting lines", to: "/organization", done: reportingLines > 0, stage: null },
        { key: "objective", label: "Create a company objective", to: "/okrs", done: false, stage: "3.1" },
        { key: "kpi", label: "Define KPIs", to: "/kpis", done: false, stage: "3.3" },
        { key: "tasks", label: "Assign tasks", to: "/my-work", done: [...assigns.values()].some((a) => a.length > 0), stage: null },
      ],
      flags: { demoLoaded: demo.loadedBatch() !== undefined, canManageDemo: caps.scope("demo.manage").all, canSetUp: caps.scope("org.manage").all || caps.scope("people.manage").all },
    };
  }
}
