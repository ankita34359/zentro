import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Pencil, Trash2, UserMinus, UserPlus, X } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { ErrorState } from "@/components/common/ErrorState";
import { FormAlert, FormNotice } from "@/components/common/FormField";
import { SelectField } from "@/components/common/SelectField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SheetRight } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { problemText } from "@/lib/authForm";
import { timeAgo } from "@/lib/format";
import { ApiError } from "@/services/api";
import { listPeople } from "@/services/people";
import {
  addComment, addTaskUpdate, assignTask, deleteComment, getComments, getTask, getUpdates, minutesLabel, PRIORITY_LABEL, STATUS_LABEL, unassignTask, updateTask,
  type TaskDetail, type UpdateEntry,
} from "@/services/tasks";
import { AlignmentSection } from "./AlignmentSection";
import { dueText, TaskStatusBadge } from "./taskUi";

const field = "h-10 w-full rounded-lg border border-input bg-card px-3 text-body text-foreground shadow-xs";
const area = "w-full rounded-lg border border-input bg-card px-3 py-2 text-body text-foreground shadow-xs";

function Labeled({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-label font-medium">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

/** The right-hand panel with one task. `id` null = closed. */
export function TaskDrawer({ id, today, onClose }: { id: string | null; today: string; onClose: () => void }) {
  return (
    <SheetRight open={id !== null} onOpenChange={(o) => !o && onClose()} title="Task" description="Details, progress, people, comments and history of one task." className="w-[36rem]">
      {id && <Body key={id} id={id} today={today} />}
    </SheetRight>
  );
}

const REFRESH = ["task", "task-updates", "task-comments", "tasks", "my-work", "notifications", "objectives", "objective", "objective-history", "overview"];

function Body({ id, today }: { id: string; today: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["task", id], queryFn: () => getTask(id), retry: false });
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => {
    for (const k of REFRESH) void client.invalidateQueries({ queryKey: [k] });
  };
  /** One change at a time; the server's refusal is shown in its own words. */
  const run = useMutation({
    mutationFn: (v: { fn: () => Promise<unknown>; done: string }) => v.fn().then(() => v.done),
    onSuccess: (done) => {
      setProblem(null);
      setNotice(done);
      refresh();
    },
    onError: (e) => {
      setNotice(null);
      setProblem(problemText(e));
    },
  });
  const act = (fn: () => Promise<unknown>, done: string) => run.mutate({ fn, done });

  if (q.isPending) {
    return (
      <div className="space-y-4 p-6" aria-busy="true">
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (q.isError) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="p-6">
        <ErrorState title={gone ? "This task is not in your view" : "The task could not be loaded"} error={gone ? undefined : q.error} onRetry={gone ? undefined : () => void q.refetch()} />
        <Dialog.Close asChild>
          <Button variant="outline" className="mt-4">Close</Button>
        </Dialog.Close>
      </div>
    );
  }
  const t = q.data;
  const due = dueText(t, today);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start gap-3 border-b p-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-heading font-semibold">{t.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <TaskStatusBadge status={t.status} />
            <Badge variant="neutral">{PRIORITY_LABEL[t.priority] ?? t.priority} priority</Badge>
            {due && <Badge variant={t.overdue ? "offTrack" : "neutral"}>{due}</Badge>}
            {t.isDemo && <Badge variant="dashed">Demo data</Badge>}
          </div>
        </div>
        <Dialog.Close asChild>
          <Button variant="ghost" size="icon" aria-label="Close task">
            <X aria-hidden="true" />
          </Button>
        </Dialog.Close>
      </header>
      <div className="flex-1 space-y-6 p-5">
        {notice && <FormNotice>{notice}</FormNotice>}
        {problem && <FormAlert>{problem}</FormAlert>}
        <Facts t={t} />
        {t.blockedReason && t.status === "blocked" && (
          <p className="rounded-lg border border-off-track/30 bg-off-track-soft px-3 py-2.5 text-label text-off-track-ink">
            <strong>Blocked:</strong> {t.blockedReason}
          </p>
        )}
        {t.description && <p className="whitespace-pre-wrap text-body">{t.description}</p>}
        {t.can.update && <WorkSection t={t} busy={run.isPending} act={act} />}
        <PeopleSection t={t} busy={run.isPending} act={act} />
        <AlignmentSection t={t} busy={run.isPending} act={act} />
        {(t.can.edit || t.can.editEstimate) && <EditSection t={t} busy={run.isPending} act={act} />}
        <CommentsSection id={id} canComment={t.can.comment} onProblem={setProblem} />
        <HistorySection id={id} />
      </div>
    </div>
  );
}

