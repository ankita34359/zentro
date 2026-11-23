import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { getKpiOverview, STATUS_LABEL } from "@/services/kpi";
import { CategoryBadge, StatusBadge } from "./kpiUi";

const ORDER = ["critical", "warning", "ok", "excellent", "no_data"] as const;

/** KPI health across everything the caller may see: how many series are in each status, which KPIs have gaps, and who needs attention. */
export function KpiOverviewView({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useQuery({ queryKey: ["kpi-overview"], queryFn: getKpiOverview, retry: false });
  if (q.isPending) return <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;
  if (q.isError) return <ErrorState title="The KPI overview could not be loaded" error={q.error} onRetry={() => void q.refetch()} />;
  const o = q.data;
  if (o.totals.series === 0) {
    return <EmptyState illustration="chart" title="Nothing to summarise yet">Give a KPI to someone, or record a first value, and its health appears here.</EmptyState>;
  }
  return (
    <section aria-label="KPI overview" className="space-y-6">
      <dl aria-label="Series by status" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-xl border bg-card p-3"><dt className="text-caption text-muted-foreground">Measured series</dt><dd className="text-heading font-semibold tabular-nums">{o.totals.series}</dd></div>
        {ORDER.map((s) => (
          <div key={s} className="rounded-xl border bg-card p-3"><dt className="text-caption text-muted-foreground">{STATUS_LABEL[s]}</dt><dd className="text-heading font-semibold tabular-nums">{o.totals.byStatus[s] ?? 0}</dd></div>
        ))}
      </dl>
      <p className="text-label text-muted-foreground">A series is one KPI for one person, team or department. {o.totals.missingPeriods === 0 ? "No measurement period is missing." : <><strong className="text-off-track-ink">{o.totals.missingPeriods} measurement {o.totals.missingPeriods === 1 ? "period is" : "periods are"} missing</strong> in the periods that have ended.</>}</p>
      <section aria-label="Needs attention" className="space-y-2">
        <h3 className="text-label font-semibold">Needs attention</h3>
        {o.attention.length === 0 ? <p className="text-label text-muted-foreground">Nothing is at a warning or critical level, and no period is missing.</p> : (
          <ul className="divide-y rounded-xl border bg-card">
            {o.attention.map((a) => (
              <li key={`${a.kpiId}-${a.subject.kind}-${a.subject.id}`}>
                <button type="button" onClick={() => onOpen(a.kpiId)} aria-label={`Open KPI: ${a.kpiName}, ${a.subject.name}`} className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left hover:bg-muted/50">
                  <span className="min-w-0 flex-1 text-body font-medium">{a.kpiName} <span className="font-normal text-muted-foreground">· {a.subject.name}</span></span>
                  <StatusBadge status={a.status} />
                  <span className="text-label text-muted-foreground">{a.label}</span>
                  {a.missing > 0 && <span className="text-label font-medium text-off-track-ink">{a.missing} missing</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="By KPI" className="space-y-2">
        <h3 className="text-label font-semibold">By KPI</h3>
        <ul className="divide-y rounded-xl border bg-card">
          {o.kpis.map((k) => (
            <li key={k.id}>
              <button type="button" onClick={() => onOpen(k.id)} aria-label={`Open KPI: ${k.name}`} className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left hover:bg-muted/50">
                <span className="min-w-0 flex-1 text-body font-medium">{k.name}</span>
                <CategoryBadge category={k.category} />
                <span className="text-label text-muted-foreground">{k.series} {k.series === 1 ? "series" : "series"}</span>
                <span className="text-label text-muted-foreground">{ORDER.filter((s) => (k.byStatus[s] ?? 0) > 0).map((s) => `${k.byStatus[s]} ${(STATUS_LABEL[s] ?? s).toLowerCase()}`).join(", ")}</span>
                <span className="text-label tabular-nums text-muted-foreground">{k.coveragePct === null ? "No periods due yet" : `${k.coveragePct}% of periods have a value`}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
