import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ScrollText } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { PageHeader } from "@/components/common/PageHeader";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateTime } from "@/lib/format";
import { listAudit, type AuditEntry } from "@/services/auth";

const ACTIONS: [string, string][] = [
  ["organization.create", "Organization created"],
  ["invitation.create", "Invitation created"],
  ["invitation.regenerate", "Invitation link renewed"],
  ["invitation.revoke", "Invitation revoked"],
  ["invitation.accept", "Invitation accepted"],
  ["password_reset_link.create", "Password reset link generated"],
  ["role.create", "Role created"],
  ["role.update", "Role renamed or described"],
  ["role.permissions.update", "Role permissions changed"],
  ["role.archive", "Role archived"],
  ["role_assignment.create", "Role given to a person"],
  ["role_assignment.revoke", "Role taken away"],
  ["person.remove", "Person removed"],
  ["person.leave", "Person left (deleted their account)"],
];
const LABEL = Object.fromEntries(ACTIONS);

/** Turns the stored before/after JSON into short readable lines. */
function details(e: AuditEntry): string[] {
  const lines: string[] = [];
  const show = (title: string, v: unknown) => {
    if (v === null || v === undefined) return;
    if (typeof v !== "object") return void lines.push(`${title}: ${String(v)}`);
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const text = Array.isArray(val) ? (val.length ? val.join(", ") : "none") : val === null ? "none" : String(val);
      lines.push(`${title} ${k}: ${text}`);
    }
  };
  show("Before", e.before);
  show("After", e.after);
  return lines;
}

/** Settings → Audit: who changed what and when, newest first. Read only; kept forever; no IP addresses. */
export default function AuditPage() {
  const auth = useAuth();
  const tz = auth.me?.organization?.timezone ?? "UTC";
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const q = useInfiniteQuery({
    queryKey: ["audit", action, from, to],
    queryFn: ({ pageParam }) =>
      listAudit({
        ...(action ? { action } : {}),
        ...(from ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}),
        ...(to ? { to: new Date(`${to}T23:59:59`).toISOString() } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
        limit: 25,
      }),
    initialPageParam: "" as string,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
  const entries = q.data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <>
      <PageHeader eyebrow="Settings" title="Audit log" description="Every change to roles, assignments, invitations and people, newest first. Read only and kept forever." />
      <Card lift={false} className="mb-6">
        <CardContent className="grid gap-4 pt-5 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="audit-action" className="text-label font-medium">
              What happened
            </label>
            <select id="audit-action" value={action} onChange={(e) => setAction(e.target.value)} className="h-10 w-full rounded-lg border border-input bg-card px-3 text-body text-foreground shadow-xs">
              <option value="">Everything</option>
              {ACTIONS.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="audit-from" className="text-label font-medium">
              From
            </label>
            <input id="audit-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 w-full rounded-lg border border-input bg-card px-3 text-body text-foreground shadow-xs" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="audit-to" className="text-label font-medium">
              To
            </label>
            <input id="audit-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 w-full rounded-lg border border-input bg-card px-3 text-body text-foreground shadow-xs" />
          </div>
        </CardContent>
      </Card>

      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState illustration="settings" title="Nothing recorded for this filter">
          <p>Changes appear here as people create invitations, edit roles and give or take away roles.</p>
        </EmptyState>
      ) : (
        <>
          <ul aria-label="Audit log" className="divide-y divide-border rounded-xl border bg-card">
            {entries.map((e) => {
              const lines = details(e);
              const expanded = open === e.id;
              return (
                <li key={e.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 basis-64">
                      <p className="text-body font-medium">{e.summary}</p>
                      <p className="mt-0.5 text-caption text-muted-foreground">
                        {e.actor.name ?? "Unknown"} · {formatDateTime(e.createdAt, tz)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{LABEL[e.action] ?? e.action}</Badge>
                      {lines.length > 0 && (
                        <Button variant="ghost" size="sm" aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} details: ${e.summary}`} onClick={() => setOpen(expanded ? null : e.id)}>
                          {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />} Details
                        </Button>
                      )}
                    </div>
                  </div>
                  {expanded && (
                    <ul className="mt-2 space-y-0.5 rounded-lg bg-muted/50 px-3 py-2 font-mono text-caption">
                      {lines.map((l, i) => (
                        <li key={i} className="break-words">
                          {l}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex items-center gap-3">
            {q.hasNextPage ? (
              <Button variant="outline" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
                <ScrollText aria-hidden="true" /> {q.isFetchingNextPage ? "Loading…" : "Load older entries"}
              </Button>
            ) : (
              <p className="text-caption text-muted-foreground">That is everything.</p>
            )}
          </div>
        </>
      )}
    </>
  );
}
