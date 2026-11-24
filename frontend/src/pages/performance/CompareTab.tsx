import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
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
import { formatDateTime } from "@/lib/format";
import { deltaText, getCompare, getComparison, getDifference, listComparisons, ordinal, saveComparison, STATUS_WORD, type CompareResult, type PeriodView } from "@/services/scoring";
import { getStructure } from "@/services/structure";

const STATUS_VARIANT = { final: "onTrack", provisional: "info", insufficient: "dashed" } as const;

/**
 * Performance Intelligence → Compare (stage 5.4). Peers are people in the same role family in the same period: there is no way
 * to compare different kinds of work. Everyone sees where they stand; names and other people's scores only appear for people the
 * viewer is allowed to compare. Tenure, team size and workload sit beside the numbers and are never applied to them.
 */
export function CompareTab({ periods, periodId, onPeriod }: { periods: PeriodView[]; periodId: string; onPeriod: (id: string) => void }) {
  const { can } = useAuth();
  const canCompare = can("performance.compare");
  const [family, setFamily] = useState("");
  const [minTenure, setMinTenure] = useState("30");
  const [insufficient, setInsufficient] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const structure = useQuery({ queryKey: ["structure"], queryFn: getStructure, retry: false, enabled: canCompare });
  const filters = { periodId, ...(family ? { roleFamilyId: family } : {}), minTenureDays: Number.isFinite(Number(minTenure)) ? Math.max(0, Math.round(Number(minTenure))) : 30, includeInsufficient: insufficient };
  const live = useQuery({ queryKey: ["performance-compare", filters], queryFn: () => getCompare(filters), retry: false, enabled: !savedId });
  const snap = useQuery({ queryKey: ["performance-comparison", savedId], queryFn: () => getComparison(savedId!), retry: false, enabled: Boolean(savedId) });
  const result: CompareResult | undefined = savedId ? snap.data?.result : live.data;
  const loading = savedId ? snap.isPending : live.isPending;
  const error = savedId ? snap.error : live.error;
  const families = (structure.data?.roleFamilies ?? []).filter((f) => !f.archivedAt);
  // someone with no role family of their own (for example the Owner) would otherwise see an empty page: ask them to pick one
  const needsFamily = !savedId && !family && canCompare && result !== undefined && result.roleFamily === null && families.length > 0;
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader><CardTitle>Compare with peers</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SelectField label="Period" value={periodId} onChange={(e) => { setSavedId(null); onPeriod(e.target.value); }}>
              {periods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </SelectField>
            {canCompare && (
              <SelectField label="Role family" value={family} onChange={(e) => { setSavedId(null); setFamily(e.target.value); }}>
                <option value="">My own role family</option>
                {structure.data?.roleFamilies.filter((f) => !f.archivedAt).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </SelectField>
            )}
            <FormField label="Least time in the role (days)" type="number" min={0} max={3650} value={minTenure} onChange={(e) => { setSavedId(null); setMinTenure(e.target.value); }} />
            <label className="flex items-end gap-2 pb-2 text-label"><input type="checkbox" checked={insufficient} onChange={(e) => { setSavedId(null); setInsufficient(e.target.checked); }} /> Also show people without enough data</label>
          </div>
          <p className="text-caption text-muted-foreground">Only people with the same role family are compared, as it was in that period. A comparison is a conversation starter, not a verdict.</p>
        </CardContent>
      </Card>
      {loading ? <PageSkeleton /> : error ? <ErrorState title="The comparison could not be made" error={error} onRetry={() => void (savedId ? snap.refetch() : live.refetch())} /> : result ? (
        <>
          {savedId && snap.data && <p role="status" className="rounded-lg border bg-muted/40 px-3 py-2 text-label">Saved comparison “{snap.data.name}”, shown exactly as it was saved on {formatDateTime(snap.data.createdAt, "UTC")}. <button type="button" className="font-medium text-primary-ink underline" onClick={() => setSavedId(null)}>Back to live data</button></p>}
          {needsFamily ? (
            <Card aria-label="Choose a role family">
              <CardHeader><CardTitle>Choose a role family to compare</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-label text-muted-foreground">You are not in a role family yourself, so there is no group of peers to compare you with. Pick the role family you want to look at (real or demo).</p>
                <div className="max-w-xs"><SelectField label="Role family to compare" value="" onChange={(e) => { setSavedId(null); setFamily(e.target.value); }}>
                  <option value="">Choose a role family…</option>
                  {families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </SelectField></div>
              </CardContent>
            </Card>
          ) : <Result result={result} />}
          {canCompare && !needsFamily && result.entries.length > 1 && !savedId && <Why result={result} />}
          {canCompare && !savedId && !needsFamily && <SaveForm filters={filters} onSaved={(id) => setSavedId(id)} />}
        </>
      ) : null}
      {canCompare && <Saved onOpen={setSavedId} />}
    </div>
  );
}

function Result({ result }: { result: CompareResult }) {
  const y = result.you;
  return (
    <Card>
      <CardHeader><CardTitle>{result.roleFamily ? `${result.roleFamily.name}, ${result.period.name}` : "No role family"}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {result.roleFamily && <p className="text-label text-muted-foreground">{result.cohortSize} {result.cohortSize === 1 ? "person" : "people"} compared{result.excluded.tenure + result.excluded.insufficient > 0 ? `, ${result.excluded.tenure + result.excluded.insufficient} left out` : ""}.</p>}
        {y && (
          <p role="status" aria-label="Your position" className="rounded-xl border bg-card p-3 text-body">
            {y.rank !== null && y.percentile !== null
              ? <>You are <strong>{ordinal(y.rank)} of {y.of}</strong>, at the <strong>{y.percentile.toFixed(1)}</strong> percentile{y.zScore !== null ? <> (z-score {y.zScore.toFixed(2)})</> : null}. Your score is {y.total === null ? "not available" : y.total.toFixed(1)}.</>
              : <>Your score is {y.total === null ? "not available" : y.total.toFixed(1)}. There are too few peers to rank.</>}
          </p>
        )}
        {result.notes.length > 0 && <ul className="list-disc space-y-1 pl-5 text-caption text-muted-foreground">{result.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        {result.entries.length > 0 && result.canSeeNames && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-label">
              <caption className="sr-only">People compared, highest first</caption>
              <thead><tr className="text-left text-caption text-muted-foreground"><th scope="col" className="py-1 font-medium">Rank</th><th scope="col" className="py-1 font-medium">Person</th><th scope="col" className="py-1 font-medium">Score</th><th scope="col" className="py-1 font-medium">Percentile</th><th scope="col" className="py-1 font-medium">Status</th><th scope="col" className="py-1 font-medium">Context (not applied)</th></tr></thead>
              <tbody>
                {result.entries.map((e) => (
                  <tr key={e.subject.id} className="border-t align-top">
                    <td className="py-1.5 tabular-nums">{e.rank ?? "–"}</td>
                    <th scope="row" className="py-1.5 text-left font-medium">{e.subject.name}{e.isYou ? " (you)" : ""}</th>
                    <td className="py-1.5 tabular-nums">{e.total === null ? "Not scored" : e.total.toFixed(1)}</td>
                    <td className="py-1.5 tabular-nums">{e.percentile === null ? "–" : e.percentile.toFixed(1)}</td>
                    <td className="py-1.5"><Badge variant={STATUS_VARIANT[e.status]}>{STATUS_WORD[e.status]}</Badge></td>
                    <td className="py-1.5 text-caption text-muted-foreground">{e.context.tenureDays === null ? "Time in role unknown" : `${e.context.tenureDays} days in role`} · {e.context.teamSize === null ? "no team" : `team of ${e.context.teamSize}`} · workload {e.context.taskLoad} · data {Math.round(e.context.dataCoverage * 100)}% · confidence {e.context.confidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {result.hiddenCount > 0 && <p className="text-caption text-muted-foreground">{result.hiddenCount} more {result.hiddenCount === 1 ? "person is" : "people are"} in this group but outside what you may see. They count toward the ranks above; their names and scores are not shown.</p>}
        {!result.canSeeNames && <p className="text-caption text-muted-foreground">Only your own position is shown. Names and scores of other people need permission to compare.</p>}
        {result.roleFamily && result.cohortSize === 0 && <EmptyState illustration="gauge" title="Nobody to compare yet">No one in this role family has a score for this period.</EmptyState>}
      </CardContent>
    </Card>
  );
}

function Why({ result }: { result: CompareResult }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const q = useQuery({ queryKey: ["performance-difference", result.period.id, a, b], queryFn: () => getDifference({ periodId: result.period.id, a, b }), retry: false, enabled: Boolean(a && b && a !== b) });
  return (
    <Card>
      <CardHeader><CardTitle>Why do two people differ?</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div role="group" aria-label="Pick two people" className="grid gap-3 sm:grid-cols-2">
          <SelectField label="First person" value={a} onChange={(e) => setA(e.target.value)}><option value="">Choose</option>{result.entries.map((e) => <option key={e.subject.id} value={e.subject.id}>{e.subject.name}</option>)}</SelectField>
          <SelectField label="Second person" value={b} onChange={(e) => setB(e.target.value)}><option value="">Choose</option>{result.entries.map((e) => <option key={e.subject.id} value={e.subject.id}>{e.subject.name}</option>)}</SelectField>
        </div>
        {q.isError && <FormAlert>{problemText(q.error)}</FormAlert>}
        {q.data && (
          <div role="region" aria-label="Difference" className="space-y-2">
            <p className="text-label">{q.data.a.name} {q.data.a.total === null ? "not scored" : q.data.a.total.toFixed(1)} and {q.data.b.name} {q.data.b.total === null ? "not scored" : q.data.b.total.toFixed(1)}: <strong>{deltaText(q.data.totalDifference)}</strong></p>
            <table className="w-full text-label">
              <caption className="sr-only">Difference by part</caption>
              <thead><tr className="text-left text-caption text-muted-foreground"><th scope="col" className="py-1 font-medium">Part</th><th scope="col" className="py-1 font-medium">{q.data.a.name}</th><th scope="col" className="py-1 font-medium">{q.data.b.name}</th><th scope="col" className="py-1 text-right font-medium">Adds to the gap</th></tr></thead>
              <tbody>
                {q.data.parts.map((p) => (
                  <tr key={p.key} className="border-t">
                    <th scope="row" className="py-1.5 text-left font-medium">{p.label}</th>
                    <td className="py-1.5 tabular-nums">{p.a === null ? "No data" : p.a.toFixed(1)}</td>
                    <td className="py-1.5 tabular-nums">{p.b === null ? "No data" : p.b.toFixed(1)}</td>
                    <td className="py-1.5 text-right tabular-nums">{deltaText(p.contribution)}{p.note ? <span className="block text-caption text-muted-foreground">{p.note}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SaveForm({ filters, onSaved }: { filters: { periodId: string; roleFamilyId?: string; minTenureDays: number; includeInsufficient: boolean }; onSaved: (id: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const save = useMutation({ mutationFn: () => saveComparison({ ...filters, name }), onSuccess: (d) => { setName(""); void qc.invalidateQueries({ queryKey: ["performance-comparisons"] }); onSaved(d.id); } });
  return (
    <form aria-label="Save this comparison" onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3">
      <div className="min-w-[14rem] flex-1"><FormField label="Save this comparison as" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} hint="A saved comparison does not change when scores are recalculated." /></div>
      <Button type="submit" size="sm" disabled={save.isPending || name.trim() === ""}><Save aria-hidden="true" /> {save.isPending ? "Saving…" : "Save"}</Button>
      {save.isError && <div className="w-full"><FormAlert>{problemText(save.error)}</FormAlert></div>}
      {save.isSuccess && <div className="w-full"><FormNotice>Saved.</FormNotice></div>}
    </form>
  );
}

function Saved({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useQuery({ queryKey: ["performance-comparisons"], queryFn: listComparisons, retry: false });
  if (q.isPending || q.isError || q.data.length === 0) return null;
  return (
    <section aria-label="Saved comparisons" className="space-y-2">
      <h3 className="text-label font-semibold">Saved comparisons</h3>
      <ul className="divide-y rounded-xl border bg-card">
        {q.data.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 p-3">
            <span className="min-w-0 flex-1"><span className="text-body font-medium">{c.name}</span> <span className="text-caption text-muted-foreground">{c.cohortSize} people · saved by {c.createdBy.name} · {formatDateTime(c.createdAt, "UTC")}</span></span>
            <Button size="sm" variant="outline" aria-label={`Open saved comparison ${c.name}`} onClick={() => onOpen(c.id)}>Open</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
