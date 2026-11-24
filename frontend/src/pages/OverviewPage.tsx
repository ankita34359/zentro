import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, FlaskConical } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/cn";
import { getOverview, type ChecklistItem, type Overview } from "@/services/overview";
import { STATUS_LABEL } from "@/services/tasks";
import { ProgressBar } from "@/motion/ProgressBar";
import { ErrorState } from "@/components/common/ErrorState";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useHealth } from "@/hooks/useHealth";
import { CountUp } from "@/motion/CountUp";
import { ProgressRing } from "@/motion/ProgressRing";
import { Stagger, StaggerItem } from "@/motion/Stagger";
import { NAV_ITEMS } from "@/routes/navigation";
import { Metric } from "@/components/common/Metric";
import { Attainment, HealthBadge } from "@/pages/okrs/okrUi";
import { StatusBadge as KpiStatusBadge } from "@/pages/kpis/kpiUi";

/** Shown before the server's numbers arrive (and when they cannot be loaded): nothing is claimed as done. */
const DEFAULT_STEPS: ChecklistItem[] = [
  { key: "departments", label: "Create departments", to: "/settings/structure", done: false, stage: null },
  { key: "people", label: "Add or invite people", to: "/organization/people", done: false, stage: null },
  { key: "reporting", label: "Set reporting lines", to: "/organization", done: false, stage: null },
  { key: "objective", label: "Create a company objective", to: "/okrs", done: false, stage: "3.1" },
  { key: "kpi", label: "Define KPIs", to: "/kpis", done: false, stage: "3.3" },
  { key: "tasks", label: "Assign tasks", to: "/my-work", done: false, stage: null },
];

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

const STATUS_BAR: Record<string, string> = { not_started: "bg-muted-foreground/50", in_progress: "bg-info", blocked: "bg-off-track", under_review: "bg-at-risk", completed: "bg-on-track", cancelled: "bg-border" };
const STATUS_ORDER = ["not_started", "in_progress", "blocked", "under_review", "completed", "cancelled"];

const Stat = ({ label, value, tone }: { label: string; value: number; tone?: string }) => (
  <div className="rounded-xl border bg-card px-4 py-3">
    <dt className="text-caption font-medium text-muted-foreground">{label}</dt>
    <dd className={cn("mt-1 text-display font-bold tabular-nums", tone)}>
      <CountUp value={value} />
    </dd>
  </div>
);

