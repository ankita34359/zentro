import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/common/ErrorState";
import { PageHeader } from "@/components/common/PageHeader";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSystem } from "@/services/system";

const bytes = (n: number): string => (n < 1024 ? `${n} bytes` : n < 1_048_576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1_048_576).toFixed(1)} MB`);
const when = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString() : "never");
const STATUS: Record<string, { label: string; variant: "onTrack" | "atRisk" | "offTrack" | "dashed" }> = {
  ok: { label: "Worked", variant: "onTrack" }, partial: { label: "Partly worked", variant: "atRisk" }, failed: { label: "Failed", variant: "offTrack" }, running: { label: "Running", variant: "dashed" },
};
const JOB_LABEL: Record<string, string> = { "platform.backup": "Daily backup", "platform.housekeeping": "Housekeeping", "tasks.reminders": "Task reminders", "okr.health": "Objective health", "kpi.thresholds": "KPI thresholds", "scores.recalculate": "Score recalculation" };

/** Settings → System (administrators): the app's version, database size, backups and background jobs, in plain words. */
export default function SystemPage() {
  const q = useQuery({ queryKey: ["system"], queryFn: getSystem, retry: false });
  const s = q.data;
  return (
    <>
      <PageHeader eyebrow="System" title="System" description="How the app and its backups are doing. Only administrators see this page." />
      {q.isPending ? <PageSkeleton /> : q.isError || !s ? <ErrorState title="The System page could not be loaded" error={q.error} onRetry={() => void q.refetch()} /> : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Backups</CardTitle><CardDescription>{s.backups.location}</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <p role="note" className="rounded-lg border border-at-risk/40 bg-at-risk-soft p-3 text-label">{s.backups.warning}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-label">
                <dt className="text-muted-foreground">Last backup run</dt>
                <dd>{s.backups.lastRun ? <><span>{when(s.backups.lastRun.finishedAt ?? s.backups.lastRun.startedAt)}</span>{" "}<Badge variant={STATUS[s.backups.lastRun.status]?.variant ?? "dashed"}>{STATUS[s.backups.lastRun.status]?.label ?? s.backups.lastRun.status}</Badge>{s.backups.lastRun.error && <span className="ml-2 text-off-track-ink">{s.backups.lastRun.error}</span>}</> : "No backup has run yet. The first one is made by the next background run."}</dd>
                <dt className="text-muted-foreground">Copies kept</dt>
                <dd>{s.backups.count} in total: {s.backups.daily.count} daily (the newest {s.backups.daily.keep} are kept) and {s.backups.preMigration.count} made before updates</dd>
                <dt className="text-muted-foreground">Newest copy</dt>
                <dd>{s.backups.newest ? `${s.backups.newest.name} (${bytes(s.backups.newest.sizeBytes)}, ${when(s.backups.newest.at)})` : "none yet"}</dd>
              </dl>
              {s.backups.files.length > 0 && (
                <div>
                  <p className="text-label font-medium">Copies by name</p>
                  <ul aria-label="Backup copies" className="mt-1 space-y-1 text-caption text-muted-foreground">
                    {s.backups.files.map((f) => <li key={f.name} className="break-all"><span className="text-foreground">{f.name}</span> · {f.kind === "daily" ? "daily" : "before an update"} · {bytes(f.sizeBytes)}</li>)}
                  </ul>
                  <p className="mt-2 text-caption text-muted-foreground">To put one back, follow <span className="font-medium">docs/RECOVERY.md</span> in the project: it uses one of these names. They cannot be downloaded from the website.</p>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>App and database</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-label">
                <dt className="text-muted-foreground">App version</dt><dd>{s.version}</dd>
                <dt className="text-muted-foreground">Database updates applied</dt><dd>{s.migrations.applied} of {s.migrations.total}</dd>
                <dt className="text-muted-foreground">Database size</dt><dd>{bytes(s.database.sizeBytes)}</dd>
                <dt className="text-muted-foreground">Last background run</dt><dd>{s.lastTick ? `${when(s.lastTick.finishedAt ?? s.lastTick.startedAt)} (${STATUS[s.lastTick.status]?.label ?? s.lastTick.status})` : "none yet"}</dd>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Background jobs</CardTitle><CardDescription>Each job's most recent run.</CardDescription></CardHeader>
            <CardContent>
              {s.jobs.length === 0 ? <p className="text-label text-muted-foreground">No job has run yet.</p> : (
                <ul aria-label="Background jobs" className="space-y-2 text-label">
                  {s.jobs.map((j) => (
                    <li key={j.name} className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{JOB_LABEL[j.name] ?? j.name}</span>
                      <Badge variant={STATUS[j.status]?.variant ?? "dashed"}>{STATUS[j.status]?.label ?? j.status}</Badge>
                      <span className="text-caption text-muted-foreground">{when(j.finishedAt ?? j.startedAt)}</span>
                      {j.error && <span className="text-caption text-off-track-ink">{j.error}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
