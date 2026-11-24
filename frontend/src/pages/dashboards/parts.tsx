import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

/** Marks a page that is a first, read-only version, with one line on what comes later. */
export function EarlyVersion({ children }: { children: ReactNode }) {
  return (
    <p className="mb-5 flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
      <Badge variant="outline">Early version</Badge>
      <span>{children}</span>
    </p>
  );
}

const STATUS_WORD: Record<string, string> = { critical: "Critical", warning: "Warning", ok: "OK", excellent: "Excellent", no_data: "No data" };
/** KPI status counts in words, e.g. "2 critical, 1 warning". */
export const statusCounts = (by: Record<string, number>): string => {
  const parts = Object.entries(by).filter(([, n]) => n > 0).sort(([a], [b]) => (a === "critical" ? -1 : b === "critical" ? 1 : a === "warning" ? -1 : b === "warning" ? 1 : 0)).map(([k, n]) => `${n} ${(STATUS_WORD[k] ?? k).toLowerCase()}`);
  return parts.length ? parts.join(", ") : "no values yet";
};
export const pct = (n: number | null): string => (n === null ? "No data yet" : `${n}%`);

/**
 * A tiny trend line. A missing value is a GAP (the line breaks), never a zero. The values are also written out in words for screen
 * readers and for anyone who wants the numbers ("view as table" is the text beside it).
 */
export function Sparkline({ points, label, unit = "" }: { points: { date: string; value: number | null }[]; label: string; unit?: string }) {
  const vals = points.map((p) => p.value).filter((v): v is number => v !== null);
  const text = points.map((p) => `${p.date}: ${p.value === null ? "no data" : `${p.value}${unit}`}`).join("; ");
  if (vals.length === 0) return <span className="text-caption text-muted-foreground">No data in this range</span>;
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const x = (i: number) => (points.length === 1 ? 50 : (i / (points.length - 1)) * 100);
  const y = (v: number) => 18 - ((v - lo) / span) * 16;
  const runs: string[] = [];
  let cur: string[] = [];
  points.forEach((p, i) => { if (p.value === null) { if (cur.length) runs.push(cur.join(" ")); cur = []; } else cur.push(`${x(i).toFixed(1)},${y(p.value).toFixed(1)}`); });
  if (cur.length) runs.push(cur.join(" "));
  return (
    <span className="inline-flex items-center gap-2">
      <svg role="img" aria-label={`${label}. ${text}`} viewBox="0 0 100 20" className="h-6 w-24 text-primary" preserveAspectRatio="none">
        {runs.map((r, i) => (r.includes(" ") ? <polyline key={i} points={r} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" /> : <circle key={i} cx={r.split(",")[0]} cy={r.split(",")[1]} r="2" fill="currentColor" />))}
      </svg>
      <span className="text-caption tabular-nums text-muted-foreground">{points.map((p) => (p.value === null ? "–" : `${p.value}${unit}`)).join(" → ")}</span>
    </span>
  );
}
export const delta = (n: number | null, unit = " points"): string => (n === null ? "no comparison" : n === 0 ? "no change" : `${n > 0 ? "+" : "−"}${Math.abs(n)}${unit}`);

/**
 * A waterfall of how a company objective's progress is made up: each linked department or team objective adds the points the server already
 * worked out (its share of the parent × its own progress), stacked from the left, and the last bar is the objective's own progress. Nothing
 * is calculated here beyond placing the bars: an objective with no data adds nothing and says "no data" (it is never drawn as zero), and the
 * text beside every bar carries the same numbers for anyone who cannot see the chart.
 */
export function Waterfall({ title, contributors, total }: { title: string; contributors: { id: string; label: string; points: number | null }[]; total: number | null }) {
  const rows: { id: string; label: string; start: number; width: number; points: number | null }[] = [];
  let running = 0;
  for (const c of contributors) {
    const width = c.points ?? 0;
    rows.push({ id: c.id, label: c.label, start: running, width, points: c.points });
    running += width;
  }
  const clamp = (n: number): number => Math.max(0, Math.min(100, n));
  return (
    <figure aria-label={`How the progress of ${title} is made up`} className="space-y-1">
      <figcaption className="text-caption text-muted-foreground">Each bar adds the points one linked objective contributes; the last bar is this objective's own progress. Scale: 0 to 100%.</figcaption>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-caption">
            <span className="truncate">{r.label}</span>
            <span className="relative h-3 rounded bg-muted" aria-hidden="true">{r.points !== null && <span className="absolute top-0 h-3 rounded bg-primary/70" style={{ left: `${clamp(r.start)}%`, width: `${clamp(r.width)}%` }} />}</span>
            <span className="tabular-nums text-muted-foreground">{r.points === null ? "no data" : `+${r.points} points`}</span>
          </li>
        ))}
        <li className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 border-t pt-1 text-caption font-medium">
          <span>This objective</span>
          <span className="relative h-3 rounded bg-muted" aria-hidden="true">{total !== null && <span className="absolute left-0 top-0 h-3 rounded bg-on-track" style={{ width: `${clamp(total)}%` }} />}</span>
          <span className="tabular-nums">{total === null ? "no data" : `${total}%`}</span>
        </li>
      </ul>
    </figure>
  );
}
