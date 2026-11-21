import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import { ErrorState } from "@/components/common/ErrorState";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useHealth } from "@/hooks/useHealth";
import { CountUp } from "@/motion/CountUp";
import { ProgressRing } from "@/motion/ProgressRing";
import { Stagger, StaggerItem } from "@/motion/Stagger";
import { NAV_ITEMS } from "@/routes/navigation";

/** `done` stays false until the stage that builds each step can tell from real data (see the Stage badge). */
const STEPS = [
  { label: "Create departments", to: "/organization", stage: "2.5", done: false },
  { label: "Invite people", to: "/settings", stage: "2.2", done: false },
  { label: "Set reporting lines", to: "/organization", stage: "2.6", done: false },
  { label: "Create a company objective", to: "/okrs", stage: "3.1", done: false },
  { label: "Define KPIs", to: "/kpis", stage: "3.3", done: false },
  { label: "Assign tasks", to: "/my-work", stage: "4.1", done: false },
] as const;

function ServerStatus() {
  const { data, isPending, isError, error, refetch } = useHealth();
  if (isPending) {
    return (
      <div role="status" aria-busy="true" className="space-y-2.5">
        <span className="sr-only">Loading server status</span>
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-44" />
      </div>
    );
  }
  if (isError || !data) return <ErrorState title="Could not reach the server" error={error} onRetry={() => void refetch()} className="py-6" />;
  return (
    <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2.5 text-label">
      <dt className="text-muted-foreground">Status</dt>
      <dd>{data.ready ? <StatusBadge status="on-track" label="Ready" /> : <StatusBadge status="at-risk" label="Setup incomplete" />}</dd>
      <dt className="text-muted-foreground">Version</dt>
      <dd className="font-mono tabular-nums">{data.version}</dd>
      <dt className="text-muted-foreground">Database migrations</dt>
      <dd className="tabular-nums">{data.migrations ? `${data.migrations.applied} of ${data.migrations.total} applied` : "Not available"}</dd>
      <dt className="text-muted-foreground">Last scheduled tick</dt>
      <dd className="tabular-nums">{data.lastTick ? new Date(data.lastTick.startedAt).toLocaleString() : "None yet"}</dd>
    </dl>
  );
}

export default function OverviewPage() {
  const nav = NAV_ITEMS.find((n) => n.key === "overview")!;
  const done = STEPS.filter((s) => s.done).length;
  return (
    <>
      <PageHeader title={nav.label} description={nav.description} glow />
      <Stagger className="grid gap-6 lg:grid-cols-3">
        <StaggerItem className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div className="space-y-1">
                <CardTitle>Getting started</CardTitle>
                <CardDescription>
                  Nothing has been set up yet, so there is nothing to chart. These steps will tick off by themselves once real data exists;
                  each page shows the stage that builds it.
                </CardDescription>
              </div>
              <ProgressRing value={done} max={STEPS.length} label="Getting started steps done" size={88}>
                <span className="text-heading font-semibold leading-none">
                  <CountUp value={done} />
                  <span className="text-muted-foreground">/{STEPS.length}</span>
                </span>
                <span className="mt-0.5 text-caption text-muted-foreground">done</span>
              </ProgressRing>
            </CardHeader>
            <CardContent>
              <ol className="divide-y">
                {STEPS.map((s, i) => (
                  <li key={s.label}>
                    <Link
                      to={s.to}
                      className="group flex items-center gap-3 rounded-md py-3 text-label font-medium transition-colors duration-[var(--duration-fast)] hover:text-primary"
                    >
                      <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed text-caption text-muted-foreground tabular-nums">
                        {i + 1}
                      </span>
                      <span className="sr-only">Not started: </span>
                      <span className="flex-1">{s.label}</span>
                      <Badge variant="outline">Stage {s.stage}</Badge>
                      <ArrowRight aria-hidden="true" className="size-4 text-muted-foreground transition-transform duration-[var(--duration-fast)] motion-safe:group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </StaggerItem>
        <StaggerItem>
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Server status</CardTitle>
              <CardDescription>Live from the server's health check.</CardDescription>
            </CardHeader>
            <CardContent>
              <ServerStatus />
            </CardContent>
          </Card>
        </StaggerItem>
      </Stagger>
    </>
  );
}