function YourWork({ o }: { o: Overview }) {
  const p = o.personal;
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Your work</CardTitle>
        <CardDescription>Your own tasks, counted from what is assigned to you.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Open" value={p.open} />
          <Stat label="Overdue" value={p.overdue} tone={p.overdue > 0 ? "text-off-track-ink" : undefined} />
          <Stat label="Due today" value={p.dueToday} />
          <Stat label="Blocked" value={p.blocked} tone={p.blocked > 0 ? "text-at-risk-ink" : undefined} />
        </dl>
        {p.next ? (
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">Next up</p>
            <Link to={`/my-work?task=${p.next.id}`} className="mt-1 block text-body font-semibold hover:text-primary-ink">{p.next.title}</Link>
            <p className="mt-1 flex flex-wrap gap-1.5">{p.next.reasons.map((r) => <Badge key={r} variant="neutral">{r}</Badge>)}</p>
          </div>
        ) : (
          <p className="text-label text-muted-foreground">Nothing is waiting for you. Tasks assigned to you appear in My Work.</p>
        )}
        <div className="flex flex-wrap items-center gap-3 text-label">
          <Link to="/my-work" className="inline-flex items-center gap-1 font-medium text-primary-ink hover:underline">Open My Work <ArrowRight aria-hidden="true" className="size-4" /></Link>
          {p.unreadNotifications > 0 && <span className="text-muted-foreground">{p.unreadNotifications} unread notification{p.unreadNotifications === 1 ? "" : "s"}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function TeamCard({ t }: { t: NonNullable<Overview["team"]> }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{t.label}</CardTitle>
        <CardDescription>{t.people} {t.people === 1 ? "person" : "people"} you can see, and their tasks.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Open tasks" value={t.openTasks} />
          <Stat label="Overdue" value={t.overdueTasks} tone={t.overdueTasks > 0 ? "text-off-track-ink" : undefined} />
          <Stat label="Blocked" value={t.blockedTasks} tone={t.blockedTasks > 0 ? "text-at-risk-ink" : undefined} />
          <Stat label="Done in 14 days" value={t.completedRecently} />
        </dl>
        {t.needsAttention.length > 0 ? (
          <section aria-label="Needs attention">
            <h3 className="mb-2 text-label font-semibold">Needs attention</h3>
            <ul className="divide-y rounded-lg border">
              {t.needsAttention.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <Link to={`/organization/people?person=${p.id}`} className="text-body font-medium hover:text-primary-ink">{p.name}</Link>
                  <span className="flex gap-1.5">
                    {p.overdue > 0 && <Badge variant="offTrack">{p.overdue} overdue</Badge>}
                    {p.blocked > 0 && <Badge variant="atRisk">{p.blocked} blocked</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="text-label text-muted-foreground">No one has overdue or blocked work right now.</p>
        )}
      </CardContent>
    </Card>
  );
}

function CompletedChart({ days }: { days: { date: string; count: number }[] }) {
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((n, d) => n + d.count, 0);
  const w = 280;
  const h = 90;
  const bar = w / days.length;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-label text-muted-foreground">{total} completed in the last {days.length} days</p>
        <Button size="sm" variant="ghost" aria-pressed={table} onClick={() => setTable((v) => !v)}>{table ? "View as chart" : "View as table"}</Button>
      </div>
      {table ? (
        <table className="w-full text-label">
          <thead><tr className="text-left text-muted-foreground"><th className="py-1 font-medium">Day</th><th className="py-1 text-right font-medium">Completed</th></tr></thead>
          <tbody>{days.map((d) => <tr key={d.date} className="border-t"><td className="py-1">{d.date}</td><td className="py-1 text-right tabular-nums">{d.count}</td></tr>)}</tbody>
        </table>
      ) : (
        <svg role="img" aria-label={`Tasks completed per day, last ${days.length} days: ${total} in total`} viewBox={`0 0 ${w} ${h + 16}`} className="w-full">
          {days.map((d, i) => {
            const bh = d.count === 0 ? 2 : Math.max(4, (d.count / max) * h);
            return (
              <g key={d.date}>
                <rect x={i * bar + 2} y={h - bh} width={bar - 4} height={bh} rx={2} className={d.count === 0 ? "fill-border" : "fill-on-track"}>
                  <title>{`${d.date}: ${d.count} completed`}</title>
                </rect>
              </g>
            );
          })}
          <text x={2} y={h + 12} className="fill-muted-foreground" fontSize="9">{days[0]!.date.slice(5)}</text>
          <text x={w - 2} y={h + 12} textAnchor="end" className="fill-muted-foreground" fontSize="9">{days.at(-1)!.date.slice(5)}</text>
        </svg>
      )}
    </div>
  );
}

function ObjectivesCard({ o, unaligned }: { o: NonNullable<Overview["objectives"]>; unaligned: number }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Company objectives</CardTitle>
        <CardDescription>How far each active company objective has really come, from the values recorded on its key results.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {o.items.length === 0 ? (
          <p className="text-label text-muted-foreground">
            No active company objective is visible to you yet. <Link to="/okrs" className="font-medium text-primary-ink underline">Open OKRs &amp; Goals</Link>
          </p>
        ) : (
          <ul aria-label="Company objectives" className="grid gap-4 lg:grid-cols-2">
            {o.items.map((i) => (
              <li key={i.id} className="space-y-1.5">
                <span className="flex flex-wrap items-center gap-2"><Link to={`/okrs?objective=${i.id}`} className="text-label font-medium hover:text-primary-ink">{i.title}</Link><HealthBadge health={(i.health as never) ?? null} /></span>
                <Attainment pct={i.attainmentPct} dataState={i.dataState} elapsedPct={i.elapsedPct} label={`Progress of ${i.title}`} />
              </li>
            ))}
          </ul>
        )}
        {unaligned > 0 && (
          <p className="border-t pt-3 text-label text-muted-foreground">
            {unaligned} of your open {unaligned === 1 ? "task supports" : "tasks support"} no objective. <Link to="/my-work/tasks" className="font-medium text-primary-ink underline">See your tasks</Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function KpiCard({ k }: { k: NonNullable<Overview["kpis"]> }) {
  const order = ["critical", "warning", "ok", "excellent", "no_data"] as const;
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>KPI health</CardTitle>
        <CardDescription>The latest value of each KPI you can see, against its thresholds.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul aria-label="KPI series by status" className="flex flex-wrap gap-x-5 gap-y-2 text-label">
          {order.filter((s) => (k.totals.byStatus[s] ?? 0) > 0).map((s) => (
            <li key={s} className="flex items-center gap-2"><KpiStatusBadge status={s} /> <span className="tabular-nums">{k.totals.byStatus[s]}</span></li>
          ))}
          {k.totals.missingPeriods > 0 && <li className="font-medium text-off-track-ink">{k.totals.missingPeriods} {k.totals.missingPeriods === 1 ? "period" : "periods"} missing</li>}
        </ul>
        {k.attention.length > 0 && (
          <ul aria-label="KPIs needing attention" className="divide-y rounded-lg border">
            {k.attention.map((a) => (
              <li key={`${a.kpiId}-${a.subject.name}`}>
                <Link to={`/kpis?kpi=${a.kpiId}`} className="flex flex-wrap items-center gap-2 px-3 py-2 text-label hover:bg-muted/50">
                  <span className="min-w-0 flex-1 font-medium">{a.kpiName} <span className="font-normal text-muted-foreground">· {a.subject.name}</span></span>
                  <KpiStatusBadge status={a.status} />
                  <span className="text-muted-foreground">{a.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link to="/kpis?view=overview" className="inline-block text-label font-medium text-primary-ink underline">Open the KPI overview</Link>
      </CardContent>
    </Card>
  );
}

function OrganizationCards({ org }: { org: NonNullable<Overview["organization"]> }) {
  const statuses = STATUS_ORDER.filter((s) => (org.tasksByStatus[s] ?? 0) > 0);
  const total = statuses.reduce((n, s) => n + (org.tasksByStatus[s] ?? 0), 0);
  return (
    <>
      <StaggerItem className="lg:col-span-3">
        <dl aria-label="Organization" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="People" value={org.people} />
          <Stat label="Departments" value={org.departments} />
          <Stat label="Teams" value={org.teams} />
          <Stat label="Open tasks" value={org.openTasks} />
          <Stat label="Overdue" value={org.overdueTasks} tone={org.overdueTasks > 0 ? "text-off-track-ink" : undefined} />
        </dl>
      </StaggerItem>
      <StaggerItem className="lg:col-span-2">
        <Card className="h-full">
          <CardHeader>
            <CardTitle>Tasks by status</CardTitle>
            <CardDescription>Every task in the organization, counted now.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {total === 0 ? <p className="text-label text-muted-foreground">There are no tasks yet. Create one in My Work.</p> : (
              <>
                <div role="img" aria-label={`Tasks by status: ${statuses.map((s) => `${org.tasksByStatus[s]} ${STATUS_LABEL[s]?.toLowerCase()}`).join(", ")}`} className="flex h-4 overflow-hidden rounded-full bg-muted">
                  {statuses.map((s) => <span key={s} className={STATUS_BAR[s]} style={{ width: `${((org.tasksByStatus[s] ?? 0) / total) * 100}%` }} />)}
                </div>
                <ul className="flex flex-wrap gap-x-5 gap-y-1 text-label">
                  {statuses.map((s) => (
                    <li key={s} className="flex items-center gap-2">
                      <span aria-hidden="true" className={cn("size-2.5 rounded-sm", STATUS_BAR[s])} />
                      {STATUS_LABEL[s]} <span className="tabular-nums text-muted-foreground">{org.tasksByStatus[s]}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="border-t pt-3"><CompletedChart days={org.completedByDay} /></div>
          </CardContent>
        </Card>
      </StaggerItem>
      <StaggerItem>
        <Card className="h-full">
          <CardHeader>
            <CardTitle>Department workload</CardTitle>
            <CardDescription>Open and overdue tasks of the people in each department.</CardDescription>
          </CardHeader>
          <CardContent>
            {org.departmentLoad.length === 0 ? <p className="text-label text-muted-foreground">Put people in departments to see their workload here.</p> : (
              <ul aria-label="Department workload" className="space-y-3">
                {org.departmentLoad.map((d) => (
                  <li key={d.id}>
                    <p className="flex flex-wrap items-baseline justify-between gap-2 text-label">
                      <span className="font-medium">{d.name} <span className="text-muted-foreground">({d.people})</span></span>
                      <span className="tabular-nums text-muted-foreground">{d.open} open{d.overdue > 0 ? `, ${d.overdue} overdue` : ""}</span>
                    </p>
                    <ProgressBar value={d.open - d.overdue} max={Math.max(1, d.open)} label={`${d.name}: ${d.open - d.overdue} of ${d.open} open tasks are on time`} tone={d.overdue > 0 ? "at-risk" : "on-track"} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </StaggerItem>
    </>
  );
}

export default function OverviewPage() {
  const nav = NAV_ITEMS.find((n) => n.key === "overview")!;
  const q = useQuery({ queryKey: ["overview"], queryFn: getOverview, retry: false });
  const o = q.data;
  const steps = o?.checklist ?? DEFAULT_STEPS;
  const done = steps.filter((s) => s.done).length;
  const showChecklist = !o || o.flags.canSetUp || done < steps.length;
  // the server's health details are for people who administer the organization; nobody else sees this card
  const showServerStatus = o?.flags.canSeeServerStatus === true;
  const emptyOrg = o !== undefined && o.checklist.every((c) => !c.done);
  return (
    <>
      <PageHeader title={nav.label} description={nav.description} eyebrow="Workspace" />
      <Stagger className="grid gap-6 lg:grid-cols-3">
        {q.isPending && (
          <StaggerItem className="lg:col-span-3">
            <div aria-hidden="true" className="grid gap-3 sm:grid-cols-4">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          </StaggerItem>
        )}
        {q.isError && (
          <StaggerItem className="lg:col-span-3">
            <p role="alert" className="rounded-lg border border-off-track/30 bg-off-track-soft px-3 py-2.5 text-label text-off-track-ink">
              Your numbers could not be loaded. The steps below show nothing as done until they can.{" "}
              <button type="button" className="font-medium underline" onClick={() => void q.refetch()}>Reload my numbers</button>
            </p>
          </StaggerItem>
        )}
        {o && emptyOrg && o.flags.canManageDemo && !o.flags.demoLoaded && (
          <StaggerItem className="lg:col-span-3">
            <Card lift={false}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div className="flex items-start gap-3">
                  <FlaskConical aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary-ink" />
                  <div>
                    <p className="text-body font-semibold">See Zentro with a whole company in it</p>
                    <p className="text-label text-muted-foreground">Load demo data: about 60 fictional people, teams and tasks, marked “Demo data” and removable in one click.</p>
                  </div>
                </div>
                <Button asChild size="sm"><Link to="/settings/demo">Load demo data</Link></Button>
              </CardContent>
            </Card>
          </StaggerItem>
        )}
        {o && (
          <>
            <StaggerItem className={o.team ? "" : "lg:col-span-2"}><YourWork o={o} /></StaggerItem>
            {o.team && <StaggerItem className="lg:col-span-2"><TeamCard t={o.team} /></StaggerItem>}
            {o.objectives && <StaggerItem className="lg:col-span-3"><ObjectivesCard o={o.objectives} unaligned={o.personal.unalignedOpen} /></StaggerItem>}
            {o.kpis && o.kpis.totals.series > 0 && <StaggerItem className="lg:col-span-3"><KpiCard k={o.kpis} /></StaggerItem>}
            {o.organization && <OrganizationCards org={o.organization} />}
          </>
        )}
        {showChecklist && (
        <StaggerItem className={showServerStatus ? "lg:col-span-2" : "lg:col-span-3"}>
          <Card className="h-full">
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div className="space-y-3">
                <Metric label="Setup progress" value={done} suffix={` of ${steps.length}`} />
                <CardTitle>Getting started</CardTitle>
                <CardDescription>
                  {o ? "These steps tick off by themselves when real data exists." : "Nothing is shown as done until your numbers load."}
                </CardDescription>
              </div>
              <ProgressRing value={done} max={steps.length} label="Getting started steps done" size={88}>
                <span className="text-heading font-bold leading-none">
                  <CountUp value={Math.round((done / steps.length) * 100)} suffix="%" className="text-gradient" />
                </span>
                <span className="mt-0.5 text-caption text-muted-foreground">done</span>
              </ProgressRing>
            </CardHeader>
            <CardContent>
              <ol className="divide-y">
                {steps.map((s, i) => (
                  <li key={s.key}>
                    <Link
                      to={s.to}
                      className="group flex items-center gap-3 rounded-md py-3 text-label font-medium transition-colors duration-[var(--duration-fast)] hover:text-primary-ink"
                    >
                      {s.done ? (
                        <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-on-track-soft text-on-track-ink"><Check className="size-3.5" /></span>
                      ) : (
                        <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed text-caption text-muted-foreground tabular-nums">{i + 1}</span>
                      )}
                      <span className="sr-only">{s.done ? "Done: " : "Not started: "}</span>
                      <span className={cn("flex-1", s.done && "text-muted-foreground line-through")}>{s.label}</span>
                      {s.stage && !s.done && <Badge variant="outline">Stage {s.stage}</Badge>}
                      <ArrowRight aria-hidden="true" className="size-4 text-muted-foreground transition-transform duration-[var(--duration-fast)] motion-safe:group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </StaggerItem>
        )}
        {showServerStatus && (
        <StaggerItem className={showChecklist ? "" : "lg:col-span-3"}>
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
        )}
      </Stagger>
    </>
  );
}
