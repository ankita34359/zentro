import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { ErrorState } from "@/components/common/ErrorState";
import { PageHeader } from "@/components/common/PageHeader";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getIntegrations } from "@/services/dashboards";
import { EarlyVersion } from "./parts";

/** Integrations (stage 8.1, first version): viaSocket status, the events Zentro records, and how to connect. Shows whether a setting exists, never its value. */
export default function IntegrationsPage() {
  const q = useQuery({ queryKey: ["integrations"], queryFn: getIntegrations, retry: false });
  return (
    <>
      <PageHeader eyebrow="System" title="Integrations" description="Connected apps and automations." />
      <EarlyVersion>Nothing is sent to viaSocket yet. Connecting apps and building workflows comes in a later version.</EarlyVersion>
      {q.isPending ? <PageSkeleton /> : q.isError ? <ErrorState title="Integration status could not be loaded" error={q.error} onRetry={() => void q.refetch()} /> : (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>viaSocket <Badge variant="dashed">{q.data.viaSocket.status}</Badge></CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-label">Settings the server needs (only whether each is set is shown, never its value):</p>
              <ul aria-label="Settings" className="space-y-1">{q.data.viaSocket.settings.map((s) => <li key={s.name} className="flex items-center gap-2 text-label">{s.set ? <CheckCircle2 aria-hidden="true" className="size-4 text-on-track-ink" /> : <CircleDashed aria-hidden="true" className="size-4 text-muted-foreground" />}<code>{s.name}</code> <span className="text-muted-foreground">{s.set ? "is set" : "is not set"}</span></li>)}</ul>
            </CardContent>
          </Card>
          <section aria-label="What is needed to connect" className="space-y-2">
            <h2 className="text-heading font-semibold">What is needed to connect</h2>
            <ol className="list-decimal space-y-1 pl-5 text-label">{q.data.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          </section>
          <section aria-label="Events" className="space-y-2">
            <h2 className="text-heading font-semibold">Events Zentro records</h2>
            <p className="text-caption text-muted-foreground">{q.data.note}</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-label">
                <caption className="sr-only">Events</caption>
                <thead><tr className="text-left text-caption text-muted-foreground"><th scope="col" className="py-1 font-medium">Event</th><th scope="col" className="py-1 font-medium">What it means</th><th scope="col" className="py-1 font-medium">Status</th><th scope="col" className="py-1 text-right font-medium">Last 30 days</th></tr></thead>
                <tbody>{q.data.events.map((e) => (
                  <tr key={e.type} className="border-t"><th scope="row" className="py-1.5 text-left font-medium"><code>{e.type}</code></th><td className="py-1.5">{e.description}</td><td className="py-1.5"><Badge variant={e.status === "recorded" ? "onTrack" : "dashed"}>{e.status === "recorded" ? "Recorded" : "Planned"}</Badge></td><td className="py-1.5 text-right tabular-nums">{e.last30Days === null ? "–" : e.last30Days}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
