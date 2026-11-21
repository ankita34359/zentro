import { Circle } from "lucide-react";
import { Link } from "react-router";
import { ErrorState } from "@/components/common/ErrorState";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useHealth } from "@/hooks/useHealth";
import { NAV_ITEMS } from "@/routes/navigation";

const STEPS = [
  { label: "Create departments", to: "/organization", stage: "2.5" },
  { label: "Invite people", to: "/settings", stage: "2.2" },
  { label: "Set reporting lines", to: "/organization", stage: "2.6" },
  { label: "Create a company objective", to: "/okrs", stage: "3.1" },
  { label: "Define KPIs", to: "/kpis", stage: "3.3" },
  { label: "Assign tasks", to: "/my-work", stage: "4.1" },
] as const;

function ServerStatus() {
  const { data, isPending, isError, error, refetch } = useHealth();
  if (isPending) {
    return (
      <div role="status" aria-busy="true" className="space-y-2">
        <span className="sr-only">Loading server status</span>
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-40" />
      </div>
    );
  }
  if (isError || !data) return <ErrorState title="Could not reach the server" error={error} onRetry={() => void refetch()} className="py-6" />;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
      <dt className="text-muted-foreground">Status</dt>
      <dd>{data.ready ? "Ready" : "Setup incomplete"}</dd>
      <dt className="text-muted-foreground">Version</dt>
      <dd className="font-mono">{data.version}</dd>
      <dt className="text-muted-foreground">Database migrations</dt>
      <dd>{data.migrations ? `${data.migrations.applied} of ${data.migrations.total} applied` : "Not available"}</dd>
      <dt className="text-muted-foreground">Last scheduled tick</dt>
      <dd>{data.lastTick ? new Date(data.lastTick.startedAt).toLocaleString() : "None yet"}</dd>
    </dl>
  );
}

export default function OverviewPage() {
  const nav = NAV_ITEMS.find((n) => n.key === "overview")!;
  return (
    <>
      <PageHeader title={nav.label} description={nav.description} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Getting started</CardTitle>
            <CardDescription>
              Nothing has been set up yet, so there is nothing to chart. These steps will tick off by themselves once real data exists;
              each page shows the stage that builds it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="divide-y">
              {STEPS.map((s, i) => (
                <li key={s.label} className="flex items-center gap-3 py-3">
                  <Circle aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="sr-only">Not started: </span>
                  <Link to={s.to} className="flex-1 text-sm font-medium underline-offset-4 hover:underline">
                    {i + 1}. {s.label}
                  </Link>
                  <Badge variant="outline">Stage {s.stage}</Badge>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Server status</CardTitle>
            <CardDescription>Live from the server's health check.</CardDescription>
          </CardHeader>
          <CardContent>
            <ServerStatus />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
