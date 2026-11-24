import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { PageHeader } from "@/components/common/PageHeader";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTeamPerformance, type TeamCard } from "@/services/dashboards";
import type { Health } from "@/services/okr";
import { HealthBadge } from "@/pages/okrs/okrUi";
import { EarlyVersion, pct, statusCounts } from "./parts";

/** Team Performance (stage 6.2, first version): one read-only card per team the person may see. */
export default function TeamPerformancePage() {
  const q = useQuery({ queryKey: ["team-performance"], queryFn: getTeamPerformance, retry: false });
  return (
    <>
      <PageHeader eyebrow="Execution" title="Team Performance" description="How the teams you belong to or look after are doing: their objectives, KPIs and tasks." />
      <EarlyVersion>Read only for now. Member scores, mentoring and team comparison come in a later version.</EarlyVersion>
      {q.isPending ? <PageSkeleton /> : q.isError ? <ErrorState title="Team performance could not be loaded" error={q.error} onRetry={() => void q.refetch()} /> : q.data.teams.length === 0 ? (
        <EmptyState illustration="team" title="No team data in your scope yet">Teams you belong to or look after appear here once they exist and you can see them.</EmptyState>
      ) : (
        <ul aria-label="Teams" className="grid gap-5 lg:grid-cols-2">{q.data.teams.map((t) => <li key={t.id}><TeamCardView t={t} /></li>)}</ul>
      )}
    </>
  );
}

function TeamCardView({ t }: { t: TeamCard }) {
  return (
    <Card>
      <CardHeader><CardTitle>{t.name}</CardTitle><p className="text-label text-muted-foreground">{t.department ?? "No department"} · {t.memberCount} {t.memberCount === 1 ? "person" : "people"}</p></CardHeader>
      <CardContent className="space-y-4">
        <section aria-label={`Members of ${t.name}`}>
          <h3 className="text-label font-semibold">Members</h3>
          {t.memberCount === 0 ? <p className="text-caption text-muted-foreground">Nobody is in this team yet.</p> : (
            <p className="text-label">{t.members.map((m) => m.name + (m.role === "lead" ? " (lead)" : "")).join(", ")}{t.hiddenMembers > 0 ? `${t.members.length ? " and " : ""}${t.hiddenMembers} more you may not see by name` : ""}</p>
          )}
        </section>
        <section aria-label={`Objectives of ${t.name}`}>
          <h3 className="text-label font-semibold">Team objectives</h3>
          {t.objectives === null ? <p className="text-caption text-muted-foreground">You do not have access to objectives.</p> : t.objectives.length === 0 ? <p className="text-caption text-muted-foreground">No team objective yet.</p> : (
            <ul className="space-y-1">{t.objectives.map((o) => <li key={o.id} className="flex flex-wrap items-center gap-2 text-label"><Link className="font-medium text-primary-ink underline" to={`/okrs?objective=${o.id}`}>{o.title}</Link><HealthBadge health={o.health as Health | null} /><span className="tabular-nums text-muted-foreground">{pct(o.attainmentPct)}, {o.elapsedPct}% of the time passed</span></li>)}</ul>
          )}
        </section>
        <section aria-label={`KPIs of ${t.name}`}>
          <h3 className="text-label font-semibold">KPIs</h3>
          {t.kpis === null ? <p className="text-caption text-muted-foreground">You do not have access to KPIs.</p> : t.kpis.series === 0 ? <p className="text-caption text-muted-foreground">No KPI is assigned to this team or its people.</p> : (
            <>
              <p className="text-label">{t.kpis.series} series: {statusCounts(t.kpis.byStatus)}{t.kpis.missingPeriods > 0 ? `; ${t.kpis.missingPeriods} missing` : ""}</p>
              <ul className="space-y-0.5">{t.kpis.items.map((k) => <li key={`${k.kpiId}${k.subject}`} className="text-caption text-muted-foreground"><Link className="underline" to={`/kpis?kpi=${k.kpiId}`}>{k.name}</Link> ({k.subject}): {k.status === "critical" || k.status === "warning" ? k.status : "ok"}{k.missing > 0 ? `, ${k.missing} missing` : ""}</li>)}</ul>
            </>
          )}
        </section>
        <section aria-label={`Tasks of ${t.name}`}>
          <h3 className="text-label font-semibold">Task progress</h3>
          {t.tasks === null ? <p className="text-caption text-muted-foreground">You do not have access to tasks.</p> : <p className="text-label tabular-nums">{t.tasks.open} open · <strong>{t.tasks.overdue}</strong> overdue · {t.tasks.blocked} blocked · {t.tasks.done} done</p>}
        </section>
      </CardContent>
    </Card>
  );
}
