import type { KpiDetail } from "@/services/kpi";

/** Measurements and the trend arrive with stage 3.4. */
export function MeasurementsSection({ k }: { k: KpiDetail }) {
  return <section aria-label="Measurements" className="sr-only">Measurements of {k.name}</section>;
}
