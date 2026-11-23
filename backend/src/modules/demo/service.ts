import type { TenantCtx } from "../../db/tenant.js";
import { HttpError, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import type { AuditService } from "../audit/service.js";
import type { AuthStore } from "../auth/repositories/store.js";
import type { AuthContext, AuthService } from "../auth/service.js";
import { TEMPLATE_KEYS } from "../permissions/roleTemplates.js";
import type { Capabilities } from "../permissions/service.js";
import { addDays, todayIn } from "../tasks/dates.js";
import { buildDemoCompany, demoEmail, type DemoTask, type RoleChoice } from "./seed.js";

const ROLE_KEY: Record<RoleChoice, string> = {
  r_ceo: TEMPLATE_KEYS.ceo,
  r_senior: TEMPLATE_KEYS.seniorManagement,
  r_dept_head: TEMPLATE_KEYS.departmentHead,
  r_manager: TEMPLATE_KEYS.manager,
  r_team_lead: TEMPLATE_KEYS.teamLead,
  r_mentor: TEMPLATE_KEYS.mentor,
  r_employee: TEMPLATE_KEYS.employee,
};

export interface DemoStatus {
  loaded: boolean;
  loadedAt: string | null;
  counts: Record<string, number>;
  /** People who are not demo people: the organization's real data, shown so it is clear it stays. */
  realPeople: number;
}
export interface Persona {
  id: string;
  name: string;
  designation: string | null;
  department: string | null;
  roles: string[];
  /** Where the person sits in the demo company's tree: the top, heads of departments, people who manage others, everyone else. */
  group: "leadership" | "heads" | "managers" | "employees";
}

const at = (day: string, hour = 9): string => `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`;

/**
 * Demo data (stage 2.8). "Load" writes a fictional company as real rows flagged `is_demo`, in one transaction; "Remove"
 * deletes exactly those rows (and what hangs off them) and refuses, with a list, when one of the organization's real rows
 * still points at a demo row. "View as" opens a short, read-only session for a demo person so one presenter can show the
 * employee, manager and CEO views. Everything is audited.
 */
export class DemoService {
  constructor(private readonly o: { store: AuthStore; auth: AuthService; audit: AuditService }) {}

  private ctx(auth: AuthContext, requestId: string): TenantCtx {
    return this.o.auth.tenantCtx(auth, requestId);
  }
  private requireManage(caps: Capabilities): void {
    if (!caps.scope("demo.manage").all) throw new HttpError(403, "permission_denied", "Not allowed");
  }

  status(auth: AuthContext, requestId: string, caps: Capabilities): DemoStatus {
    this.requireManage(caps);
    const ctx = this.ctx(auth, requestId);
    const tdb = this.o.store.tenant(ctx);
    const repo = this.o.store.demo(tdb);
    const batch = repo.loadedBatch();
    const counts = repo.counts();
    const total = this.o.store.memberships(tdb).count();
    return { loaded: batch !== undefined, loadedAt: batch?.created_at ?? null, counts: batch ? counts : {}, realPeople: Math.max(0, total - (counts.people ?? 0)) };
  }

  // ---------- load ----------

  load(auth: AuthContext, requestId: string, caps: Capabilities): DemoStatus {
    this.requireManage(caps);
    const ctx = this.ctx(auth, requestId);
    const tdb = this.o.store.tenant(ctx);
    const repo = this.o.store.demo(tdb);
    if (repo.loadedBatch()) throw new HttpError(409, "demo_loaded", "Demo data is already loaded. Remove it first to load it again.");
    const org = this.o.store.orgs.findById(ctx.organizationId);
    const now = this.o.auth.iso();
    const today = todayIn(org?.timezone ?? "UTC", new Date(now));
    const company = buildDemoCompany(ctx.organizationId);
    const by = ctx.membershipId;

    // roles the seed hands out are the organization's own role templates; one that was archived is simply not given
    const roleIds = new Map<RoleChoice, string | undefined>(Object.keys(ROLE_KEY).map((k) => [k as RoleChoice, repo.roleId(ROLE_KEY[k as RoleChoice])]));

    // Names must be unique among active siblings. An organization that already has an "Engineering" department or a "Mentor"
    // designation keeps its own; the demo one is called "Engineering (demo)" so loading never fails or merges with real data.
    const structure = this.o.store.structure(tdb);
    const taken = {
      department: new Set(structure.departments().filter((d) => d.archived_at === null && d.parent_id === null).map((d) => d.name.toLowerCase())),
      family: new Set(structure.roleFamilies().filter((f) => f.archived_at === null).map((f) => f.name.toLowerCase())),
      designation: new Set(structure.designations().filter((d) => d.archived_at === null).map((d) => d.name.toLowerCase())),
    };
    const free = (kind: keyof typeof taken, name: string): string => (taken[kind].has(name.toLowerCase()) ? `${name} (demo)` : name);

    this.o.store.transaction(() => {
      const familyId = new Map(company.roleFamilies.map((f) => [f.key, newId()]));
      for (const f of company.roleFamilies) repo.insertRoleFamily({ id: familyId.get(f.key)!, name: free("family", f.name), now });
      const designationId = new Map(company.designations.map((d) => [d.name, newId()]));
      for (const d of company.designations) repo.insertDesignation({ id: designationId.get(d.name)!, familyId: familyId.get(d.familyKey)!, name: free("designation", d.name), now });
      const deptId = new Map(company.departments.map((d) => [d.key, newId()]));
      for (const d of company.departments) repo.insertDepartment({ id: deptId.get(d.key)!, name: free("department", d.name), description: d.description, now });
      const teamId = new Map(company.teams.map((t) => [t.key, newId()]));
      for (const t of company.teams) repo.insertTeam({ id: teamId.get(t.key)!, departmentId: deptId.get(t.deptKey)!, parentTeamId: t.parentKey ? teamId.get(t.parentKey)! : null, name: t.name, now });

      const personId = new Map<string, string>();
      company.people.forEach((p, i) => {
        const id = newId();
        personId.set(p.key, id);
        const userId = newId();
        this.o.store.users.insertDemo({ id: userId, email: demoEmail(p.name, ctx.organizationId, i + 1), name: p.name, now });
        const start = addDays(today, p.startOffsetDays);
        repo.insertPerson({ id, userId, name: p.name, designationId: designationId.get(p.designation)!, employeeCode: `D-${String(i + 1).padStart(3, "0")}`, employmentType: p.employmentType, startDate: start, now });
        repo.insertDesignationAssignment({ id: newId(), membershipId: id, designationId: designationId.get(p.designation)!, startDate: start, createdBy: by, now });
        repo.insertDeptMembership({ id: newId(), departmentId: deptId.get(p.deptKey)!, membershipId: id, type: p.deptType, startDate: start, createdBy: by, now });
        if (p.teamKey) repo.insertTeamMembership({ id: newId(), teamId: teamId.get(p.teamKey)!, membershipId: id, type: p.teamType ?? "member", startDate: start, createdBy: by, now });
        const roleId = roleIds.get(p.role);
        if (roleId) {
          const scopeId = p.roleScope === "department" ? deptId.get(p.deptKey)! : p.roleScope === "team" && p.teamKey ? teamId.get(p.teamKey)! : null;
          repo.insertRoleAssignment({ id: newId(), membershipId: id, roleId, scopeType: scopeId ? p.roleScope : "organization", scopeId, validFrom: now, grantedBy: by, now });
        }
      });
      for (const p of company.people) {
        if (p.managerKey) repo.insertReporting({ id: newId(), subordinateId: personId.get(p.key)!, managerId: personId.get(p.managerKey)!, startDate: addDays(today, p.startOffsetDays), createdBy: by, now });
      }

      const taskId = new Map<string, string>();
      for (const t of company.tasks) this.insertTask(repo, t, taskId, personId, teamId, today, by);
      for (const d of company.dailyUpdates) repo.insertDailyUpdate({ id: newId(), membershipId: personId.get(d.personKey)!, day: addDays(today, d.dayOffset), summary: d.summary, blockers: d.blockers, now: at(addDays(today, d.dayOffset), 17) });
      this.insertNotifications(repo, company.tasks, taskId, personId, today, now);

      const counts = repo.counts();
      repo.insertBatch({ id: newId(), createdBy: by, countsJson: JSON.stringify(counts), now });
      this.o.audit.record(tdb, ctx, { action: "demo.load", entityType: "demo", entityId: null, summary: `Loaded demo data: ${counts.people} people, ${counts.departments} departments, ${counts.teams} teams, ${counts.tasks} tasks`, after: counts });
    });
    return this.status(auth, requestId, caps);
  }

  private insertTask(repo: ReturnType<AuthStore["demo"]>, t: DemoTask, taskId: Map<string, string>, personId: Map<string, string>, teamId: Map<string, string>, today: string, by: string): void {
    const id = newId();
    taskId.set(t.key, id);
    const created = addDays(today, t.createdOffset);
    const completed = t.completedOffset === null ? null : at(addDays(today, t.completedOffset), 15);
    const updated = completed ?? at(addDays(today, Math.min(0, t.createdOffset + 3)), 11);
    const assignee = personId.get(t.assigneeKey)!;
    const creator = personId.get(t.creatorKey)!;
    repo.insertTask({
      id, title: t.title, description: "", status: t.status, priority: t.priority, importance: t.importance, progressPct: t.progressPct,
      dueAt: t.dueOffset === null ? null : addDays(today, t.dueOffset), startDate: created, estimated: t.estimatedMinutes, actual: t.loggedMinutes, completedAt: completed,
      blockedReason: t.blockedReason, teamId: t.teamKey ? teamId.get(t.teamKey)! : null, createdBy: creator, createdAt: at(created), updatedAt: updated,
    });
    repo.insertTaskAssignment({ id: newId(), taskId: id, membershipId: assignee, by: creator, now: at(created) });
    const step = (type: string, from: string | null, to: string | null, day: string, hour: number, extra: { progress?: number; minutes?: number; body?: string } = {}) =>
      repo.insertTaskUpdate({ id: newId(), taskId: id, author: assignee, type, fromStatus: from, toStatus: to, progressPct: extra.progress ?? null, minutes: extra.minutes ?? null, body: extra.body ?? null, now: at(day, hour) });
    const started = addDays(created, 1);
    if (t.status !== "not_started") step("status_change", "not_started", t.status === "cancelled" ? "cancelled" : "in_progress", started, 10);
    if (t.loggedMinutes > 0) step("time_log", null, null, addDays(started, 1), 16, { minutes: t.loggedMinutes });
    if (t.status === "in_progress" || t.status === "blocked" || t.status === "under_review") step("progress", null, null, addDays(started, 2), 12, { progress: Math.min(99, t.progressPct) });
    if (t.status === "blocked") step("status_change", "in_progress", "blocked", addDays(started, 2), 14, { body: t.blockedReason ?? undefined });
    if (t.status === "under_review") step("status_change", "in_progress", "under_review", addDays(started, 3), 14);
    if (t.status === "completed" && t.completedOffset !== null) step("status_change", "in_progress", "completed", addDays(today, t.completedOffset), 15);
    if (t.comment) repo.insertTaskComment({ id: newId(), taskId: id, author: personId.get(t.comment.authorKey) ?? by, body: t.comment.body, now: at(addDays(created, 2), 13) });
  }

  /** A few real-looking notifications, so "View as" an employee shows a bell with something in it. */
  private insertNotifications(repo: ReturnType<AuthStore["demo"]>, tasks: DemoTask[], taskId: Map<string, string>, personId: Map<string, string>, today: string, now: string): void {
    for (const t of tasks) {
      if (t.status === "completed" || t.status === "cancelled" || t.dueOffset === null) continue;
      const due = addDays(today, t.dueOffset);
      const id = taskId.get(t.key)!;
      const recipient = personId.get(t.assigneeKey)!;
      if (t.dueOffset < 0) repo.insertNotification({ id: newId(), recipientId: recipient, type: "task.overdue", title: `Overdue: ${t.title}`, body: `This was due on ${due}.`, severity: "warning", taskId: id, dedupeKey: `task.overdue:${id}:${due}`, now });
      else if (t.dueOffset <= 1) repo.insertNotification({ id: newId(), recipientId: recipient, type: "task.due_soon", title: `${t.dueOffset === 0 ? "Due today" : "Due tomorrow"}: ${t.title}`, body: `Due on ${due}.`, severity: "info", taskId: id, dedupeKey: `task.due_soon:${id}:${due}`, now });
    }
  }

  // ---------- remove ----------

  remove(auth: AuthContext, requestId: string, caps: Capabilities): DemoStatus {
    this.requireManage(caps);
    const ctx = this.ctx(auth, requestId);
    const tdb = this.o.store.tenant(ctx);
    const repo = this.o.store.demo(tdb);
    const batch = repo.loadedBatch();
    if (!batch) throw new HttpError(409, "demo_not_loaded", "There is no demo data to remove.");
    const blockers = repo.blockers();
    if (blockers.length > 0) {
      throw new HttpError(409, "demo_blocked", "Demo data cannot be removed yet: some of your own data still points at it. Nothing was changed.", { blockers });
    }
    const now = this.o.auth.iso();
    const counts = repo.counts();
    this.o.store.transaction(() => {
      const userIds = repo.demoUserIds();
      repo.deleteAll();
      this.o.store.sessions.deleteForUsers(userIds);
      this.o.store.users.deleteDemo(userIds);
      repo.markRemoved(batch.id, ctx.membershipId, now);
      this.o.audit.record(tdb, ctx, { action: "demo.remove", entityType: "demo", entityId: null, summary: `Removed demo data: ${counts.people} people, ${counts.departments} departments, ${counts.teams} teams, ${counts.tasks} tasks`, before: counts });
    });
    return this.status(auth, requestId, caps);
  }

  // ---------- view as ----------

  personas(auth: AuthContext, requestId: string, caps: Capabilities): Persona[] {
    this.requireManage(caps);
    const tdb = this.o.store.tenant(this.ctx(auth, requestId));
    const rows = this.o.store.demo(tdb).personas();
    const managerOf = new Map(rows.map((p) => [p.id, p.manager_id]));
    const depth = (id: string): number => {
      let n = 0;
      for (let cur = managerOf.get(id) ?? null; cur && n < 20; cur = managerOf.get(cur) ?? null) n += 1;
      return n;
    };
    return rows.map((p) => {
      const d = depth(p.id);
      const group: Persona["group"] = p.manager_id === null ? "leadership" : p.direct_reports > 0 ? (d === 1 ? "heads" : "managers") : "employees";
      return { id: p.id, name: p.display_name, designation: p.designation, department: p.department, roles: p.role_names ? p.role_names.split(", ") : [], group };
    });
  }

  /** Opens the read-only session. The route sets the cookies. Another organization's person, or a real person, is 404. */
  viewAs(auth: AuthContext, requestId: string, caps: Capabilities, membershipId: string): { session: ReturnType<AuthService["openImpersonation"]>; personName: string } {
    this.requireManage(caps);
    const ctx = this.ctx(auth, requestId);
    const tdb = this.o.store.tenant(ctx);
    if (auth.impersonatedByUserId) throw new HttpError(409, "already_viewing", "Stop viewing as the current person first.");
    const p = this.o.store.demo(tdb).persona(membershipId);
    if (!p || p.is_demo !== 1) throw notFound(); // a real person can never be viewed as
    let session!: ReturnType<AuthService["openImpersonation"]>;
    this.o.store.transaction(() => {
      session = this.o.auth.openImpersonation(p.user_id, ctx.organizationId, auth.userId);
      this.o.audit.record(tdb, ctx, { action: "demo.view_as", entityType: "membership", entityId: p.id, summary: `Started viewing as the demo person ${p.display_name} (read only)` });
    });
    return { session, personName: p.display_name };
  }

  /** Ends the read-only session of the demo person the caller is viewing as. Returns who the administrator is. */
  stopViewing(auth: AuthContext, requestId: string): { adminUserId: string } {
    if (!auth.impersonatedByUserId || !auth.organizationId || !auth.membershipId) throw new HttpError(409, "not_viewing", "You are not viewing as a demo person.");
    const tdb = this.o.auth.tenantDb({ userId: auth.userId, membershipId: auth.membershipId, organizationId: auth.organizationId, sessionId: auth.sessionId, requestId });
    const admin = this.o.store.memberships(tdb).findActiveForUser(auth.impersonatedByUserId);
    const person = this.o.store.memberships(tdb).findById(auth.membershipId);
    this.o.store.transaction(() => {
      this.o.auth.logout(auth);
      if (admin) {
        const ctx: TenantCtx = { userId: auth.impersonatedByUserId!, membershipId: admin.id, organizationId: auth.organizationId!, sessionId: auth.sessionId, requestId };
        this.o.audit.record(tdb, ctx, { action: "demo.view_as_stop", entityType: "membership", entityId: auth.membershipId, summary: `Stopped viewing as the demo person ${person?.display_name ?? ""}`.trim() });
      }
    });
    return { adminUserId: auth.impersonatedByUserId };
  }
}