type Act = (fn: () => Promise<unknown>, done: string) => void;

function Facts({ t }: { t: TaskDetail }) {
  const doers = t.assignees.filter((a) => a.role === "assignee").map((a) => a.name);
  return (
    <dl className="grid gap-3 text-label sm:grid-cols-2">
      <div>
        <dt className="text-caption font-medium uppercase tracking-wide text-muted-foreground">Doing it</dt>
        <dd className="mt-1">{doers.length ? doers.join(", ") : <span className="text-muted-foreground">Nobody yet</span>}</dd>
      </div>
      <div>
        <dt className="text-caption font-medium uppercase tracking-wide text-muted-foreground">Created by</dt>
        <dd className="mt-1">{t.createdBy.name}</dd>
      </div>
      <div>
        <dt className="text-caption font-medium uppercase tracking-wide text-muted-foreground">Progress</dt>
        <dd className="mt-1">{t.status === "completed" ? "Done" : `${t.progressPct}%`}</dd>
      </div>
      <div>
        <dt className="text-caption font-medium uppercase tracking-wide text-muted-foreground">Time</dt>
        <dd className="mt-1">
          {minutesLabel(t.actualMinutes)} logged{t.estimatedMinutes !== null ? ` of ${minutesLabel(t.estimatedMinutes)} estimated` : ""}
          {t.estimatedMinutes !== null && t.actualMinutes > t.estimatedMinutes && <span className="text-at-risk-ink"> (over the estimate)</span>}
        </dd>
      </div>
      {t.team && (
        <div>
          <dt className="text-caption font-medium uppercase tracking-wide text-muted-foreground">Team</dt>
          <dd className="mt-1">{t.team.name}</dd>
        </div>
      )}
      {t.startDate && (
        <div>
          <dt className="text-caption font-medium uppercase tracking-wide text-muted-foreground">Starts</dt>
          <dd className="mt-1">{t.startDate}</dd>
        </div>
      )}
    </dl>
  );
}

// ---------- status, progress, time, blockers ----------

