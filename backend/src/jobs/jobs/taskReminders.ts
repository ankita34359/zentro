import { createTenantDb } from "../../db/tenant.js";
import { newId } from "../../lib/ids.js";
import { OrganizationsRepository } from "../../modules/auth/repositories/organizations.js";
import { AutomationEventsRepository } from "../../modules/automation/repositories/events.js";
import { deliverNotification } from "../../modules/notifications/service.js";
import { NotificationsRepository } from "../../modules/notifications/repositories/notifications.js";
import { PeopleRepository } from "../../modules/people/repositories/people.js";
import { addDays, todayIn } from "../../modules/tasks/dates.js";
import { TasksRepository } from "../../modules/tasks/repositories/tasks.js";
import type { JobDef } from "../registry.js";

/**
 * Stage 4.5: every 10 minutes, for every organization, tell people about work that is overdue or due soon.
 *   overdue    an open task past its due day: the people doing it and whoever created it
 *   due soon   an open task due today or tomorrow: the people doing it
 * "Today" is the organization's own day. Each person is told once per task per due date (a dedupe key), so running the
 * job again, or a missed run, never repeats a notice; a task whose due date moves is announced again for the new date.
 * The same fact is written once to the business-event log (`task.overdue`, `task.due_soon`) for the integrations stage.
 */
export const taskRemindersJob: JobDef = {
  name: "tasks.reminders",
  minIntervalSeconds: 10 * 60,
  run: ({ db, now, budgetMs }) => {
    const nowIso = now.toISOString();
    const summary = { organizations: 0, overdue: 0, dueSoon: 0, notifications: 0 };
    for (const org of new OrganizationsRepository(db).listAll()) {
      if (budgetMs() < 5_000) break; // out of time: the rest is still due next tick
      const today = todayIn(org.timezone, now);
      const tomorrow = addDays(today, 1);
      const tdb = createTenantDb(db, { userId: "", membershipId: "", organizationId: org.id, sessionId: "", requestId: "job:tasks.reminders" });
      const tasks = new TasksRepository(tdb);
      const due = tasks.openDueBy(tomorrow);
      summary.organizations += 1;
      if (due.length === 0) continue;
      const live = new Set(new PeopleRepository(tdb).activePersonIds());
      const assigns = new Map<string, string[]>();
      for (const a of tasks.activeAssignments()) {
        if (a.role !== "assignee" || !a.assignee_membership_id || !live.has(a.assignee_membership_id)) continue;
        assigns.set(a.task_id, [...(assigns.get(a.task_id) ?? []), a.assignee_membership_id]);
      }
      const notifications = new NotificationsRepository(tdb);
      const events = new AutomationEventsRepository(tdb);
      tdb.transaction(() => {
        for (const t of due) {
          const doers = assigns.get(t.id) ?? [];
          const overdue = t.due_at! < today;
          const type = overdue ? "task.overdue" : "task.due_soon";
          const recipients = overdue ? [...new Set([...doers, ...(live.has(t.created_by_membership_id) ? [t.created_by_membership_id] : [])])] : doers;
          const key = `${type}:${t.id}:${t.due_at}`;
          const lateBy = overdue ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${t.due_at}T00:00:00Z`)) / 86_400_000) : 0;
          if (recipients.length > 0) {
            summary.notifications += deliverNotification(
              notifications,
              {
                recipients,
                type,
                title: overdue ? `Overdue: ${t.title}` : t.due_at === today ? `Due today: ${t.title}` : `Due tomorrow: ${t.title}`,
                body: overdue ? `This was due on ${t.due_at}${lateBy > 1 ? ` (${lateBy} days ago)` : ""}.` : `Due on ${t.due_at}.`,
                severity: overdue ? "warning" : "info",
                entityType: "task",
                entityId: t.id,
                dedupeKey: key,
              },
              nowIso,
            );
          }
          const written = events.insert({ id: newId(), eventType: type, entityType: "task", entityId: t.id, actorId: null, payloadJson: JSON.stringify({ taskId: t.id, title: t.title, dueAt: t.due_at }), dedupeKey: key, now: nowIso });
          if (written) overdue ? (summary.overdue += 1) : (summary.dueSoon += 1);
        }
      });
    }
    return summary;
  },
};
