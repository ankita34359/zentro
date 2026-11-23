import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ErrorState } from "@/components/common/ErrorState";
import { FormAlert, FormField, FormNotice } from "@/components/common/FormField";
import { SelectField } from "@/components/common/SelectField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SheetRight } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { problemText } from "@/lib/authForm";
import { timeAgo } from "@/lib/format";
import { ApiError } from "@/services/api";
import {
  addKeyResult, archiveObjective, getObjective, getObjectiveHistory, LEVEL_LABEL, LIFECYCLE_LABEL, publishObjective, recordProgress, SOURCE_LABEL, updateObjective, valueText,
  type KeyResult, type ObjectiveDetail,
} from "@/services/okr";
import { listTasks } from "@/services/tasks";
import { Attainment, LifecycleBadge, whereText } from "./okrUi";

const field = "h-10 w-full rounded-lg border border-input bg-card px-3 text-body text-foreground shadow-xs";
const REFRESH = ["objectives", "objective", "objective-history", "overview", "audit", "linkable", "tasks"];

/** The right-hand panel with one objective. `id` null = closed. */
export function ObjectiveDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  return (
    <SheetRight open={id !== null} onOpenChange={(o) => !o && onClose()} title="Objective" description="Key results, recorded values, linked tasks and history of one objective." className="w-[36rem]">
      {id && <Body key={id} id={id} />}
    </SheetRight>
  );
}

function Body({ id }: { id: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["objective", id], queryFn: () => getObjective(id), retry: false });
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (v: { fn: () => Promise<unknown>; done: string }) => v.fn().then(() => v.done),
    onSuccess: (done) => {
      setProblem(null);
      setNotice(done);
      for (const k of REFRESH) void client.invalidateQueries({ queryKey: [k] });
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
        <ErrorState title={gone ? "This objective is not in your view" : "The objective could not be loaded"} error={gone ? undefined : q.error} onRetry={gone ? undefined : () => void q.refetch()} />
        <Dialog.Close asChild>
          <Button variant="outline" className="mt-4">Close</Button>
        </Dialog.Close>
      </div>
    );
  }
  const o = q.data;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start gap-3 border-b p-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-heading font-semibold">{o.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <LifecycleBadge lifecycle={o.lifecycle} />
            <Badge variant="neutral">{whereText(o)}</Badge>
            {o.published && <Badge variant="info">Published</Badge>}
            {o.archived && <Badge variant="dashed">Archived</Badge>}
            {o.isDemo && <Badge variant="dashed">Demo data</Badge>}
          </div>
        </div>
        <Dialog.Close asChild>
          <Button variant="ghost" size="icon" aria-label="Close objective">
            <X aria-hidden="true" />
          </Button>
        </Dialog.Close>
      </header>
      <div className="flex-1 space-y-6 p-5">
        {notice && <FormNotice>{notice}</FormNotice>}
        {problem && <FormAlert>{problem}</FormAlert>}
        <Attainment pct={o.attainmentPct} dataState={o.dataState} coveragePct={o.coveragePct} elapsedPct={o.elapsedPct} label={`Progress of ${o.title}`} />
        <dl className="grid gap-3 text-label sm:grid-cols-2">
          <Fact label="Level">{LEVEL_LABEL[o.level]}</Fact>
          <Fact label="Runs">{o.startDate} to {o.endDate}</Fact>
          <Fact label="Owner">{o.owner?.name ?? "Not set"}</Fact>
          <Fact label="Created by">{o.createdBy.name}</Fact>
          <Fact label="Linked tasks">{o.tasks.total === 0 ? "None yet" : `${o.tasks.total} (${o.tasks.open} open)`}</Fact>
          <Fact label="Priority">{o.priority}</Fact>
        </dl>
        {o.description && <p className="whitespace-pre-wrap text-body">{o.description}</p>}
        <KeyResults o={o} busy={run.isPending} act={act} />
        {o.can.edit && <AddKeyResult o={o} busy={run.isPending} act={act} />}
        <LinkedTasks id={id} />
        {(o.can.edit || o.can.publish || o.can.archive) && <ManageSection o={o} busy={run.isPending} act={act} onGone={() => undefined} />}
        <History id={id} />
      </div>
    </div>
  );
}

type Act = (fn: () => Promise<unknown>, done: string) => void;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-caption font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

// ---------- key results and recording actual values ----------

