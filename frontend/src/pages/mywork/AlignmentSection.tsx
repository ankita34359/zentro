import { useQuery } from "@tanstack/react-query";
import { Link2, Target } from "lucide-react";
import { useState } from "react";
import { FormAlert } from "@/components/common/FormField";
import { SelectField } from "@/components/common/SelectField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getLinkable } from "@/services/okr";
import { addDependency, listTasks, recordOutcome, removeDependency, reviewTask, STATUS_LABEL, updateTask, type TaskDetail } from "@/services/tasks";

type Act = (fn: () => Promise<unknown>, done: string) => void;
const field = "h-10 w-full rounded-lg border border-input bg-card px-3 text-body text-foreground shadow-xs";
const area = "w-full rounded-lg border border-input bg-card px-3 py-2 text-body text-foreground shadow-xs";
const isOpen = (s: string) => s !== "completed" && s !== "cancelled";

/** What the task is for (objective and key result), what it waits for, and what it achieved (outcome and review). Stage 4.2. */
export function AlignmentSection({ t, busy, act }: { t: TaskDetail; busy: boolean; act: Act }) {
  return (
    <>
      <LinksSection t={t} busy={busy} act={act} />
      <DependenciesSection t={t} busy={busy} act={act} />
      {(t.status === "completed" || t.status === "under_review" || t.outcome) && <OutcomeSection t={t} busy={busy} act={act} />}
    </>
  );
}

