import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { PageHeader } from "@/components/common/PageHeader";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HealthBadge } from "@/pages/okrs/okrUi";
import { getLeadership } from "@/services/dashboards";
import type { Health } from "@/services/okr";
import { EarlyVersion, pct, statusCounts } from "./parts";

const KIND_WORD = { behind_pace: "Behind pace", overdue: "Past its end date", no_data: "No data recorded" } as const;

/** Leadership (stage 6.4, first version): company objectives, who contributes, risks and KPI health. */
export default function LeadershipPage() {
  const q = useQuery({ queryKey: ["leadership"], queryFn: getLeadership, retry: false });
  return (
    <>
      <PageHeader eyebrow="Insight" title="Leadership" description="Company objectives, which departments and teams contribute to them, and where the risks are." />
      <EarlyVersion>Read only for now. Trends, executive KPIs, drill-down to people and a summary come in a later version.</EarlyVersion>
      {q.isPending ? <PageSkeleton /> : q.isError ? <ErrorState title="The leadership view could not be loaded" error={q.error} onRetry={() => void q.refetch()} /> : (
        <div className="space-y-6">
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
                        <div>
                          <h3 className="text-label font-semibold">Who contributes</h3>
                          {o.contributors.length === 0 ? <p className="text-caption text-muted-foreground">No department or team objective is linked to this one yet.</p> : (
                            <ul className="space-y-1">{o.contributors.map((c) => <li key={c.id} className="flex flex-wrap items-center gap-2 text-label"><span className="font-medium">{c.department ?? c.level}</span><span className="text-muted-foreground">{c.title}</span><HealthBadge health={c.health as Health | null} /><span className="tabular-nums text-muted-foreground">{pct(c.attainmentPct)}{c.contributionPct !== null ? `, adds ${c.contributionPct} points` : ""}</span></li>)}</ul>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label="Risks" className="space-y-2">
            <h2 className="text-heading font-semibold">Risks</h2>
            {q.data.risks.length === 0 ? <p className="text-label text-muted-foreground">Nothing is behind pace, overdue or without data.</p> : (
              <ul className="divide-y rounded-xl border bg-card">{q.data.risks.map((r) => <li key={`${r.kind}${r.id}`} className="flex flex-wrap items-center gap-2 p-3 text-label"><span className="font-medium">{KIND_WORD[r.kind]}</span><Link className="underline" to={`/okrs?objective=${r.id}`}>{r.title}</Link><span className="text-muted-foreground">{r.reason}</span></li>)}</ul>
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
