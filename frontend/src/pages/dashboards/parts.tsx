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
