import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, Plus, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { FormAlert, FormField, FormNotice } from "@/components/common/FormField";
import { PageHeader } from "@/components/common/PageHeader";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { SelectField } from "@/components/common/SelectField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { CompareTab } from "./CompareTab";
import { problemText } from "@/lib/authForm";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { closePeriod, createPeriod, deltaText, getScorecardFor, getScore, getTrends, listPeriods, listScorecards, lockPeriod, recalculate, reopenPeriod, STATE_WORD, STATUS_WORD, TRIGGER_WORD, verifyScore, type PeriodView, type ScoreComponent, type ScoreDetail, type ScoreSummary } from "@/services/scoring";

const STATUS_VARIANT = { final: "onTrack", provisional: "info", insufficient: "dashed" } as const;
const STATE_VARIANT = { ok: "onTrack", insufficient: "atRisk", missing: "dashed" } as const;
const pct = (n: number): string => `${Math.round(n * 100)}%`;
const totalText = (t: number | null): string => (t === null ? "Not scored" : t.toFixed(1));

/**
 * Performance Intelligence → scorecards and periods (stage 5.2). Everyone sees their own scorecard and exactly what it is made
 * of; others only inside their permissions. A total is never shown without how it was calculated, and a part that has no data
 * says so ("No data recorded") instead of showing a zero.
 */
export default function PerformancePage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const periods = useQuery({ queryKey: ["performance-periods"], queryFn: listPeriods, retry: false });
  const tab = params.get("tab") === "periods" ? "periods" : params.get("tab") === "compare" ? "compare" : "scorecards";
  const set = (k: string, v: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (v === null) n.delete(k); else n.set(k, v); return n; }, { replace: true });
  const periodId = params.get("period") ?? periods.data?.find((p) => p.status === "open")?.id ?? periods.data?.[0]?.id ?? null;
  const tabLink = (t: "scorecards" | "periods" | "compare", label: string) => (
    <Link to={{ search: (() => { const n = new URLSearchParams(params); if (t === "scorecards") n.delete("tab"); else n.set("tab", t); return n.toString() ? `?${n.toString()}` : ""; })() }} role="tab" aria-selected={tab === t} className={cn("-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-label font-medium", tab === t ? "border-primary text-primary-ink" : "border-transparent text-muted-foreground hover:text-foreground")}>{label}</Link>
  );
  return (
    <>
      <PageHeader eyebrow="Insight" title="Performance Intelligence" description="Explainable scorecards: every score shows what it is made of, what was missing, and how to check it." />
      <p className="mb-5 max-w-prose text-caption text-muted-foreground">Scores are information to start a conversation. They are not employment decisions, and a missing measure is never counted as zero.</p>
      {periods.isPending ? <PageSkeleton /> : periods.isError ? <ErrorState title="Performance periods could not be loaded" error={periods.error} onRetry={() => void periods.refetch()} /> : (
        <>
          <div role="tablist" aria-label="Performance views" className="mb-5 flex overflow-x-auto border-b">
            {tabLink("scorecards", "Scorecards")}
            {tabLink("compare", "Compare")}
            {tabLink("periods", "Periods")}
          </div>
          {tab === "periods" ? <PeriodsTab periods={periods.data} onOpen={(id) => { set("tab", null); set("period", id); }} /> : tab === "compare" && periods.data.length > 0 ? <CompareTab periods={periods.data} periodId={periodId!} onPeriod={(id) => set("period", id)} /> : periods.data.length === 0 ? (
            <EmptyState illustration="gauge" title="No performance period yet">
              {can("performance.manage_periods") ? "Create a period (a month, quarter or year) on the Periods tab, then calculate scores for it." : "An administrator creates a performance period before scores can be calculated."}
            </EmptyState>
          ) : (
            <Scorecards periods={periods.data} periodId={periodId!} onPeriod={(id) => { set("period", id); set("person", null); }} person={params.get("person")} onPerson={(id) => set("person", id)} />
          )}
        </>
      )}
    </>
  );
}