function WorkSection({ t, busy, act }: { t: TaskDetail; busy: boolean; act: Act }) {
  const [ask, setAsk] = useState<null | { status: string }>(null);
  const [note, setNote] = useState("");
  const [pct, setPct] = useState("");
  const [progressNote, setProgressNote] = useState("");
  const [minutes, setMinutes] = useState("");
  const [timeNote, setTimeNote] = useState("");
  const [blocker, setBlocker] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const open = t.status !== "completed" && t.status !== "cancelled";

  const move = (status: string) => {
    if (status === "blocked" || status === "cancelled") {
      setAsk({ status });
      setNote("");
      return;
    }
    act(() => addTaskUpdate(t.id, { type: "status_change", toStatus: status }), `Moved to ${STATUS_LABEL[status]?.toLowerCase()}.`);
  };
  function confirmMove(e: FormEvent) {
    e.preventDefault();
    if (ask!.status === "blocked" && !note.trim()) return setErr("Say what is blocking the task");
    setErr(null);
    act(() => addTaskUpdate(t.id, { type: "status_change", toStatus: ask!.status, ...(note.trim() ? { note: note.trim() } : {}) }), `Moved to ${STATUS_LABEL[ask!.status]?.toLowerCase()}.`);
    setAsk(null);
  }
  return (
    <section aria-label="Update this task" className="space-y-4 rounded-lg border p-4">
      <h3 className="text-label font-semibold">Update</h3>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Move to">
        {t.nextStatuses.map((s) => (
          <Button key={s} size="sm" variant={s === "completed" ? "default" : "outline"} disabled={busy} onClick={() => move(s)}>
            {s === "completed" ? "Mark completed" : s === "in_progress" && t.status === "completed" ? "Reopen" : STATUS_LABEL[s]}
          </Button>
        ))}
      </div>
      {ask && (
        <form onSubmit={confirmMove} noValidate aria-label={ask.status === "blocked" ? "Report a blocker" : "Cancel this task"} className="space-y-2 rounded-lg bg-muted/40 p-3">
          {err && <FormAlert>{err}</FormAlert>}
          <Labeled label={ask.status === "blocked" ? "What is blocking it?" : "Why is it cancelled? (optional)"}>{(id) => <input id={id} className={field} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />}</Labeled>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {ask.status === "blocked" ? "Mark blocked" : "Cancel the task"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAsk(null)}>
              Back
            </Button>
          </div>
        </form>
      )}
      {open && (
        <div className="grid gap-4 sm:grid-cols-2">
          <form
            noValidate
            aria-label="Record progress"
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(pct);
              if (pct === "" || !Number.isInteger(n) || n < 0 || n > 99) return setErr("Progress is a whole number from 0 to 99. Use Mark completed when it is done.");
              setErr(null);
              act(() => addTaskUpdate(t.id, { type: "progress", progressPct: n, ...(progressNote.trim() ? { note: progressNote.trim() } : {}) }), "Progress recorded.");
              setPct("");
              setProgressNote("");
            }}
          >
            <Labeled label="Progress (%)">{(id) => <input id={id} type="number" inputMode="numeric" min={0} max={99} className={field} value={pct} onChange={(e) => setPct(e.target.value)} />}</Labeled>
            <Labeled label="Note (optional)">{(id) => <input id={id} className={field} value={progressNote} maxLength={1000} onChange={(e) => setProgressNote(e.target.value)} />}</Labeled>
            <Button type="submit" size="sm" variant="outline" disabled={busy}>
              Record progress
            </Button>
          </form>
          <form
            noValidate
            aria-label="Log time"
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(minutes);
              if (minutes === "" || !Number.isInteger(n) || n < 1 || n > 1440) return setErr("Time is a whole number of minutes, 1 to 1440");
              setErr(null);
              act(() => addTaskUpdate(t.id, { type: "time_log", minutesLogged: n, ...(timeNote.trim() ? { note: timeNote.trim() } : {}) }), "Time logged.");
              setMinutes("");
              setTimeNote("");
            }}
          >
            <Labeled label="Time spent (minutes)">{(id) => <input id={id} type="number" inputMode="numeric" min={1} max={1440} className={field} value={minutes} onChange={(e) => setMinutes(e.target.value)} />}</Labeled>
            <Labeled label="Note (optional)">{(id) => <input id={id} className={field} value={timeNote} maxLength={1000} onChange={(e) => setTimeNote(e.target.value)} />}</Labeled>
            <Button type="submit" size="sm" variant="outline" disabled={busy}>
              Log time
            </Button>
          </form>
          {t.status !== "blocked" && (
            <form
              noValidate
              aria-label="Report an impediment"
              className="space-y-2 sm:col-span-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!blocker.trim()) return setErr("Say what is in the way");
                setErr(null);
                act(() => addTaskUpdate(t.id, { type: "blocker", note: blocker.trim() }), "Reported. The person who created the task has been told.");
                setBlocker("");
              }}
            >
              <Labeled label="Something in the way, but you can keep going?">{(id) => <input id={id} className={field} value={blocker} maxLength={1000} placeholder="Say what is in the way" onChange={(e) => setBlocker(e.target.value)} />}</Labeled>
              <Button type="submit" size="sm" variant="outline" disabled={busy}>
                Report it
              </Button>
            </form>
          )}
          {err && !ask && <div className="sm:col-span-2"><FormAlert>{err}</FormAlert></div>}
        </div>
      )}
    </section>
  );
}

// ---------- people ----------