function LinksSection({ t, busy, act }: { t: TaskDetail; busy: boolean; act: Act }) {
  const linkable = useQuery({ queryKey: ["linkable"], queryFn: getLinkable, enabled: t.can.link, retry: false });
  const [objective, setObjective] = useState<string | null>(null);
  const [keyResult, setKeyResult] = useState<string | null>(null);
  const chosenObjective = objective ?? t.objectiveId ?? "";
  const chosenKr = keyResult ?? t.keyResultId ?? "";
  const options = linkable.data ?? [];
  const krs = options.find((o) => o.id === chosenObjective)?.keyResults ?? [];
  const dirty = chosenObjective !== (t.objectiveId ?? "") || chosenKr !== (t.keyResultId ?? "");
  return (
    <section aria-label="What this task supports" className="space-y-3">
      <h3 className="text-label font-semibold">Supports</h3>
      {t.links.hidden ? (
        <p className="text-label text-muted-foreground">This task supports an objective that is not shared with you.</p>
      ) : t.links.objective ? (
        <p className="flex flex-wrap items-center gap-2 text-body">
          <Target aria-hidden="true" className="size-4 text-primary-ink" />
          <span className="font-medium">{t.links.objective.title}</span>
          {t.links.keyResult && <span className="text-muted-foreground">· {t.links.keyResult.title}</span>}
        </p>
      ) : (
        <p className="text-label text-muted-foreground">Not linked to an objective yet.</p>
      )}
      {t.can.link && (
        <form
          noValidate
          aria-label="Link to an objective"
          className="grid gap-2 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => updateTask(t.id, { objectiveId: chosenObjective || null, keyResultId: chosenKr || null }), chosenObjective ? "Linked." : "Unlinked.");
            setObjective(null);
            setKeyResult(null);
          }}
        >
          <SelectField label="Objective" value={chosenObjective} onChange={(e) => { setObjective(e.target.value); setKeyResult(""); }}>
            <option value="">None</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.title}</option>
            ))}
          </SelectField>
          <SelectField label="Key result (optional)" value={chosenKr} disabled={!chosenObjective} onChange={(e) => setKeyResult(e.target.value)}>
            <option value="">The objective as a whole</option>
            {krs.map((k) => (
              <option key={k.id} value={k.id}>{k.title}</option>
            ))}
          </SelectField>
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" variant="outline" disabled={busy || !dirty}>
              <Link2 aria-hidden="true" /> Save link
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function DependenciesSection({ t, busy, act }: { t: TaskDetail; busy: boolean; act: Act }) {
  const canEdit = t.can.link && isOpen(t.status);
  const all = useQuery({ queryKey: ["tasks", "picker"], queryFn: () => listTasks({ limit: 300 }), enabled: canEdit, retry: false });
  const [pick, setPick] = useState("");
  if (!canEdit && t.dependsOn.length === 0 && t.blocking.length === 0) return null;
  const taken = new Set([t.id, ...t.dependsOn.map((d) => d.id)]);
  return (
    <section aria-label="Dependencies" className="space-y-3">
      <h3 className="text-label font-semibold">Waits for</h3>
      {t.dependsOn.length === 0 ? (
        <p className="text-label text-muted-foreground">This task does not wait for anything.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {t.dependsOn.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="text-body">
                {d.title} <Badge variant={isOpen(d.status) ? "atRisk" : "onTrack"}>{isOpen(d.status) ? "Not finished" : STATUS_LABEL[d.status] ?? d.status}</Badge>
              </span>
              {canEdit && (
                <Button size="sm" variant="ghost" disabled={busy} aria-label={`Stop waiting for ${d.title}`} onClick={() => act(() => removeDependency(t.id, d.id), "No longer waiting for it.")}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {t.waitingOn > 0 && <p className="text-caption text-at-risk-ink">It cannot be completed until {t.waitingOn === 1 ? "that task is" : "those tasks are"} finished or cancelled.</p>}
      {canEdit && (
        <form noValidate aria-label="Add a dependency" className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (pick) { act(() => addDependency(t.id, pick), "Now waiting for it."); setPick(""); } }}>
          <div className="min-w-[12rem] flex-1">
            <SelectField label="Wait for another task" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose a task</option>
              {(all.data?.tasks ?? []).filter((x) => !taken.has(x.id) && x.status !== "cancelled").map((x) => (
                <option key={x.id} value={x.id}>{x.title}</option>
              ))}
            </SelectField>
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={busy || !pick}>Add</Button>
        </form>
      )}
      {t.blocking.length > 0 && (
        <p className="text-label text-muted-foreground">
          Others wait for this task: {t.blocking.map((b) => b.title).join(", ")}.
        </p>
      )}
    </section>
  );
}

function OutcomeSection({ t, busy, act }: { t: TaskDetail; busy: boolean; act: Act }) {
  const [summary, setSummary] = useState(t.outcome?.summary ?? "");
  const [value, setValue] = useState(t.outcome?.value !== null && t.outcome?.value !== undefined ? String(t.outcome.value) : "");
  const [onKr, setOnKr] = useState(false);
  const [quality, setQuality] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <section aria-label="Outcome" className="space-y-3 rounded-lg border p-4">
      <h3 className="text-label font-semibold">Outcome</h3>
      {t.outcome ? (
        <div className="space-y-1 text-body">
          <p className="whitespace-pre-wrap">{t.outcome.summary || "No summary recorded."}</p>
          {t.outcome.value !== null && <p className="text-label text-muted-foreground">Measured: {t.outcome.value}</p>}
          <p className="text-label">
            {t.outcome.quality !== null ? (
              <>
                Quality: <strong>{t.outcome.quality} of 5</strong>
                {t.outcome.reviewedBy ? ` · rated by ${t.outcome.reviewedBy.name}` : ""}
              </>
            ) : (
              <span className="text-muted-foreground">Not reviewed yet.</span>
            )}
          </p>
        </div>
      ) : (
        <p className="text-label text-muted-foreground">No outcome recorded yet.</p>
      )}
      {t.can.recordOutcome && (
        <form
          noValidate
          aria-label="Record the outcome"
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!summary.trim()) return setErr("Say in a sentence what the task achieved");
            const n = value === "" ? null : Number(value);
            if (n !== null && !Number.isFinite(n)) return setErr("The measured value must be a number");
            if (onKr && n === null) return setErr("Give the measured value to record it on the key result");
            setErr(null);
            act(() => recordOutcome(t.id, { summary: summary.trim(), value: n, recordOnKeyResult: onKr }), onKr ? "Outcome recorded, and the key result updated." : "Outcome recorded.");
          }}
        >
          {err && <FormAlert>{err}</FormAlert>}
          <label className="block space-y-1.5 text-label font-medium">
            What did it achieve?
            <textarea className={area} rows={3} maxLength={2000} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </label>
          <label className="block space-y-1.5 text-label font-medium">
            Measured value (optional)
            <input type="number" inputMode="decimal" className={field} value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          {t.links.keyResult && (
            <label className="flex items-start gap-2 text-label">
              <input type="checkbox" className="mt-1" checked={onKr} onChange={(e) => setOnKr(e.target.checked)} />
              <span>Also record this value as the actual value of “{t.links.keyResult.title}”</span>
            </label>
          )}
          <Button type="submit" size="sm" variant="outline" disabled={busy}>
            {t.outcome ? "Update the outcome" : "Record the outcome"}
          </Button>
        </form>
      )}
      {t.can.review && (
        <form
          noValidate
          aria-label="Rate the quality"
          className="space-y-2 border-t pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!quality) return setErr("Choose a rating from 1 to 5");
            setErr(null);
            act(() => reviewTask(t.id, { quality: Number(quality), ...(note.trim() ? { note: note.trim() } : {}) }), "Rating saved. The person has been told.");
          }}
        >
          <SelectField label="Quality of the outcome" value={quality} onChange={(e) => setQuality(e.target.value)}>
            <option value="">Choose a rating</option>
            <option value="1">1 of 5 · poor</option>
            <option value="2">2 of 5 · below expectations</option>
            <option value="3">3 of 5 · as expected</option>
            <option value="4">4 of 5 · good</option>
            <option value="5">5 of 5 · excellent</option>
          </SelectField>
          <label className="block space-y-1.5 text-label font-medium">
            Note (optional)
            <input className={field} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <Button type="submit" size="sm" disabled={busy}>Save rating</Button>
        </form>
      )}
    </section>
  );
}
