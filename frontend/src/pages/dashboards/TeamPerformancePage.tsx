import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { PageHeader } from "@/components/common/PageHeader";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { SelectField } from "@/components/common/SelectField";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTeamPerformance, type TeamCard } from "@/services/dashboards";
import type { Health } from "@/services/okr";
import { HealthBadge } from "@/pages/okrs/okrUi";
import { pct, statusCounts } from "./parts";

const STATUS_WORD: Record<string, string> = { final: "Final", provisional: "Provisional", insufficient: "Not enough data" };

/** Team Performance (stage 6.2): one card per team the person may see, with member scores, the team average and what it rests on, a fair comparison, and mentoring. */
export default function TeamPerformancePage() {
  const [periodId, setPeriodId] = useState<string | undefined>(undefined);
  const q = useQuery({ queryKey: ["team-performance", periodId ?? "default"], queryFn: () => getTeamPerformance(periodId), retry: false, placeholderData: (p) => p });
  const period = q.data?.period ?? null;
  return (
    <>
      <PageHeader eyebrow="Execution" title="Team Performance" description="How the teams you belong to or look after are doing: scores, objectives, KPIs, tasks and mentoring." />
      <p className="mb-5 max-w-prose text-caption text-muted-foreground">Scores are information to start a conversation, not employment decisions. A missing value is never counted as zero, and every average says how many people it rests on.</p>
      {q.isPending ? <PageSkeleton /> : q.isError ? <ErrorState title="Team performance could not be loaded" error={q.error} onRetry={() => void q.refetch()} /> : q.data.teams.length === 0 ? (
        <EmptyState illustration="team" title="No team data in your scope yet">Teams you belong to or look after appear here once they exist and you can see them.</EmptyState>
      ) : (
        <div className="space-y-6">
          {q.data.periods.length > 0 && <div className="max-w-xs"><SelectField label="Scores for the period" value={period?.id ?? ""} onChange={(e) => setPeriodId(e.target.value)}>{q.data.periods.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.status})</option>)}</SelectField></div>}
          {q.data.comparisons.length > 0 && (
            <section aria-label="Team comparison" className="space-y-3">
              <h2 className="text-heading font-semibold">Comparing teams</h2>
              {q.data.comparisons.map((c) => (
                <Card key={c.department}>
                  <CardHeader><CardTitle>{c.department}</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    <table className="w-full text-label"><caption className="sr-only">Teams of {c.department}</caption>
                      <thead><tr className="text-left text-caption text-muted-foreground"><th scope="col" className="py-1 font-medium">Team</th><th scope="col" className="py-1 font-medium">Average score</th><th scope="col" className="py-1 font-medium">People scored</th><th scope="col" className="py-1 font-medium">Position</th></tr></thead>
                      <tbody>{c.teams.map((t) => <tr key={t.id} className="border-t"><th scope="row" className="py-1.5 text-left font-medium">{t.name}</th><td className="py-1.5 tabular-nums">{t.average === null ? "Not scored" : t.average.toFixed(1)}</td><td className="py-1.5 tabular-nums">{t.n}</td><td className="py-1.5">{t.rank !== null ? `${t.rank} of ${c.teams.filter((x) => x.rank !== null).length}` : t.eligible ? "–" : "Too few people to rank"}</td></tr>)}</tbody>
                    </table>
                    <p className="text-caption text-muted-foreground">{c.note}</p>
                  </CardContent>
                </Card>
              ))}
            </section>
          )}
          <ul aria-label="Teams" className="grid gap-5 lg:grid-cols-2">{q.data.teams.map((t) => <li key={t.id}><TeamCardView t={t} periodId={period?.id ?? null} /></li>)}</ul>
        </div>
      )}
    </>
  );
}

function TeamCardView({ t, periodId }: { t: TeamCard; periodId: string | null }) {
  return (
    <Card>
      <CardHeader><CardTitle>{t.name}</CardTitle><p className="text-label text-muted-foreground">{t.department ?? "No department"} · {t.memberCount} {t.memberCount === 1 ? "person" : "people"}</p></CardHeader>
      <CardContent className="space-y-4">
        <section aria-label={`Members of ${t.name}`}>
          <h3 className="text-label font-semibold">Members and scores</h3>
          {t.memberCount === 0 ? <p className="text-caption text-muted-foreground">Nobody is in this team yet.</p> : (
            <>
              <ul className="space-y-1">{t.members.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2 text-label">
                  <span className="font-medium">{m.name}{m.role === "lead" ? " (lead)" : ""}</span>
                  {m.score === null ? <span className="text-muted-foreground">No score you can see</span> : <>
                    <span className="tabular-nums">{m.score.total === null ? "Not scored" : m.score.total.toFixed(1)}</span>
                    <Badge variant={m.score.status === "final" ? "onTrack" : m.score.status === "provisional" ? "info" : "dashed"}>{STATUS_WORD[m.score.status] ?? m.score.status}</Badge>
                    <span className="text-caption text-muted-foreground">confidence {m.score.confidenceLabel}</span>
                    {periodId && <Link className="text-caption underline" aria-label={`How ${m.name}'s score was calculated`} to={`/performance?period=${periodId}&person=${m.id}`}>How was this calculated?</Link>}
                  </>}
                </li>))}
              </ul>
              {t.hiddenMembers > 0 && <p className="text-caption text-muted-foreground">{t.hiddenMembers} more {t.hiddenMembers === 1 ? "person" : "people"} in this team you may not see by name.</p>}
              <p className="mt-1 text-label" aria-label={`Team average of ${t.name}`}>{t.average === null ? "Team average: no score you can see yet." : <>Team average: <strong className="tabular-nums">{t.average.value.toFixed(1)}</strong> from {t.average.n} of {t.average.of} {t.average.of === 1 ? "person" : "people"}.</>}</p>
              {t.average?.note && <p className="text-caption text-muted-foreground">{t.average.note}</p>}
            </>
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
        {t.mentoring !== null && (
          <section aria-label={`Mentoring in ${t.name}`}>
            <h3 className="text-label font-semibold">Mentoring</h3>
            {t.mentoring.pairs === 0 ? <p className="text-caption text-muted-foreground">No mentoring pair involves this team.</p> : (
              <>
                <p className="text-label tabular-nums">{t.mentoring.pairs} {t.mentoring.pairs === 1 ? "pair" : "pairs"} ({t.mentoring.activePairs} active) · {t.mentoring.sessions} sessions logged{t.mentoring.averageImprovement !== null ? ` · mentees' improvement ${t.mentoring.averageImprovement} (50 = no change, ${t.mentoring.menteesMeasured} measured)` : " · no mentee change can be measured yet"}</p>
                <p className="text-caption text-muted-foreground">{t.mentoring.caveat}</p>
              </>
            )}
          </section>
        )}
        <section aria-label={`Tasks of ${t.name}`}>
          <h3 className="text-label font-semibold">Task progress</h3>
          {t.tasks === null ? <p className="text-caption text-muted-foreground">You do not have access to tasks.</p> : <p className="text-label tabular-nums">{t.tasks.open} open · <strong>{t.tasks.overdue}</strong> overdue · {t.tasks.blocked} blocked · {t.tasks.done} done</p>}
        </section>
      </CardContent>
    </Card>
  );
}