function PeopleSection({ t, busy, act }: { t: TaskDetail; busy: boolean; act: Act }) {
  const people = useQuery({ queryKey: ["people", "all"], queryFn: () => listPeople({ limit: 500 }), enabled: t.can.assign, retry: false });
  const [who, setWho] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const taken = new Set(t.assignees.filter((a) => a.role === "assignee").map((a) => a.id));
  return (
    <section aria-label="People" className="space-y-3">
      <h3 className="text-label font-semibold">People</h3>
      {t.assignees.length === 0 ? <p className="text-label text-muted-foreground">Nobody is assigned yet.</p> : (
        <ul className="divide-y rounded-lg border">
          {t.assignees.map((a) => (
            <li key={a.assignmentId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="text-body">
                {a.name} <span className="text-caption text-muted-foreground">{a.kind === "team" ? "team · " : ""}{a.role}</span>
              </span>
              {t.can.assign && (confirm === a.assignmentId ? (
                <span className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={busy} aria-label={`Confirm taking ${a.name} off this task`} onClick={() => { act(() => unassignTask(t.id, a.assignmentId), `${a.name} is off the task.`); setConfirm(null); }}>
                    Confirm
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
                </span>
              ) : (
                <Button size="sm" variant="ghost" aria-label={`Take ${a.name} off this task`} onClick={() => setConfirm(a.assignmentId)}>
                  <UserMinus aria-hidden="true" /> Remove
                </Button>
              ))}
            </li>
          ))}
        </ul>
      )}
      {t.can.assign && (
        <form noValidate aria-label="Add a person" className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (who) { act(() => assignTask(t.id, { assigneeId: who }), "Person added. They have been told."); setWho(""); } }}>
          <div className="min-w-[12rem] flex-1">
            <SelectField label="Add a person" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">Choose a person</option>
              {(people.data?.people ?? []).filter((p) => !p.archived && !taken.has(p.id)).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </SelectField>
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={busy || !who}>
            <UserPlus aria-hidden="true" /> Add
          </Button>
        </form>
      )}
    </section>
  );
}

// ---------- editing ----------