function Scorecards({ periods, periodId, onPeriod, person, onPerson }: { periods: PeriodView[]; periodId: string; onPeriod: (id: string) => void; person: string | null; onPerson: (id: string | null) => void }) {
  const period = periods.find((p) => p.id === periodId) ?? periods[0]!;
  const list = useQuery({ queryKey: ["performance-scorecards", period.id], queryFn: () => listScorecards(period.id), retry: false });
  const only = list.data?.length === 1 ? list.data[0]!.subject.id : null;
  const subject = person ?? only;
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <section aria-label="People" className="space-y-3 lg:col-span-2">
        <SelectField label="Period" value={period.id} onChange={(e) => onPeriod(e.target.value)}>
          {periods.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.status === "open" ? "open" : p.status})</option>)}
        </SelectField>
        {list.isPending ? <PageSkeleton /> : list.isError ? <ErrorState title="Scorecards could not be loaded" error={list.error} onRetry={() => void list.refetch()} /> : list.data.length === 0 ? (
          <EmptyState illustration="gauge" title="No scorecards in this period yet">Scores are calculated from the records. Ask someone who can calculate scores to run it, or check the Periods tab.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {list.data.map((c) => (
              <li key={c.scorecardId}>
                <button type="button" aria-label={`Open scorecard: ${c.subject.name}`} aria-pressed={subject === c.subject.id} onClick={() => onPerson(c.subject.id)} className={cn("flex w-full flex-wrap items-center gap-2 rounded-xl border bg-card p-3 text-left hover:bg-muted/50", subject === c.subject.id && "border-primary")}>
                  <span className="min-w-0 flex-1 truncate text-body font-medium">{c.subject.name}</span>
                  <span className="text-body font-semibold tabular-nums">{totalText(c.total)}</span>
                  <Badge variant={STATUS_VARIANT[c.status]}>{STATUS_WORD[c.status]}</Badge>
                  {c.isDemo && <Badge variant="outline">Demo</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Scorecard" className="lg:col-span-3">
        {subject ? <Scorecard periodId={period.id} subjectId={subject} /> : <EmptyState illustration="gauge" title="Pick a person">Choose someone on the left to see their scorecard and how it was calculated.</EmptyState>}
      </section>
    </div>
  );
}

function Scorecard({ periodId, subjectId }: { periodId: string; subjectId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["performance-scorecard", periodId, subjectId], queryFn: () => getScorecardFor(periodId, subjectId), retry: false });
  const [runId, setRunId] = useState<string | null>(null);
  const refresh = useMutation({
    mutationFn: () => recalculate({ periodId, subjectId }),
    onSuccess: () => { setRunId(null); void qc.invalidateQueries({ queryKey: ["performance-scorecard"] }); void qc.invalidateQueries({ queryKey: ["performance-scorecards"] }); void qc.invalidateQueries({ queryKey: ["performance-periods"] }); },
  });
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState title="This scorecard could not be opened" error={q.error} onRetry={() => void q.refetch()} />;
  const card = q.data;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>{card.subject.name}</CardTitle>
          <p className="text-label text-muted-foreground">{card.period.name} · {card.period.startDate} to {card.period.endDate}</p>
        </div>
        {card.can.recalculate && <Button size="sm" variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate()}><RefreshCw aria-hidden="true" /> {refresh.isPending ? "Calculating…" : "Recalculate"}</Button>}
      </CardHeader>
      <CardContent className="space-y-5">
        {refresh.isError && <FormAlert>{problemText(refresh.error)}</FormAlert>}
        {refresh.isSuccess && <FormNotice>{refresh.data.scored > 0 ? "A new run was added: the records changed since the last one." : "Nothing changed since the last run, so no new run was added."}</FormNotice>}
        {!card.latest ? <p className="text-body text-muted-foreground">No score has been calculated for this period yet.</p> : <RunView key={runId ?? card.latest.scoreId} scoreId={runId ?? card.latest.scoreId} latestId={card.latest.scoreId} initial={runId ? undefined : card.latest} />}
        {card.runs.length > 0 && (
          <section aria-label="Run history" className="space-y-2">
            <h3 className="text-label font-semibold">Run history</h3>
            <p className="text-caption text-muted-foreground">A run is never edited. When the records change, a new run is added and the old ones stay.</p>
            <ul className="divide-y rounded-xl border">
              {card.runs.map((r) => <RunRow key={r.scoreId} run={r} open={(runId ?? card.latest!.scoreId) === r.scoreId} onOpen={() => setRunId(r.scoreId === card.latest!.scoreId ? null : r.scoreId)} tz="UTC" />)}
            </ul>
          </section>
        )}
        <Trends subjectId={subjectId} />
      </CardContent>
    </Card>
  );
}

/** The person's score in each period, oldest first, and a side-by-side comparison of any two of them. */
function Trends({ subjectId }: { subjectId: string }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const base = useQuery({ queryKey: ["performance-trends", subjectId], queryFn: () => getTrends({ subjectId }), retry: false });
  const cmp = useQuery({ queryKey: ["performance-trends", subjectId, from, to], queryFn: () => getTrends({ subjectId, from, to }), retry: false, enabled: Boolean(from && to && from !== to) });
  if (base.isPending) return <PageSkeleton />;
  if (base.isError) return <ErrorState title="The trend could not be loaded" error={base.error} onRetry={() => void base.refetch()} />;
  const points = base.data.points;
  if (points.length < 2) return <section aria-label="Over time" className="space-y-1"><h3 className="text-label font-semibold">Over time</h3><p className="text-caption text-muted-foreground">A trend needs scores from at least two periods.</p></section>;
  const c = cmp.data?.comparison;
  return (
    <section aria-label="Over time" className="space-y-3">
      <h3 className="text-label font-semibold">Over time</h3>
      <table className="w-full text-label">
        <caption className="sr-only">Score by period</caption>
        <thead><tr className="text-left text-caption text-muted-foreground"><th scope="col" className="py-1 font-medium">Period</th><th scope="col" className="py-1 font-medium">Score</th><th scope="col" className="py-1 font-medium">Status</th><th scope="col" className="py-1 text-right font-medium">Change</th></tr></thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.periodId} className="border-t">
              <th scope="row" className="py-1.5 text-left font-medium">{p.periodName}</th>
              <td className="py-1.5 tabular-nums">{p.total === null ? "Not scored" : p.total.toFixed(1)}</td>
              <td className="py-1.5"><Badge variant={STATUS_VARIANT[p.status]}>{STATUS_WORD[p.status]}</Badge></td>
              <td className="py-1.5 text-right tabular-nums">{deltaText(p.totalDelta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div role="group" aria-label="Compare two periods" className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Compare" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Choose a period</option>{points.map((p) => <option key={p.periodId} value={p.periodId}>{p.periodName}</option>)}</SelectField>
        <SelectField label="With" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose a period</option>{points.map((p) => <option key={p.periodId} value={p.periodId}>{p.periodName}</option>)}</SelectField>
      </div>
      {cmp.isError && <ErrorState title="These periods could not be compared" error={cmp.error} onRetry={() => void cmp.refetch()} />}
      {c && (
        <div role="region" aria-label="Comparison" className="space-y-2">
          <p className="text-label">{c.from.name} {c.from.total === null ? "Not scored" : c.from.total.toFixed(1)} → {c.to.name} {c.to.total === null ? "Not scored" : c.to.total.toFixed(1)}: <strong>{deltaText(c.totalDelta)}</strong></p>
          {c.modelChanged && <p className="text-caption text-muted-foreground">The scoring model changed between these periods ({c.from.model} and {c.to.model}), so the difference may not be like for like.</p>}
          {c.components.length > 0 && (
            <table className="w-full text-label">
              <caption className="sr-only">Difference by part</caption>
              <thead><tr className="text-left text-caption text-muted-foreground"><th scope="col" className="py-1 font-medium">Part</th><th scope="col" className="py-1 font-medium">{c.from.name}</th><th scope="col" className="py-1 font-medium">{c.to.name}</th><th scope="col" className="py-1 text-right font-medium">Change</th></tr></thead>
              <tbody>
                {c.components.map((k) => (
                  <tr key={k.key} className="border-t">
                    <th scope="row" className="py-1.5 text-left font-medium">{k.label}</th>
                    <td className="py-1.5 tabular-nums">{k.from === null ? "No data" : k.from.toFixed(1)}</td>
                    <td className="py-1.5 tabular-nums">{k.to === null ? "No data" : k.to.toFixed(1)}</td>
                    <td className="py-1.5 text-right tabular-nums">{k.note ?? deltaText(k.delta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {base.data.componentsHidden && <p className="text-caption text-muted-foreground">The parts are only shown to the person themself and to people allowed to see the breakdown.</p>}
        </div>
      )}
    </section>
  );
}

function RunRow({ run, open, onOpen, tz }: { run: ScoreSummary; open: boolean; onOpen: () => void; tz: string }) {
  return (
    <li>
      <button type="button" onClick={onOpen} aria-label={`Open run ${run.runNumber}`} aria-pressed={open} className={cn("flex w-full flex-wrap items-center gap-2 p-3 text-left text-label hover:bg-muted/50", open && "bg-muted/40")}>
        <span className="font-medium">Run {run.runNumber}</span>
        <span className="tabular-nums">{totalText(run.total)}</span>
        <Badge variant={STATUS_VARIANT[run.status]}>{STATUS_WORD[run.status]}</Badge>
        <span className="text-muted-foreground">{TRIGGER_WORD[run.trigger] ?? run.trigger} · {formatDateTime(run.computedAt, tz)}</span>
      </button>
    </li>
  );
}

function RunView({ scoreId, latestId, initial }: { scoreId: string; latestId: string; initial?: ScoreDetail }) {
  const q = useQuery({ queryKey: ["performance-score", scoreId], queryFn: () => getScore(scoreId), retry: false, ...(initial ? { initialData: initial } : {}) });
  const verify = useMutation({ mutationFn: () => verifyScore(scoreId) });
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState title="This run could not be opened" error={q.error} onRetry={() => void q.refetch()} />;
  const s = q.data;
  return (
    <div className="space-y-4">
      {scoreId !== latestId && <p role="status" className="rounded-lg border bg-muted/40 px-3 py-2 text-label">This is run {s.runNumber}, an earlier run. It is shown exactly as it was calculated.</p>}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <p className="text-display font-bold tabular-nums" aria-label={s.total === null ? "No total score" : `Total score ${s.total.toFixed(1)}`}>{totalText(s.total)}</p>
        <div className="flex flex-wrap items-center gap-2 pb-1.5">
          <Badge variant={STATUS_VARIANT[s.status]}>{STATUS_WORD[s.status]}</Badge>
          {s.band && <Badge variant="primary">{s.band}</Badge>}
          <Badge variant="neutral" title="How much data the score rests on">Confidence {s.confidenceLabel} ({pct(s.confidence)})</Badge>
        </div>
      </div>
      <p className="text-caption text-muted-foreground">Model: {s.modelName} v{s.modelVersion} · {pct(s.weightCoverage)} of the weight had data · calculated {formatDateTime(s.computedAt, "UTC")}</p>
      {s.status === "insufficient" && <p className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-label"><TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> Not enough has been recorded to score this period honestly. No number is shown rather than a guess.</p>}
      {s.componentsHidden ? (
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-label">You can see the total. What it is made of is only shown to the person themself and to people allowed to see the breakdown.</p>
      ) : (
        <>
          <ul aria-label="What the score is made of" className="space-y-2">
            {s.components.map((c) => <ComponentRow key={c.key} c={c} />)}
          </ul>
          {s.explanation && (
            <details className="rounded-xl border bg-card p-3 [&_summary]:cursor-pointer">
              <summary className="flex items-center gap-2 text-label font-semibold"><ChevronDown aria-hidden="true" className="size-4" /> How was this calculated?</summary>
              <div className="mt-3 space-y-3 text-label">
                <p className="rounded-lg bg-muted/50 px-3 py-2 font-mono text-caption">{s.explanation.formula}</p>
                {s.explanation.rounding && <p className="text-caption text-muted-foreground">{s.explanation.rounding}</p>}
                {s.explanation.reasons.length > 0 && <List title="Why this score" items={s.explanation.reasons} />}
                {s.explanation.dataQuality.length > 0 && <List title="Data quality" items={s.explanation.dataQuality} />}
                {s.explanation.whatWouldChangeThis.length > 0 && <List title="What would change it" items={s.explanation.whatWouldChangeThis} />}
                <p className="text-caption text-muted-foreground">Confidence {pct(s.explanation.confidence.value)} = data coverage {pct(s.explanation.confidence.parts.coverage)} × sample size {pct(s.explanation.confidence.parts.sample)} × evidence {pct(s.explanation.confidence.parts.evidence)}.</p>
              </div>
            </details>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" disabled={verify.isPending} onClick={() => verify.mutate()}><ShieldCheck aria-hidden="true" /> {verify.isPending ? "Checking…" : "Verify"}</Button>
            <span className="text-caption text-muted-foreground">Recomputes this run from the records and model it stored.</span>
          </div>
          {verify.isError && <FormAlert>{problemText(verify.error)}</FormAlert>}
          {verify.data && (verify.data.matches ? (
            <p role="status" className="flex items-start gap-2 rounded-lg border border-on-track/30 bg-on-track-soft px-3 py-2.5 text-label text-on-track-ink"><CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> Matches: recomputed {totalText(verify.data.actual.total)} ({STATUS_WORD[verify.data.actual.status] ?? verify.data.actual.status}), the same as stored.</p>
          ) : (
            <div role="alert" className="rounded-lg border border-off-track/30 bg-off-track-soft px-3 py-2.5 text-label text-off-track-ink">
              <p className="font-medium">Does not match.</p>
              <ul className="list-disc pl-5">{verify.data.mismatches.map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

const List = ({ title, items }: { title: string; items: string[] }) => (
  <div>
    <p className="font-medium">{title}</p>
    <ul className="list-disc pl-5 text-muted-foreground">{items.map((i) => <li key={i}>{i}</li>)}</ul>
  </div>
);

function ComponentRow({ c }: { c: ScoreComponent }) {
  return (
    <li className="rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-body font-medium">{c.label}</span>
        <Badge variant={STATE_VARIANT[c.state]}>{c.state === "missing" ? "Missing" : STATE_WORD[c.state]}</Badge>
        <span className="text-body font-semibold tabular-nums">{c.score === null ? "No score" : c.score.toFixed(1)}</span>
      </div>
      <p className="mt-1 text-caption text-muted-foreground">
        Weight {pct(c.weight)}{c.state === "ok" && c.points !== null ? ` · adds ${c.points.toFixed(1)} points (counts ${pct(c.effectiveWeight)} of the total)` : ` · ${c.stateText}; its weight is shared by the parts that have data`}
      </p>
      {(c.contributors.length > 0 || c.notes.length > 0) && (
        <details className="mt-2 [&_summary]:cursor-pointer">
          <summary className="text-label font-medium text-primary-ink">Records behind this ({c.contributors.length})</summary>
          {c.contributors.length > 0 && (
            <ul className="mt-2 space-y-1 text-label">
              {c.contributors.map((x) => <li key={`${x.ref.type}:${x.ref.id}`} className="flex flex-wrap justify-between gap-2"><span>{x.label}{x.note ? <span className="text-muted-foreground"> ({x.note})</span> : null}</span><span className="tabular-nums text-muted-foreground">{x.value === null ? "no value" : x.value <= 1 && c.providerKey !== "quality.impact" ? pct(x.value) : x.value.toFixed(1)}</span></li>)}
            </ul>
          )}
          {c.notes.length > 0 && <ul className="mt-2 list-disc pl-5 text-caption text-muted-foreground">{c.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        </details>
      )}
    </li>
  );
}

function PeriodsTab({ periods, onOpen }: { periods: PeriodView[]; onOpen: (id: string) => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["performance-periods"] }); void qc.invalidateQueries({ queryKey: ["performance-scorecards"] }); void qc.invalidateQueries({ queryKey: ["performance-scorecard"] }); void qc.invalidateQueries({ queryKey: ["performance-score"] }); void qc.invalidateQueries({ queryKey: ["performance-trends"] }); };
  const [confirm, setConfirm] = useState<{ period: PeriodView; action: "close" | "reopen" | "lock" } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const calc = useMutation({ mutationFn: (periodId: string) => recalculate({ periodId }), onSuccess: () => { setNotice(null); refresh(); } });
  const change = useMutation({
    mutationFn: ({ period, action }: { period: PeriodView; action: "close" | "reopen" | "lock" }) => (action === "close" ? closePeriod(period.id) : action === "reopen" ? reopenPeriod(period.id) : lockPeriod(period.id)),
    onSuccess: (r, v) => {
      const scored = (r as { calculated?: { scored: number } }).calculated?.scored ?? 0;
      setConfirm(null);
      setNotice(v.action === "close" ? `${v.period.name} is closed. Final scores were calculated: ${scored} new ${scored === 1 ? "run" : "runs"}.` : v.action === "reopen" ? `${v.period.name} is open again.` : `${v.period.name} is locked.`);
      refresh();
    },
    onError: () => setConfirm(null),
  });
  const SAY = { close: "Closing calculates a final score for everyone as of the last day of the period and stops the nightly update for it. You can reopen it until it is locked.", reopen: "Reopening starts the nightly update again. Every earlier run is kept.", lock: "Locking is permanent: its scores cannot be recalculated, it cannot be reopened, and no new KPI value can be added inside it (existing values can still be corrected, with a reason)." } as const;
  return (
    <section aria-label="Periods" className="space-y-4">
      {can("performance.manage_periods") && <div><Button size="sm" onClick={() => setAdding(true)}><Plus aria-hidden="true" /> New period</Button></div>}
      {adding && <NewPeriod onDone={() => setAdding(false)} />}
      {calc.isError && <FormAlert>{problemText(calc.error)}</FormAlert>}
      {change.isError && <FormAlert>{problemText(change.error)}</FormAlert>}
      {notice && <FormNotice>{notice}</FormNotice>}
      {confirm && (
        <div role="alertdialog" aria-label={`Confirm: ${confirm.action} ${confirm.period.name}`} className="space-y-3 rounded-lg border bg-muted/40 p-4">
          <p className="text-body">{SAY[confirm.action]}</p>
          <div className="flex gap-2">
            <Button disabled={change.isPending} onClick={() => change.mutate(confirm)}>{change.isPending ? "Working…" : `Yes, ${confirm.action} ${confirm.period.name}`}</Button>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {calc.isSuccess && <FormNotice>{`Calculated: ${calc.data.scored} new ${calc.data.scored === 1 ? "run" : "runs"}, ${calc.data.unchanged} unchanged${calc.data.skipped ? `, ${calc.data.skipped} without a model` : ""}.`}</FormNotice>}
      {periods.length === 0 ? <EmptyState illustration="gauge" title="No periods yet">A period is the span of time a score covers, such as a quarter.</EmptyState> : (
        <ul className="divide-y rounded-xl border bg-card">
          {periods.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-body font-medium">{p.name} {p.isDemo && <Badge variant="outline">Demo</Badge>}</p>
                <p className="text-caption text-muted-foreground">{p.startDate} to {p.endDate} · {p.scorecards} {p.scorecards === 1 ? "scorecard" : "scorecards"}</p>
              </div>
              <Badge variant={p.status === "open" ? "info" : "neutral"}>{p.status === "open" ? "Open" : p.status === "closed" ? "Closed" : "Locked"}</Badge>
              <Button size="sm" variant="outline" aria-label={`Open scorecards for ${p.name}`} onClick={() => onOpen(p.id)}>Scorecards</Button>
              {can("performance.recalculate") && p.status !== "locked" && <Button size="sm" variant="outline" aria-label={`Calculate scores for ${p.name}`} disabled={calc.isPending} onClick={() => calc.mutate(p.id)}><RefreshCw aria-hidden="true" /> Calculate</Button>}
              {can("performance.manage_periods") && p.status === "open" && <Button size="sm" variant="outline" aria-label={`Close ${p.name}`} onClick={() => { setNotice(null); setConfirm({ period: p, action: "close" }); }}>Close</Button>}
              {can("performance.manage_periods") && p.status === "closed" && <Button size="sm" variant="outline" aria-label={`Reopen ${p.name}`} onClick={() => { setNotice(null); setConfirm({ period: p, action: "reopen" }); }}>Reopen</Button>}
              {can("performance.manage_periods") && p.status === "closed" && <Button size="sm" variant="outline" aria-label={`Lock ${p.name}`} onClick={() => { setNotice(null); setConfirm({ period: p, action: "lock" }); }}>Lock</Button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NewPeriod({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [type, setType] = useState("quarter");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const create = useMutation({ mutationFn: () => createPeriod({ name, periodType: type, startDate: start, endDate: end }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["performance-periods"] }); onDone(); } });
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(); };
  return (
    <form aria-label="New period" onSubmit={submit} className="space-y-3 rounded-xl border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
        <SelectField label="Kind" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="month">Month</option><option value="quarter">Quarter</option><option value="year">Year</option><option value="custom">Custom</option>
        </SelectField>
        <FormField label="First day" type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
        <FormField label="Last day" type="date" value={end} onChange={(e) => setEnd(e.target.value)} required hint="The last day is included." />
      </div>
      {create.isError && <FormAlert>{problemText(create.error)}</FormAlert>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={create.isPending}>{create.isPending ? "Creating…" : "Create period"}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
