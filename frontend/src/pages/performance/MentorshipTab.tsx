import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { FormAlert, FormField, FormNotice } from "@/components/common/FormField";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { SelectField } from "@/components/common/SelectField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { problemText } from "@/lib/authForm";
import { cn } from "@/lib/cn";
import { ACTIVITY_LABEL, createAssignment, getEffectiveness, listActivities, listAssignments, logActivity, updateAssignment, type AssignmentView, type Effectiveness } from "@/services/mentorship";
import { listPeople } from "@/services/people";
import type { PeriodView } from "@/services/scoring";

const STATUS_VARIANT = { active: "onTrack", paused: "atRisk", ended: "neutral" } as const;
const STATUS_WORD = { active: "Active", paused: "Paused", ended: "Ended" } as const;

/**
 * Performance Intelligence → Mentorship (stage 5.5): who mentors whom, what they did together, and how the mentees changed. The
 * result is shown with its factors (days, number of mentors, sessions against the cadence) and a reminder that mentee results have
 * many causes. Mentors are compared only with mentors.
 */
export function MentorshipTab({ periods, periodId, onPeriod }: { periods: PeriodView[]; periodId: string; onPeriod: (id: string) => void }) {
  const { can } = useAuth();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const list = useQuery({ queryKey: ["mentorship-assignments"], queryFn: listAssignments, retry: false });
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-5">
        <section aria-label="Assignments" className="space-y-3 lg:col-span-2">
          {can("mentorship.manage") && <Button size="sm" onClick={() => setAdding(true)}><Plus aria-hidden="true" /> New assignment</Button>}
          {adding && <NewAssignment onDone={() => setAdding(false)} onCreated={(id) => { setAdding(false); setOpen(id); }} />}
          {list.isPending ? <PageSkeleton /> : list.isError ? <ErrorState title="Assignments could not be loaded" error={list.error} onRetry={() => void list.refetch()} /> : list.data.length === 0 ? (
            <EmptyState illustration="team" title="No mentoring yet">{can("mentorship.manage") ? "Choose a mentor and a mentee to start." : "Nobody you can see has a mentoring assignment."}</EmptyState>
          ) : (
            <ul className="space-y-2">
              {list.data.map((a) => (
                <li key={a.id}>
                  <button type="button" aria-label={`Open mentoring: ${a.mentor.name} and ${a.mentee.name}`} aria-pressed={open === a.id} onClick={() => setOpen(a.id)} className={cn("flex w-full flex-wrap items-center gap-2 rounded-xl border bg-card p-3 text-left hover:bg-muted/50", open === a.id && "border-primary")}>
                    <span className="min-w-0 flex-1 text-body font-medium">{a.mentor.name} <span className="font-normal text-muted-foreground">mentors</span> {a.mentee.name}</span>
                    <Badge variant={STATUS_VARIANT[a.status]}>{STATUS_WORD[a.status]}</Badge>
                    {a.isDemo && <Badge variant="outline">Demo</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Assignment" className="lg:col-span-3">
          {open ? <Detail id={open} assignment={list.data?.find((a) => a.id === open)} /> : <EmptyState illustration="team" title="Pick a mentoring pair">See what they did together and log a session.</EmptyState>}
        </section>
      </div>
      <Effect periods={periods} periodId={periodId} onPeriod={onPeriod} />
    </div>
  );
}

function NewAssignment({ onDone, onCreated }: { onDone: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const people = useQuery({ queryKey: ["people-for-mentoring"], queryFn: () => listPeople({ limit: 500 }), retry: false });
  const [mentor, setMentor] = useState("");
  const [mentee, setMentee] = useState("");
  const [cadence, setCadence] = useState("14");
  const [goals, setGoals] = useState("");
  const create = useMutation({ mutationFn: () => createAssignment({ mentorId: mentor, menteeId: mentee, cadenceDays: Number(cadence), goals }), onSuccess: (a) => { void qc.invalidateQueries({ queryKey: ["mentorship-assignments"] }); void qc.invalidateQueries({ queryKey: ["mentorship-effectiveness"] }); onCreated(a.id); } });
  const options = (people.data?.people ?? []).filter((p) => !p.archived && p.status !== "left");
  return (
    <form aria-label="New assignment" onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-3 rounded-xl border bg-card p-4">
      <SelectField label="Mentor" value={mentor} onChange={(e) => setMentor(e.target.value)} required><option value="">Choose a person</option>{options.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}</SelectField>
      <SelectField label="Mentee" value={mentee} onChange={(e) => setMentee(e.target.value)} required><option value="">Choose a person</option>{options.filter((p) => p.id !== mentor).map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}</SelectField>
      <FormField label="Meet every (days)" type="number" min={1} max={90} value={cadence} onChange={(e) => setCadence(e.target.value)} />
      <FormField label="Goals" value={goals} onChange={(e) => setGoals(e.target.value)} maxLength={1000} />
      {create.isError && <FormAlert>{problemText(create.error)}</FormAlert>}
      <div className="flex gap-2"><Button type="submit" size="sm" disabled={create.isPending || !mentor || !mentee}>{create.isPending ? "Creating…" : "Create assignment"}</Button><Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button></div>
    </form>
  );
}

function Detail({ id, assignment }: { id: string; assignment: AssignmentView | undefined }) {
  const qc = useQueryClient();
  const acts = useQuery({ queryKey: ["mentorship-activities", id], queryFn: () => listActivities(id), retry: false });
  const [type, setType] = useState("one_on_one");
  const [summary, setSummary] = useState("");
  const [minutes, setMinutes] = useState("");
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["mentorship-assignments"] }); void qc.invalidateQueries({ queryKey: ["mentorship-activities", id] }); void qc.invalidateQueries({ queryKey: ["mentorship-effectiveness"] }); };
  const log = useMutation({ mutationFn: () => logActivity(id, { type, summary, ...(minutes ? { durationMinutes: Number(minutes) } : {}) }), onSuccess: () => { setSummary(""); setMinutes(""); refresh(); } });
  const change = useMutation({ mutationFn: (status: "active" | "paused" | "ended") => updateAssignment(id, { status }), onSuccess: refresh });
  const [confirmEnd, setConfirmEnd] = useState(false);
  if (!assignment) return <PageSkeleton />;
  const a = assignment;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>{a.mentor.name} and {a.mentee.name}</CardTitle>
          <p className="text-label text-muted-foreground">Since {a.startDate}{a.endDate ? `, ended ${a.endDate}` : ""} · a session about every {a.cadenceDays} days · {a.activityCount} logged{a.lastActivityOn ? `, the last on ${a.lastActivityOn}` : ""}</p>
        </div>
        <Badge variant={STATUS_VARIANT[a.status]}>{STATUS_WORD[a.status]}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {a.goals && <p className="text-body"><span className="font-medium">Goals:</span> {a.goals}</p>}
        {a.can.manage && (
          <div className="flex flex-wrap gap-2">
            {a.status === "active" && <Button size="sm" variant="outline" onClick={() => change.mutate("paused")}>Pause</Button>}
            {a.status === "paused" && <Button size="sm" variant="outline" onClick={() => change.mutate("active")}>Resume</Button>}
            <Button size="sm" variant="outline" onClick={() => setConfirmEnd(true)}>End mentoring</Button>
          </div>
        )}
        {confirmEnd && (
          <div role="alertdialog" aria-label="Confirm: end mentoring" className="space-y-3 rounded-lg border bg-muted/40 p-4">
            <p className="text-body">Ending stops the mentoring from today. What happened until now still counts, and it cannot be started again (create a new assignment instead).</p>
            <div className="flex gap-2"><Button disabled={change.isPending} onClick={() => { change.mutate("ended"); setConfirmEnd(false); }}>Yes, end it</Button><Button variant="ghost" onClick={() => setConfirmEnd(false)}>Cancel</Button></div>
          </div>
        )}
        {change.isError && <FormAlert>{problemText(change.error)}</FormAlert>}
        {a.status === "paused" && <p className="text-caption text-muted-foreground">Paused: this assignment is not counted in scores until it is resumed.</p>}
        {a.can.log && (
          <form aria-label="Log a session" onSubmit={(e) => { e.preventDefault(); log.mutate(); }} className="space-y-3 rounded-xl border bg-card p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField label="What was it?" value={type} onChange={(e) => setType(e.target.value)}>{Object.entries(ACTIVITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</SelectField>
              <FormField label="Minutes (optional)" type="number" min={1} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </div>
            <FormField label="What happened" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={1000} required />
            {log.isError && <FormAlert>{problemText(log.error)}</FormAlert>}
            {log.isSuccess && <FormNotice>Logged.</FormNotice>}
            <Button type="submit" size="sm" disabled={log.isPending || summary.trim() === ""}>{log.isPending ? "Logging…" : "Log session"}</Button>
          </form>
        )}
        <section aria-label="Activities" className="space-y-2">
          <h3 className="text-label font-semibold">What they did together</h3>
          {acts.isPending ? <PageSkeleton /> : acts.isError ? <ErrorState title="Activities could not be loaded" error={acts.error} onRetry={() => void acts.refetch()} /> : acts.data.length === 0 ? <p className="text-caption text-muted-foreground">Nothing has been logged yet.</p> : (
            <ul className="divide-y rounded-xl border">
              {acts.data.map((x) => <li key={x.id} className="p-3 text-label"><span className="font-medium">{ACTIVITY_LABEL[x.type] ?? x.type}</span> · {x.occurredOn}{x.durationMinutes ? ` · ${x.durationMinutes} min` : ""}<p className="text-muted-foreground">{x.summary}</p></li>)}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

const num = (n: number | null): string => (n === null ? "No data" : n.toFixed(1));
const signed = (n: number | null): string => (n === null ? "No data" : n === 0 ? "No change" : `${n > 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`);

function Effect({ periods, periodId, onPeriod }: { periods: PeriodView[]; periodId: string; onPeriod: (id: string) => void }) {
  const q = useQuery({ queryKey: ["mentorship-effectiveness", periodId], queryFn: () => getEffectiveness(periodId), retry: false });
  return (
    <Card>
      <CardHeader><CardTitle>How the mentees changed</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-xs"><SelectField label="Period" value={periodId} onChange={(e) => onPeriod(e.target.value)}>{periods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectField></div>
        {q.isPending ? <PageSkeleton /> : q.isError ? <ErrorState title="The effect could not be calculated" error={q.error} onRetry={() => void q.refetch()} /> : q.data.mentors.length === 0 ? <p className="text-label text-muted-foreground">No mentoring you can see overlaps this period.</p> : (
          <>
            <ul className="space-y-3" aria-label="Mentors">{q.data.mentors.map((m) => <MentorRow key={m.mentor.id} m={m} minDays={q.data.settings.minDays} />)}</ul>
            <ul className="list-disc space-y-1 pl-5 text-caption text-muted-foreground">{q.data.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MentorRow({ m, minDays }: { m: Effectiveness; minDays: number }) {
  return (
    <li className="rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-body font-medium">{m.mentor.name}</span>
        <span className="text-label">Development <strong className="tabular-nums">{m.development.value === null ? "Not enough data" : m.development.value.toFixed(1)}</strong></span>
        <span className="text-label">Activity <strong className="tabular-nums">{m.activity.value === null ? "Not enough data" : `${m.activity.value.toFixed(0)}%`}</strong></span>
        <span className="text-caption text-muted-foreground">{m.menteeCount} {m.menteeCount === 1 ? "mentee" : "mentees"} · {m.averageDays ?? 0} days on average</span>
      </div>
      {m.development.notes.length > 0 && <ul className="mt-1 list-disc pl-5 text-caption text-muted-foreground">{m.development.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      <details className="mt-2 [&_summary]:cursor-pointer">
        <summary className="text-label font-medium text-primary-ink">Every factor, mentee by mentee</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-label">
            <caption className="sr-only">Factors for {m.mentor.name}</caption>
            <thead><tr className="text-left text-caption text-muted-foreground"><th scope="col" className="py-1 font-medium">Mentee</th><th scope="col" className="py-1 font-medium">Days (counts in full at {minDays})</th><th scope="col" className="py-1 font-medium">Mentors</th><th scope="col" className="py-1 font-medium">Score change</th><th scope="col" className="py-1 font-medium">Improvement (50 = none)</th><th scope="col" className="py-1 font-medium">Sessions</th></tr></thead>
            <tbody>
              {m.mentees.map((x) => (
                <tr key={x.assignmentId} className="border-t align-top">
                  <th scope="row" className="py-1.5 text-left font-medium">{x.mentee.name}</th>
                  <td className="py-1.5 tabular-nums">{x.overlapDays} (factor {x.durationFactor.toFixed(2)})</td>
                  <td className="py-1.5 tabular-nums">{x.mentorCount} (share {x.creditShare.toFixed(2)})</td>
                  <td className="py-1.5 tabular-nums">{x.detail ? <>{signed(x.detail.scoreDelta)}{x.detail.baselineScore !== null && x.detail.currentScore !== null ? <span className="block text-caption text-muted-foreground">{num(x.detail.baselineScore)} → {num(x.detail.currentScore)}</span> : null}</> : "Not shown"}</td>
                  <td className="py-1.5 tabular-nums">{x.improvementIndex === null ? "Not measurable yet" : x.improvementIndex.toFixed(1)}</td>
                  <td className="py-1.5 tabular-nums">{x.activities} of about {x.expectedActivities.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </li>
  );
}
