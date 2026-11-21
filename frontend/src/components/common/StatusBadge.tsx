import { CheckCircle2, CircleAlert, CircleDashed, Info, TrendingDown, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * The four fixed status meanings, used the same way on every screen: emerald = on track, amber = at risk,
 * rose = off track, sky = info (plus a neutral "no data"). Always an icon AND words, never colour alone.
 */
export type Status = "on-track" | "at-risk" | "off-track" | "info" | "no-data";

const STATUS: Record<Status, { label: string; icon: LucideIcon; variant: "onTrack" | "atRisk" | "offTrack" | "info" | "dashed" }> = {
  "on-track": { label: "On track", icon: CheckCircle2, variant: "onTrack" },
  "at-risk": { label: "At risk", icon: CircleAlert, variant: "atRisk" },
  "off-track": { label: "Off track", icon: TrendingDown, variant: "offTrack" },
  info: { label: "Info", icon: Info, variant: "info" },
  "no-data": { label: "No data", icon: CircleDashed, variant: "dashed" },
};

export function StatusBadge({ status, label }: { status: Status; label?: string }) {
  const s = STATUS[status];
  return (
    <Badge variant={s.variant}>
      <s.icon aria-hidden="true" /> {label ?? s.label}
    </Badge>
  );
}
