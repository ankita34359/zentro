import type { ReactNode } from "react";
import { AlertTriangle, CalendarDays, Clock, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { minutesLabel, PRIORITY_LABEL, STATUS_LABEL, type TaskSummary } from "@/services/tasks";

const STATUS_VARIANT: Record<string, "neutral" | "info" | "offTrack" | "atRisk" | "onTrack" | "dashed"> = {
  not_started: "neutral",
  in_progress: "info",
  blocked: "offTrack",
  under_review: "atRisk",
  completed: "onTrack",
  cancelled: "dashed",
};

export function TaskStatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</Badge>;
}

/** "Due today", "Due tomorrow", "Overdue by 3 days", or the date. Always words, never colour alone. */
export function dueText(t: Pick<TaskSummary, "dueAt" | "overdue" | "status">, today: string): string | null {
  if (!t.dueAt) return null;
  const days = Math.round((Date.parse(`${t.dueAt}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (t.status === "completed" || t.status === "cancelled") return `Due ${t.dueAt}`;
  if (days < 0) return days === -1 ? "Overdue by 1 day" : `Overdue by ${-days} days`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due ${t.dueAt}`;
}

/** One task as a row you can open. A button, so it works with the keyboard and on a phone. */
export function TaskRow({ task, today, onOpen, extra }: { task: TaskSummary; today: string; onOpen: () => void; extra?: ReactNode }) {
  const due = dueText(task, today);
  const people = task.assignees.filter((a) => a.role === "assignee").map((a) => a.name);
  return (
    <li>
      <button type="button" onClick={onOpen} aria-label={`Open task: ${task.title}`} className="flex w-full flex-col gap-1.5 px-4 py-3 text-left hover:bg-muted/60">
        <span className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-body font-medium">{task.title}</span>
          <TaskStatusBadge status={task.status} />
          {(task.priority === "high" || task.priority === "critical") && <Badge variant={task.priority === "critical" ? "offTrack" : "atRisk"}>{PRIORITY_LABEL[task.priority]}</Badge>}
        </span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted-foreground">
          {due && (
            <span className={cn("inline-flex items-center gap-1", task.overdue && "font-medium text-off-track-ink")}>
              {task.overdue ? <AlertTriangle aria-hidden="true" className="size-3.5" /> : <CalendarDays aria-hidden="true" className="size-3.5" />}
              {due}
            </span>
          )}
          {people.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Users aria-hidden="true" className="size-3.5" />
              {people.join(", ")}
            </span>
          )}
          {task.estimatedMinutes !== null && (
            <span className="inline-flex items-center gap-1">
              <Clock aria-hidden="true" className="size-3.5" />
              {minutesLabel(task.actualMinutes)} of {minutesLabel(task.estimatedMinutes)}
            </span>
          )}
          {task.progressPct > 0 && task.status !== "completed" && <span>{task.progressPct}% done</span>}
          {task.isDemo && <Badge variant="dashed">Demo data</Badge>}
        </span>
        {extra}
      </button>
    </li>
  );
}