function KeyResults({ o, busy, act }: { o: ObjectiveDetail; busy: boolean; act: Act }) {
  return (
    <section aria-label="Key results" className="space-y-3">
      <h3 className="text-label font-semibold">Key results</h3>
      {o.keyResults.length === 0 ? (
        <p className="text-label text-muted-foreground">No key results yet. Without them this objective cannot show progress.</p>
      ) : (
        <ul className="space-y-3">
          {o.keyResults.map((k) => <KeyResultCard key={k.id} k={k} o={o} busy={busy} act={act} />)}
        </ul>
      )}
    </section>
  );
}

function KeyResultCard({ k, o, busy, act }: { k: KeyResult; o: ObjectiveDetail; busy: boolean; act: Act }) {
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const canRecord = o.can.updateProgress && o.lifecycle === "active";
  const from = k.method === "binary" ? "No" : k.method === "manual" ? "0%" : `${k.startValue}${k.unit ? ` ${k.unit}` : ""}`;
  const to = k.method === "binary" ? "Yes" : k.method === "manual" ? "100%" : `${k.targetValue}${k.unit ? ` ${k.unit}` : ""}`;
  function submit(e: FormEvent) {
    e.preventDefault();
    const n = k.method === "binary" ? Number(value) : Number(value);
    if (value === "" || !Number.isFinite(n)) return setErr(k.method === "binary" ? "Choose yes or no" : "The actual value must be a number");
    setErr(null);
    act(() => recordProgress(k.id, { value: n, ...(note.trim() ? { note: note.trim() } : {}) }), "Value recorded.");
    setValue("");
    setNote("");
  }
  return (
    <li className="space-y-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-body font-medium">{k.title}</span>
        {k.owner && <span className="text-caption text-muted-foreground">{k.owner.name}</span>}
      </div>
      <Attainment pct={k.attainmentPct} label={`Progress of ${k.title}`} compact />
      <p className="text-caption text-muted-foreground">
        {k.direction === "increase" ? "From" : "Down from"} {from} to {to} · now: <strong className="text-foreground">{valueText(k)}</strong>
        {k.currentAsOf ? ` (as of ${k.currentAsOf})` : ""}
      </p>
      {k.regressed && <p className="text-caption text-at-risk-ink">It has moved backwards from where it started.</p>}
      {k.capped && <p className="text-caption text-muted-foreground">Beyond the target: counted as 100%.</p>}
      {canRecord && (
        <form noValidate aria-label={`Record a value for ${k.title}`} onSubmit={submit} className="grid gap-2 border-t pt-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          {err && <div className="sm:col-span-3"><FormAlert>{err}</FormAlert></div>}
          {k.method === "binary" ? (
            <SelectField label="Done?" value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Choose</option>
              <option value="1">Yes</option>
              <option value="0">No</option>
            </SelectField>
          ) : (
            <FormField label={k.method === "manual" ? "Actual (%, 0 to 100)" : `Actual value${k.unit ? ` (${k.unit})` : ""}`} type="number" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          )}
          <FormField label="Note (optional)" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
          <Button type="submit" size="sm" variant="outline" disabled={busy}>Record</Button>
        </form>
      )}
    </li>
  );
}

function AddKeyResult({ o, busy, act }: { o: ObjectiveDetail; busy: boolean; act: Act }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [direction, setDirection] = useState<"increase" | "decrease">("increase");
  const [start, setStart] = useState("0");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (o.lifecycle === "completed" || o.lifecycle === "cancelled" || o.keyResults.length >= 12) return null;
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus aria-hidden="true" /> Add a key result</Button>;
  return (
    <form
      noValidate
      aria-label="Add a key result"
      className="grid gap-2 rounded-lg border p-4 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        const s = Number(start === "" ? "0" : start);
        const t = Number(target);
        if (!title.trim()) return setErr("Give the key result a title");
        if (target === "" || !Number.isFinite(t) || !Number.isFinite(s)) return setErr("The start and the target must be numbers");
        setErr(null);
        act(() => addKeyResult(o.id, { title: title.trim(), direction, startValue: s, targetValue: t, ...(unit.trim() ? { unit: unit.trim() } : {}) }), "Key result added.");
        setOpen(false);
        setTitle("");
        setTarget("");
      }}
    >
      {err && <div className="sm:col-span-4"><FormAlert>{err}</FormAlert></div>}
      <div className="sm:col-span-4"><FormField label="New key result" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} /></div>
      <SelectField label="Should it" value={direction} onChange={(e) => setDirection(e.target.value as "increase" | "decrease")}>
        <option value="increase">Go up</option>
        <option value="decrease">Go down</option>
      </SelectField>
      <FormField label="From" type="number" inputMode="decimal" value={start} onChange={(e) => setStart(e.target.value)} />
      <FormField label="To" type="number" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
      <FormField label="Unit" value={unit} maxLength={20} onChange={(e) => setUnit(e.target.value)} />
      <div className="flex gap-2 sm:col-span-4">
        <Button type="submit" size="sm" disabled={busy}>Add</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}

