import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { PageHeader } from "@/components/common/PageHeader";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { FormField } from "@/components/common/FormField";
import { SelectField } from "@/components/common/SelectField";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HealthBadge } from "@/pages/okrs/okrUi";
import { getLeadership } from "@/services/dashboards";
import type { Health } from "@/services/okr";
import { delta, pct, Sparkline, statusCounts, Waterfall } from "./parts";

const KIND_WORD = { behind_pace: "Behind pace", overdue: "Past its end date", no_data: "No data recorded" } as const;

const PRESETS: [string, string][] = [["30d", "Last 30 days"], ["90d", "Last 90 days (a quarter)"], ["180d", "Last 180 days"], ["365d", "Last year"], ["custom", "Custom dates"]];

/** Leadership (stages 6.4 and 6.5): company objectives and KPIs over a date range, drill-down to people, risks and a plain summary. */
export default function LeadershipPage() {
  const [preset, setPreset] = useState("90d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const custom = preset === "custom";
  const ready = !custom || (from !== "" && to !== "");
  const params = custom ? { from, to } : { range: preset };
  const q = useQuery({ queryKey: ["leadership", params], queryFn: () => getLeadership(params), retry: false, enabled: ready, placeholderData: (p) => p });
  return (
    <>
      <PageHeader eyebrow="Insight" title="Leadership" description="Company objectives, how they moved, who contributes, and where the risks are." />
      <div className="mb-6 grid max-w-2xl gap-3 sm:grid-cols-3">
        <SelectField label="Show the last" value={preset} onChange={(e) => setPreset(e.target.value)}>{PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectField>
        {custom && <><FormField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><FormField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></>}
      </div>
      {!ready ? <p className="text-label text-muted-foreground">Choose both dates.</p> : q.isPending ? <PageSkeleton /> : q.isError ? <ErrorState title="The leadership view could not be loaded" error={q.error} onRetry={() => void q.refetch()} /> : (
        <div className="space-y-6">
          <section aria-label="Summary" className="space-y-1 rounded-xl border bg-card p-4">
            <h2 className="text-heading font-semibold">In short</h2>
            <p className="text-caption text-muted-foreground">Written from the numbers on this page only, {q.data.range.from} to {q.data.range.to}.</p>
            <ul className="list-disc space-y-1 pl-5 text-body">{q.data.summary.map((x) => <li key={x}>{x}</li>)}</ul>
          </section>
          <section aria-label="Company objectives" className="space-y-3">
            <h2 className="text-heading font-semibold">Company objectives</h2>
            {q.data.objectives.length === 0 ? <EmptyState illustration="chart" title="No company objective yet">Create and activate a company objective in OKRs & Goals and it appears here.</EmptyState> : (
              <ul className="space-y-4">
                {q.data.objectives.map((o) => (
                  <li key={o.id}>
                    <Card>
                      <CardHeader><CardTitle><Link className="underline" to={`/okrs?objective=${o.id}`}>{o.title}</Link></CardTitle></CardHeader>
                      <CardContent className="space-y-3">
                        <p className="flex flex-wrap items-center gap-2 text-label"><HealthBadge health={o.health as Health | null} /><span className="tabular-nums">{pct(o.attainmentPct)} done · {o.elapsedPct}% of the time has passed</span>{o.owner && <span className="text-muted-foreground">Owner: {o.owner}</span>}</p>
                        <p className="flex flex-wrap items-center gap-2 text-label"><span className="font-medium">Trend:</span><Sparkline points={o.trend} label={`${o.title}, progress over the range`} unit="%" /><span className="text-muted-foreground">Change over the range: {delta(o.change)}</span></p>
                        <div>
                          <h3 className="text-label font-semibold">Who contributes</h3>
                          {o.contributors.length === 0 ? <p className="text-caption text-muted-foreground">No department or team objective is linked to this one yet.</p> : (
                            <ul className="space-y-1">{o.contributors.map((c) => <li key={c.id} className="flex flex-wrap items-center gap-2 text-label"><span className="font-medium">{c.department ?? c.level}</span><span className="text-muted-foreground">{c.title}</span><HealthBadge health={c.health as Health | null} /><span className="tabular-nums text-muted-foreground">{pct(c.attainmentPct)}{c.contributionPct !== null ? `, adds ${c.contributionPct} points` : ""}</span></li>)}</ul>
                          )}
                          {o.contributors.length > 0 && <div className="mt-3"><Waterfall title={o.title} total={o.attainmentPct} contributors={o.contributors.map((c) => ({ id: c.id, label: c.department && c.department !== c.title ? `${c.title} (${c.department})` : c.title, points: c.contributionPct }))} /></div>}
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label="Executive KPIs" className="space-y-2">
            <h2 className="text-heading font-semibold">Executive KPIs</h2>
            {q.data.executiveKpis.length === 0 ? <p className="text-label text-muted-foreground">No organization-level KPI has been set up.</p> : (
              <ul className="grid gap-3 sm:grid-cols-2">{q.data.executiveKpis.map((k) => (
                <li key={k.kpiId} className="space-y-1 rounded-xl border bg-card p-3">
                  <p className="text-label font-medium"><Link className="underline" to={`/kpis?kpi=${k.kpiId}`}>{k.name}</Link></p>
                  <p className="text-label tabular-nums">{k.label}{k.target !== null ? ` · target ${k.target}${k.unit ? ` ${k.unit}` : ""}` : ""} · {k.status.replace("_", " ")}{k.missing > 0 ? ` · ${k.missing} missing` : ""}</p>
                  <Sparkline points={k.trend} label={`${k.name}, last periods`} unit={k.unit ? ` ${k.unit}` : ""} />
                  <p className="text-caption text-muted-foreground">Change across these periods: {delta(k.change, k.unit ? ` ${k.unit}` : "")}</p>
                </li>))}
              </ul>
            )}
          </section>
          <section aria-label="Drill-down" className="space-y-2">
            <h2 className="text-heading font-semibold">Company → department → team → person</h2>
            <p className="text-caption text-muted-foreground">{q.data.period ? `Scores for ${q.data.period.name}. ` : ""}Averages say how many people they rest on; a person's score opens the scorecard that explains it.</p>
            {q.data.departments.length === 0 ? <p className="text-label text-muted-foreground">No departments yet.</p> : q.data.departments.map((d) => (
              <details key={d.id} className="rounded-xl border bg-card p-3 [&_summary]:cursor-pointer">
                <summary className="text-label font-semibold">{d.name} <span className="font-normal text-muted-foreground">· {d.people} {d.people === 1 ? "person" : "people"} · average {d.average === null ? "not scored" : d.average.toFixed(1)} (from {d.n})</span></summary>
                <div className="mt-2 space-y-2 pl-2">
                  {d.objectives.length > 0 && <ul className="text-caption text-muted-foreground">{d.objectives.map((o) => <li key={o.id}>Objective: {o.title} ({pct(o.attainmentPct)})</li>)}</ul>}
                  {d.teams.map((t) => (
                    <details key={t.id} className="rounded-lg border p-2 [&_summary]:cursor-pointer">
                      <summary className="text-label font-medium">{t.name} <span className="font-normal text-muted-foreground">· {t.people} {t.people === 1 ? "person" : "people"} · average {t.average === null ? "not scored" : t.average.toFixed(1)} (from {t.n})</span></summary>
                      <ul className="mt-1 space-y-0.5">{t.members.map((m) => <li key={m.id} className="flex flex-wrap items-center gap-2 text-label"><span>{m.name}</span>{m.score === null ? <span className="text-muted-foreground">no score you can see</span> : <><span className="tabular-nums">{m.score.total === null ? "Not scored" : m.score.total.toFixed(1)}</span>{q.data.period && <Link className="text-caption underline" to={`/performance?period=${q.data.period.id}&person=${m.id}`}>How was this calculated?</Link>}</>}</li>)}</ul>
                    </details>
                  ))}
                </div>
              </details>
            ))}
          </section>
          <section aria-label="Risks" className="space-y-2">
            <h2 className="text-heading font-semibold">Risks</h2>
            {q.data.risks.length === 0 && q.data.groupedRisks.length === 0 ? <p className="text-label text-muted-foreground">Nothing is behind pace, overdue or without data.</p> : (
              <ul className="divide-y rounded-xl border bg-card">
                {q.data.risks.map((r) => <li key={`${r.kind}${r.id}`} className="flex flex-wrap items-center gap-2 p-3 text-label"><span className="font-medium">{KIND_WORD[r.kind]}</span><Link className="underline" to={`/okrs?objective=${r.id}`}>{r.title}</Link><span className="text-muted-foreground">{r.reason}</span></li>)}
                {q.data.groupedRisks.map((g) => (
                  <li key={g.kind} className="p-3 text-label">
                    <details className="[&_summary]:cursor-pointer"><summary><span className="font-medium">{KIND_WORD[g.kind]}</span>: {g.count} personal {g.count === 1 ? "objective" : "objectives"}</summary>
                      <ul className="mt-1 space-y-0.5">{g.items.map((i) => <li key={i.id} className="text-caption text-muted-foreground"><Link className="underline" to={`/okrs?objective=${i.id}`}>{i.title}</Link> {i.reason}</li>)}{g.count > g.items.length && <li className="text-caption text-muted-foreground">and {g.count - g.items.length} more</li>}</ul>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label="KPI health" className="space-y-2">
            <h2 className="text-heading font-semibold">KPI health</h2>
            {q.data.kpis === null ? <p className="text-label text-muted-foreground">You do not have access to KPIs.</p> : q.data.kpis.series === 0 ? <p className="text-label text-muted-foreground">No KPI values yet.</p> : (
              <>
                <p className="text-label">{q.data.kpis.series} series: {statusCounts(q.data.kpis.byStatus)}{q.data.kpis.missingPeriods > 0 ? `; ${q.data.kpis.missingPeriods} missing months` : ""}</p>
                <ul className="space-y-0.5">{q.data.kpis.attention.map((a) => <li key={`${a.kpiId}${a.subject}`} className="text-label text-muted-foreground"><Link className="underline" to={`/kpis?kpi=${a.kpiId}`}>{a.name}</Link> ({a.subject}): {a.label}{a.missing > 0 ? `, ${a.missing} missing` : ""}</li>)}</ul>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
