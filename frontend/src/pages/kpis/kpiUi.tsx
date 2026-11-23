import { Badge } from "@/components/ui/badge";
import { AGGREGATION_LABEL, CATEGORY_LABEL, DIRECTION_LABEL, FREQUENCY_LABEL, type KpiView } from "@/services/kpi";

/** "Monthly · Higher is better · target 40 leads", in words. */
export function kpiSentence(k: Pick<KpiView, "frequency" | "direction" | "defaultTarget" | "defaultTargetMax" | "unit">): string {
  const target = k.defaultTarget === null ? "no default target" : k.direction === "target_range" ? `range ${k.defaultTarget} to ${k.defaultTargetMax}${k.unit ? ` ${k.unit}` : ""}` : `target ${k.defaultTarget}${k.unit ? ` ${k.unit}` : ""}`;
  return `${FREQUENCY_LABEL[k.frequency]} · ${DIRECTION_LABEL[k.direction]} · ${target}`;
}
export const CategoryBadge = ({ category }: { category: string }) => <Badge variant="neutral">{CATEGORY_LABEL[category] ?? category}</Badge>;
export const aggregationText = (a: string): string => AGGREGATION_LABEL[a] ?? a;