// ---------- tasks that support it ----------

function LinkedTasks({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["tasks", { objectiveId: id }], queryFn: () => listTasks({ objectiveId: id, limit: 50 }), retry: false });
  if (!q.data || q.data.tasks.length === 0) return (
    <section aria-label="Tasks that support this objective" className="space-y-2">
      <h3 className="text-label font-semibold">Tasks that support it</h3>
      <p className="text-label text-muted-foreground">No task is linked yet. Open a task in My Work to link it here. Finishing tasks does not move this objective by itself; record the actual values above.</p>
    </section>
  );
  return (
    <section aria-label="Tasks that support this objective" className="space-y-2">
      <h3 className="text-label font-semibold">Tasks that support it</h3>
      <ul className="divide-y rounded-lg border">
        {q.data.tasks.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className="text-body">{t.title}</span>
            <span className="text-caption text-muted-foreground">{t.status.replace("_", " ")}{t.assignees[0] ? ` · ${t.assignees[0].name}` : ""}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- lifecycle, publishing, archiving ----------

function ManageSection({ o, busy, act }: { o: ObjectiveDetail; busy: boolean; act: Act; onGone: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <section aria-label="Manage this objective" className="space-y-3 rounded-lg border p-4">
      <h3 className="text-label font-semibold">Manage</h3>
      {o.can.edit && o.nextLifecycles.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Move to">
          {o.nextLifecycles.map((s) => (
            <Button key={s} size="sm" variant={s === "completed" ? "default" : "outline"} disabled={busy || o.archived} onClick={() => act(() => updateObjective(o.id, { lifecycle: s }), `Moved to ${LIFECYCLE_LABEL[s]?.toLowerCase()}.`)}>
              {s === "active" && o.lifecycle === "draft" ? "Activate" : s === "active" ? "Reopen" : s === "draft" ? "Back to draft" : s === "completed" ? "Mark completed" : "Cancel the objective"}
            </Button>
          ))}
        </div>
      )}
      {o.can.publish && !o.archived && (
        <Button size="sm" variant="outline" disabled={busy || (!o.published && o.lifecycle === "draft")} onClick={() => act(() => publishObjective(o.id, !o.published), o.published ? "No longer published." : "Published: everyone in the organization can now see it.")}>
          {o.published ? "Unpublish" : "Publish to the organization"}
        </Button>
      )}
      {o.can.archive && !o.archived && (confirm ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-label">Archive this objective? It leaves the list but its history is kept.</span>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => { act(() => archiveObjective(o.id), "Archived."); setConfirm(false); }}>Confirm archive</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
        </div>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>Archive…</Button>
      ))}
    </section>
  );
}

// ---------- history ----------

function History({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["objective-history", id], queryFn: () => getObjectiveHistory(id), retry: false });
  return (
    <section aria-label="History" className="space-y-2">
      <h3 className="text-label font-semibold">History of recorded values</h3>
      {q.isPending ? <Skeleton className="h-16 w-full" /> : q.isError ? <p className="text-label text-off-track-ink">The history could not be loaded.</p> : q.data.length === 0 ? (
        <p className="text-label text-muted-foreground">Nothing has been recorded yet.</p>
      ) : (
        <ol className="space-y-2">
          {[...q.data].reverse().map((h) => (
            <li key={h.id} className="rounded-lg border px-3 py-2 text-label">
              <span className="font-medium">{h.keyResultTitle ?? "Objective"}</span>
              {h.value !== null && <> · {h.value}</>}
              {h.attainmentPct !== null && <> ({h.attainmentPct}%)</>}
              <span className="block text-caption text-muted-foreground">
                {SOURCE_LABEL[h.source] ?? h.source}{h.by ? ` · ${h.by.name}` : ""} · {timeAgo(h.recordedAt)}
              </span>
              {h.note && <span className="block text-caption">{h.note}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