function EditSection({ t, busy, act }: { t: TaskDetail; busy: boolean; act: Act }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(t.title);
  const [description, setDescription] = useState(t.description);
  const [priority, setPriority] = useState(t.priority);
  const [importance, setImportance] = useState(String(t.importanceWeight));
  const [dueAt, setDueAt] = useState(t.dueAt ?? "");
  const [startDate, setStartDate] = useState(t.startDate ?? "");
  const [estimate, setEstimate] = useState(t.estimatedMinutes === null ? "" : String(t.estimatedMinutes));
  const [err, setErr] = useState<string | null>(null);
  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Pencil aria-hidden="true" /> {t.can.edit ? "Edit details" : "Change estimate"}
      </Button>
    );
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    const est = estimate === "" ? null : Number(estimate);
    if (est !== null && (!Number.isInteger(est) || est < 1)) return setErr("An estimate is a whole number of minutes");
    setErr(null);
    act(
      () => updateTask(t.id, t.can.edit ? { title, description, priority, importanceWeight: Number(importance), dueAt: dueAt || null, startDate: startDate || null, estimatedMinutes: est } : { estimatedMinutes: est }),
      "Saved.",
    );
    setOpen(false);
  }
  return (
    <form onSubmit={submit} noValidate aria-label="Edit task" className="grid gap-3 rounded-lg border bg-muted/40 p-4 sm:grid-cols-2">
      {err && <div className="sm:col-span-2"><FormAlert>{err}</FormAlert></div>}
      {t.can.edit && (
        <>
          <div className="sm:col-span-2">
            <Labeled label="Title">{(id) => <input id={id} className={field} value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />}</Labeled>
          </div>
          <div className="sm:col-span-2">
            <Labeled label="Description">{(id) => <textarea id={id} className={area} rows={3} value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} />}</Labeled>
          </div>
          <SelectField label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
            {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </SelectField>
          <SelectField label="Importance (1 to 5)" value={importance} onChange={(e) => setImportance(e.target.value)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </SelectField>
          <Labeled label="Starts">{(id) => <input id={id} type="date" className={field} value={startDate} onChange={(e) => setStartDate(e.target.value)} />}</Labeled>
          <Labeled label="Due">{(id) => <input id={id} type="date" className={field} value={dueAt} onChange={(e) => setDueAt(e.target.value)} />}</Labeled>
        </>
      )}
      <Labeled label="Estimate (minutes)">{(id) => <input id={id} type="number" inputMode="numeric" min={1} className={field} value={estimate} onChange={(e) => setEstimate(e.target.value)} />}</Labeled>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={busy}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ---------- comments and history ----------

function CommentsSection({ id, canComment, onProblem }: { id: string; canComment: boolean; onProblem: (m: string | null) => void }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["task-comments", id], queryFn: () => getComments(id), retry: false });
  const [body, setBody] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const after = () => {
    for (const k of ["task-comments", "notifications"]) void client.invalidateQueries({ queryKey: [k] });
  };
  const add = useMutation({ mutationFn: () => addComment(id, body.trim()), onSuccess: () => { setBody(""); onProblem(null); after(); }, onError: (e) => onProblem(problemText(e)) });
  const del = useMutation({ mutationFn: (cid: string) => deleteComment(id, cid), onSuccess: () => { setConfirm(null); after(); }, onError: (e) => onProblem(problemText(e)) });
  return (
    <section aria-label="Comments" className="space-y-3">
      <h3 className="flex items-center gap-2 text-label font-semibold">
        <MessageSquare aria-hidden="true" className="size-4" /> Comments
      </h3>
      {q.isPending ? <Skeleton className="h-12 w-full" /> : q.isError ? <p className="text-label text-muted-foreground">Comments could not be loaded.</p> : q.data.length === 0 ? <p className="text-label text-muted-foreground">No comments yet.</p> : (
        <ul className="space-y-2">
          {q.data.map((c) => (
            <li key={c.id} className="rounded-lg border bg-card px-3 py-2">
              <p className="flex flex-wrap items-baseline justify-between gap-2 text-caption text-muted-foreground">
                <span><strong className="text-foreground">{c.author.name}</strong> · {timeAgo(c.createdAt)}{c.edited ? " · edited" : ""}</span>
                {c.mine && (confirm === c.id ? (
                  <span className="flex gap-1">
                    <Button size="sm" variant="outline" aria-label="Confirm deleting this comment" disabled={del.isPending} onClick={() => del.mutate(c.id)}>Delete</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Keep</Button>
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" aria-label="Delete your comment" onClick={() => setConfirm(c.id)}><Trash2 aria-hidden="true" /></Button>
                ))}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-body">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      {canComment && (
        <form noValidate aria-label="Add a comment" className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (body.trim()) add.mutate(); }}>
          <Labeled label="Add a comment">{(i) => <textarea id={i} className={area} rows={2} value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} />}</Labeled>
          <Button type="submit" size="sm" variant="outline" disabled={add.isPending || !body.trim()}>
            Comment
          </Button>
        </form>
      )}
    </section>
  );
}

function describe(u: UpdateEntry): string {
  switch (u.type) {
    case "status_change":
      return `Moved from ${STATUS_LABEL[u.fromStatus ?? ""]?.toLowerCase() ?? u.fromStatus} to ${STATUS_LABEL[u.toStatus ?? ""]?.toLowerCase() ?? u.toStatus}`;
    case "progress":
      return `Recorded ${u.progressPct}% progress`;
    case "time_log":
      return `Logged ${minutesLabel(u.minutesLogged ?? 0)}`;
    case "blocker":
      return "Reported something in the way";
    default:
      return u.type;
  }
}

function HistorySection({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["task-updates", id], queryFn: () => getUpdates(id), retry: false });
  return (
    <section aria-label="History" className="space-y-2">
      <h3 className="text-label font-semibold">History</h3>
      {q.isPending ? <Skeleton className="h-12 w-full" /> : q.isError ? <p className="text-label text-muted-foreground">The history could not be loaded.</p> : q.data.length === 0 ? <p className="text-label text-muted-foreground">Nothing has happened yet.</p> : (
        <ul className="divide-y rounded-lg border">
          {[...q.data].reverse().map((u) => (
            <li key={u.id} className="px-3 py-2 text-label">
              <span className="font-medium">{u.author.name}</span> {describe(u).replace(/^./, (c) => c.toLowerCase())}
              {u.body && <span className="text-muted-foreground"> — {u.body}</span>}
              <span className="block text-caption text-muted-foreground">{timeAgo(u.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
