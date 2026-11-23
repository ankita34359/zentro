import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ListTodo, Plus, Sparkles } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { FormAlert, FormField, FormNotice } from "@/components/common/FormField";
import { PageHeader } from "@/components/common/PageHeader";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { SelectField } from "@/components/common/SelectField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { problemText } from "@/lib/authForm";
import { cn } from "@/lib/cn";
import { listPeople } from "@/services/people";
import { createTask, getMyWork, listTasks, PRIORITY_LABEL, sendDailyUpdate, STATUS_LABEL, type NewTask, type TaskSummary } from "@/services/tasks";
import { TaskDrawer } from "./TaskDrawer";
import { TaskRow } from "./taskUi";

const area = "w-full rounded-lg border border-input bg-card px-3 py-2 text-body text-foreground shadow-xs";

/**
 * My Work (stages 4.1 and 4.4): today's workspace and every task you may see. The suggested order is a plain rule (overdue,
 * due soon, priority, importance), and each task says why it is where it is. Opening a task shows it in the panel on the
 * right (`?task=<id>` in the address).
 */
export default function MyWorkPage() {
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const { can } = useAuth();
  const onAll = pathname.replace(/\/+$/, "").endsWith("/tasks");
  const taskId = params.get("task");
  const work = useQuery({ queryKey: ["my-work"], queryFn: getMyWork, retry: false });
  const today = work.data?.today ?? new Date().toISOString().slice(0, 10);
  const openTask = (id: string) => setParams((p) => { const n = new URLSearchParams(p); n.set("task", id); return n; });
  const closeTask = () => setParams((p) => { const n = new URLSearchParams(p); n.delete("task"); return n; }, { replace: true });
  const canCreate = can("task.create");

  const tab = (to: string, label: string, active: boolean, Icon: typeof ListTodo) => (
    <Link to={{ pathname: to, search: params.toString() ? `?${params.toString()}` : "" }} role="tab" aria-selected={active} className={cn("-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-label font-medium", active ? "border-primary text-primary-ink" : "border-transparent text-muted-foreground hover:text-foreground")}>
      <Icon aria-hidden="true" className="size-4" /> {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        eyebrow="Execution"
        title="My Work"
        description="Your tasks, what to do first and why, and a short update for the day."
        actions={canCreate ? <Button size="sm" onClick={() => setAdding(true)}><Plus aria-hidden="true" /> New task</Button> : undefined}
      />
      {adding && canCreate && <NewTaskForm onDone={() => setAdding(false)} onCreated={(id) => { setAdding(false); openTask(id); }} />}
      <div role="tablist" aria-label="My Work views" className="mb-5 flex border-b">
        {tab("/my-work", "Today", !onAll, Sparkles)}
        {tab("/my-work/tasks", "All tasks", onAll, ListTodo)}
      </div>
      {onAll ? <AllTasks today={today} onOpen={openTask} /> : <Today work={work} onOpen={openTask} canCreate={canCreate} onAdd={() => setAdding(true)} />}
      <TaskDrawer id={taskId} today={today} onClose={closeTask} />
    </>
  );
}

// ---------- today ----------

function Today({ work, onOpen, canCreate, onAdd }: { work: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getMyWork>>>>; onOpen: (id: string) => void; canCreate: boolean; onAdd: () => void }) {
  if (work.isPending) return <PageSkeleton />;
  if (work.isError) return <ErrorState title="Your work could not be loaded" error={work.error} onRetry={() => void work.refetch()} />;
  const w = work.data;
  const group = (title: string, tasks: TaskSummary[], hint?: string): ReactNode =>
    tasks.length === 0 ? null : (
      <section aria-label={title} key={title}>
        <h3 className="mb-2 flex items-center gap-2 text-label font-semibold">
          {title} <Badge variant="neutral">{tasks.length}</Badge>
        </h3>
        {hint && <p className="mb-2 text-caption text-muted-foreground">{hint}</p>}
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} today={w.today} onOpen={() => onOpen(t.id)} />
          ))}
        </ul>
      </section>
    );
  const nothing = w.counts.open === 0 && w.achievements.length === 0;
  return (
    <div className="space-y-6">
      <dl aria-label="Summary" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Open", w.counts.open, ""],
          ["Overdue", w.counts.overdue, w.counts.overdue > 0 ? "text-off-track-ink" : ""],
          ["Due today", w.counts.dueToday, ""],
          ["Blocked", w.counts.blocked, w.counts.blocked > 0 ? "text-at-risk-ink" : ""],
          ["Done lately", w.counts.completedRecently, ""],
        ].map(([label, n, tone]) => (
          <div key={label as string} className="rounded-xl border bg-card px-4 py-3">
            <dt className="text-caption font-medium text-muted-foreground">{label}</dt>
            <dd className={cn("mt-1 text-display font-bold tabular-nums", tone as string)}>{n}</dd>
          </div>
        ))}
      </dl>

      {nothing ? (
        <EmptyState illustration="tasks" title="No tasks yet" action={canCreate ? <Button size="sm" onClick={onAdd}>Create a task</Button> : undefined}>
          Tasks you create, or that a manager gives you, appear here with what to do first. You can also send a short update for the day below.
        </EmptyState>
      ) : (
        <>
          {w.suggested.length > 0 && (
            <Card lift={false}>
              <CardHeader>
                <CardTitle>What to do first</CardTitle>
                <p className="text-label text-muted-foreground">A simple order, not a judgement: late work first, then what is due soon, then priority and importance. Each task says why.</p>
              </CardHeader>
              <CardContent>
                <ol aria-label="Suggested order" className="divide-y overflow-hidden rounded-xl border bg-card">
                  {w.suggested.map((s, i) => (
                    <li key={s.task.id}>
                      <button type="button" onClick={() => onOpen(s.task.id)} aria-label={`Open task ${i + 1}: ${s.task.title}`} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/60">
                        <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-caption font-semibold text-primary-soft-foreground">{i + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body font-medium">{s.task.title}</span>
                          <span className="mt-1 flex flex-wrap gap-1.5">
                            {s.reasons.map((r) => (
                              <Badge key={r} variant={r.startsWith("Overdue") ? "offTrack" : r.startsWith("Blocked") ? "atRisk" : "neutral"}>{r}</Badge>
                            ))}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
          <div className="space-y-5">
            {group("Overdue", w.overdue)}
            {group("Due today", w.dueToday)}
            {group("Coming up this week", w.upcoming)}
            {group("In progress", w.inProgress)}
            {group("Blocked", w.blocked, "Tell the person who created the task what you need.")}
            {group("No due date", w.unscheduled)}
          </div>
        </>
      )}

      <DailyUpdate existing={w.dailyUpdate} today={w.today} />

      {w.achievements.length > 0 && (
        <section aria-label="Recently completed">
          <h3 className="mb-2 flex items-center gap-2 text-label font-semibold">
            <CheckCircle2 aria-hidden="true" className="size-4 text-on-track-ink" /> Completed in the last two weeks
          </h3>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {w.achievements.map((t) => (
              <TaskRow key={t.id} task={t} today={w.today} onOpen={() => onOpen(t.id)} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function DailyUpdate({ existing, today }: { existing: { date: string; summary: string; blockers: string | null } | null; today: string }) {
  const client = useQueryClient();
  const [summary, setSummary] = useState(existing?.summary ?? "");
  const [blockers, setBlockers] = useState(existing?.blockers ?? "");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => sendDailyUpdate({ summary: summary.trim(), blockers: blockers.trim() || null }),
    onSuccess: (r) => {
      setError(null);
      setSent(r.replaced ? "Your update for today was replaced." : "Update sent. Thank you.");
      void client.invalidateQueries({ queryKey: ["my-work"] });
    },
    onError: (e) => setError(problemText(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setSent(null);
    if (!summary.trim()) return setError("Write what you did or plan to do");
    setError(null);
    send.mutate();
  }
  return (
    <Card lift={false}>
      <CardHeader>
        <CardTitle>Your update for today</CardTitle>
        <p className="text-label text-muted-foreground">{existing ? `Sent for ${existing.date}. You can change it until the day ends.` : `A line or two on ${today}: what you did, what you plan, and anything in the way.`}</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate aria-label="Daily update" className="space-y-3">
          {error && <FormAlert>{error}</FormAlert>}
          {sent && <FormNotice>{sent}</FormNotice>}
          <div className="space-y-1.5">
            <label htmlFor="du-summary" className="text-label font-medium">What did you do, and what is next?</label>
            <textarea id="du-summary" className={area} rows={3} maxLength={4000} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </div>
          <FormField label="Anything in the way? (optional)" value={blockers} maxLength={2000} onChange={(e) => setBlockers(e.target.value)} />
          <Button type="submit" disabled={send.isPending}>
            {send.isPending ? "Sending…" : existing ? "Replace my update" : "Send update"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------- all tasks ----------

function AllTasks({ today, onOpen }: { today: string; onOpen: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [mine, setMine] = useState(false);
  const [overdue, setOverdue] = useState(false);
  const filters = { search: search.trim() || undefined, status: status || undefined, mine, overdue };
  const q = useQuery({ queryKey: ["tasks", filters], queryFn: () => listTasks(filters), retry: false, placeholderData: (p) => p });
  const filtered = Boolean(filters.search || status || mine || overdue);
  return (
    <section aria-label="All tasks" className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <input aria-label="Search tasks" type="search" placeholder="Search by title" value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 w-full rounded-lg border border-input bg-card px-3 text-body text-foreground shadow-xs" />
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 w-full rounded-lg border border-input bg-card px-3 text-body text-foreground shadow-xs">
          <option value="">Any status</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-label"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only tasks I do</label>
        <label className="flex items-center gap-2 text-label"><input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} /> Only overdue</label>
      </div>
      {q.isPending ? (
        <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : q.isError ? (
        <ErrorState title="The tasks could not be loaded" error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.tasks.length === 0 ? (
        <EmptyState illustration="tasks" title={filtered ? "No tasks match" : "No tasks yet"}>{filtered ? "Change the search or the filters." : "Tasks you can see appear here: ones you created or do, and those of the people you manage."}</EmptyState>
      ) : (
        <>
          <ul aria-label="Task list" className="divide-y overflow-hidden rounded-xl border bg-card">
            {q.data.tasks.map((t) => (
              <TaskRow key={t.id} task={t} today={today} onOpen={() => onOpen(t.id)} />
            ))}
          </ul>
          <p role="status" className="text-caption text-muted-foreground">Showing {q.data.tasks.length} of {q.data.total} {q.data.total === 1 ? "task" : "tasks"}{q.data.total > q.data.tasks.length ? ". Search or filter to narrow the list." : "."}</p>
        </>
      )}
    </section>
  );
}

// ---------- new task ----------

function NewTaskForm({ onDone, onCreated }: { onDone: () => void; onCreated: (id: string) => void }) {
  const client = useQueryClient();
  const { can } = useAuth();
  const canAssign = can("task.assign");
  const people = useQuery({ queryKey: ["people", "all"], queryFn: () => listPeople({ limit: 500 }), enabled: canAssign, retry: false });
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueAt, setDueAt] = useState("");
  const [estimate, setEstimate] = useState("");
  const [assignee, setAssignee] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | undefined>();
  const create = useMutation({
    mutationFn: (b: NewTask) => createTask(b),
    onSuccess: (t) => {
      for (const k of ["tasks", "my-work", "audit"]) void client.invalidateQueries({ queryKey: [k] });
      onCreated(t.id);
    },
    onError: (e) => setError(problemText(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setTitleError("Give the task a title");
    setTitleError(undefined);
    const est = estimate === "" ? undefined : Number(estimate);
    if (est !== undefined && (!Number.isInteger(est) || est < 1)) return setError("An estimate is a whole number of minutes");
    setError(null);
    create.mutate({ title: title.trim(), priority, ...(description.trim() ? { description: description.trim() } : {}), ...(dueAt ? { dueAt } : {}), ...(est !== undefined ? { estimatedMinutes: est } : {}), ...(assignee ? { assigneeIds: [assignee] } : {}) });
  }
  return (
    <Card lift={false} className="mb-6">
      <CardHeader>
        <CardTitle>New task</CardTitle>
        <p className="text-label text-muted-foreground">{canAssign ? "Leave the person empty to create it for yourself, or choose someone in your scope." : "The task is created for you."}</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate aria-label="New task" className="grid gap-3 sm:grid-cols-2">
          {error && <div className="sm:col-span-2"><FormAlert>{error}</FormAlert></div>}
          <div className="sm:col-span-2"><FormField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} error={titleError} maxLength={160} autoComplete="off" /></div>
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="nt-desc" className="text-label font-medium">Description (optional)</label>
            <textarea id="nt-desc" className={area} rows={2} value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <SelectField label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
            {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </SelectField>
          <FormField label="Due date (optional)" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          <FormField label="Estimate in minutes (optional)" type="number" inputMode="numeric" min={1} value={estimate} onChange={(e) => setEstimate(e.target.value)} />
          {canAssign && (
            <SelectField label="Give it to" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Me</option>
              {(people.data?.people ?? []).filter((p) => !p.archived).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </SelectField>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create task"}
            </Button>
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
