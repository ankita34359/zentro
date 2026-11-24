import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { PageHeader } from "@/components/common/PageHeader";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getInsights } from "@/services/dashboards";
import { AskAi } from "./AskAi";
import { EarlyVersion } from "./parts";

/** AI Intelligence (stage 7.1, first version): insights from plain rules over the person's own data. No AI model is called. */
export default function InsightsPage() {
  const q = useQuery({ queryKey: ["insights"], queryFn: getInsights, retry: false });
  return (
    <>
      <PageHeader eyebrow="Insight" title="AI Intelligence" description="Insights from your data, worked out by plain rules, each with its numbers." />
      <EarlyVersion>The insights below are counted by plain rules from your own records. AI answers appear above them only when AI is connected.</EarlyVersion>
      <AskAi />
      {q.isPending ? <PageSkeleton /> : q.isError ? <ErrorState title="Insights could not be loaded" error={q.error} onRetry={() => void q.refetch()} /> : q.data.insights.length === 0 ? (
        <EmptyState illustration="chart" title="Nothing needs attention right now">No objective is behind pace, no task is overdue, and no KPI has missing months among the records you can see.</EmptyState>
      ) : (
        <ul aria-label="Insights" className="space-y-4">
          {q.data.insights.map((i) => (
            <li key={i.key}>
              <Card>
                <CardHeader><CardTitle>{i.title} <Badge variant={i.severity === "attention" ? "atRisk" : "info"}>{i.severity === "attention" ? "Needs attention" : "For your information"}</Badge></CardTitle><p className="text-label text-muted-foreground">{i.summary}</p></CardHeader>
                <CardContent className="space-y-2">
                  <ul className="space-y-1">{i.items.map((x) => <li key={x.to + x.label} className="text-label"><Link className="font-medium text-primary-ink underline" to={x.to}>{x.label}</Link> <span className="text-muted-foreground">{x.detail}</span></li>)}</ul>
                  {i.count > i.items.length && <p className="text-caption text-muted-foreground">And {i.count - i.items.length} more. <Link className="underline" to={i.to}>See them all</Link></p>}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {q.data && <p className="mt-6 text-caption text-muted-foreground">{q.data.note}</p>}
    </>
  );
}
