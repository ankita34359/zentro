import { aggregate, kpiAttainment } from "../../../kpi/measure.js";
import { clamp, num } from "../math.js";
import type { Contributor, KpiInput, ProviderResult } from "../types.js";

/**
 * KPI achievement (docs/scoring-architecture.md 3.2). For each assignment: the period's current values are aggregated the way the
 * KPI says (sum, average, latest, lowest, highest); a KPI that is SUMMED over several periods is compared with its per-period target
 * times the number of periods expected. Coverage is the share of expected periods with a value; below the minimum the KPI is shown
 * but left out. The component is the weighted mean of the assignments that are ok. No value at all is "missing", never zero.
 */
export function kpiProvider(set: readonly KpiInput[], config: Record<string, unknown>, minSample: number): ProviderResult {
  const categories = Array.isArray(config.categories) ? (config.categories as string[]) : null;
  const minCoverage = num(config, "minMeasurementCoverage", 0.5);
  const cap = num(config, "cap", 1);
  const items = set.filter((k) => !categories || categories.includes(k.category));
  const notes: string[] = [];
  const contributors: Contributor[] = [];
  let weighted = 0;
  let weightOk = 0;
  let weightAll = 0;
  let okCount = 0;
  let sample = 0;
  let anyData = 0;
  for (const k of items) {
    weightAll += k.weight;
    const expected = Math.max(k.expectedPeriods, 0);
    const present = k.values.length;
    if (present === 0) {
      notes.push(`"${k.name}" has no recorded value${expected > 0 ? ` (${expected} expected)` : ""}`);
      continue;
    }
    anyData += 1;
    const cov = expected === 0 ? 1 : Math.min(1, present / expected);
    if (cov < minCoverage) {
      notes.push(`"${k.name}" has ${present} of ${expected} expected measurements, below the ${Math.round(minCoverage * 100)}% needed, so it is shown but left out`);
      continue;
    }
    if (present < expected) notes.push(`"${k.name}" has ${present} of ${expected} expected measurements`);
    const v = aggregate(k.values.map((x) => x.value), k.aggregation);
    const scale = k.aggregation === "sum" && expected > 0 ? expected : 1;
    const a = kpiAttainment(k.direction, v, k.target * scale, k.targetMax === null ? null : k.targetMax * scale, cap);
    if (a === null) {
      notes.push(`"${k.name}" cannot be measured against its target`);
      continue;
    }
    okCount += 1;
    sample += present;
    weighted += k.weight * a;
    weightOk += k.weight;
    contributors.push({ ref: { type: "kpi", id: k.kpiId }, label: k.name, value: a, target: k.target * scale, weight: k.weight, note: `${v === null ? "" : Math.round(v * 100) / 100}${k.unit ? ` ${k.unit}` : ""} against ${Math.round(k.target * scale * 100) / 100}${k.unit ? ` ${k.unit}` : ""} (${k.aggregation})` });
  }
  if (items.length === 0) return { value: null, state: "missing", sampleSize: 0, coverage: 0, evidenceShare: 0, contributors: [], notes: ["No KPI is assigned for this period"] };
  if (okCount === 0) return { value: null, state: anyData > 0 ? "insufficient" : "missing", sampleSize: sample, coverage: 0, evidenceShare: 0, contributors, notes };
  const state = okCount >= minSample ? "ok" : "insufficient";
  if (state === "insufficient") notes.push(`Not enough data (${okCount} of ${minSample} KPIs needed)`);
  return { value: clamp((weighted / weightOk) * 100, 0, 100), state, sampleSize: sample, coverage: weightAll > 0 ? weightOk / weightAll : 0, evidenceShare: 0, contributors, notes };
}
