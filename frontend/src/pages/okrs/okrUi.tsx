import { Badge } from "@/components/ui/badge";
import { ProgressBar, type Tone } from "@/motion/ProgressBar";
import { HEALTH_LABEL, LEVEL_LABEL, LIFECYCLE_LABEL, pctText, type Health, type ObjectiveSummary } from "@/services/okr";

const LIFECYCLE_VARIANT: Record<string, "neutral" | "info" | "onTrack" | "dashed"> = { draft: "dashed", active: "info", completed: "onTrack", cancelled: "dashed" };

export const LifecycleBadge = ({ lifecycle }: { lifecycle: string }) => <Badge variant={LIFECYCLE_VARIANT[lifecycle] ?? "neutral"}>{LIFECYCLE_LABEL[lifecycle] ?? lifecycle}</Badge>;

/** Where an objective belongs, in words: "Team · Platform", "Personal · Ann". */
export function whereText(o: Pick<ObjectiveSummary, "level" | "team" | "department" | "owner">): string {
  const place = o.level === "team" ? o.team?.name : o.level === "department" ? o.department?.name : o.level === "individual" ? o.owner?.name : undefined;
  return place ? `${LEVEL_LABEL[o.level]} · ${place}` : (LEVEL_LABEL[o.level] ?? o.level);
}

/**
 * The attainment bar. A missing number is words ("No data yet"), never an empty bar passed off as 0%, and "Based on part of
 * the key results" says so when less than half of the weight has data. The pace line (how much time has passed) is plain
 * information, not a judgement: health arrives with stage 3.2.
 */
export function Attainment({ pct, dataState, coveragePct, elapsedPct, label, compact }: { pct: number | null; dataState?: string; coveragePct?: number; elapsedPct?: number; label: string; compact?: boolean }) {
  const tone: Tone = pct === null ? "info" : "primary";
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className={pct === null ? "text-label text-muted-foreground" : "text-body font-semibold tabular-nums"}>{pctText(pct)}</span>
        {!compact && elapsedPct !== undefined && <span className="text-caption text-muted-foreground">{elapsedPct}% of the time has passed</span>}
      </div>
      {pct !== null ? <ProgressBar value={pct} max={100} label={label} tone={tone} /> : <div className="h-2 rounded-full border border-dashed" aria-hidden="true" />}
      {dataState === "insufficient" && <p className="text-caption text-at-risk-ink">Based on part of the key results ({coveragePct}% of the weight has a value).</p>}
    </div>
  );
}

const HEALTH_VARIANT: Record<string, "neutral" | "info" | "onTrack" | "atRisk" | "offTrack" | "dashed"> = { not_started: "neutral", on_track: "onTrack", at_risk: "atRisk", delayed: "offTrack", completed: "onTrack", no_data: "dashed" };

/** Health in words, never colour alone (the label is the meaning; the colour only repeats it). */
export function HealthBadge({ health }: { health: Health | null }) {
  if (health === null) return null;
  return <Badge variant={HEALTH_VARIANT[health] ?? "neutral"}>{HEALTH_LABEL[health] ?? health}</Badge>;
}
