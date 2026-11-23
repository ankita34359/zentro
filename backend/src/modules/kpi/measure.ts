/**
 * KPI maths (docs/scoring-architecture.md section 3.2): pure functions of stored values. No data is `null`, never zero.
 */
export type KpiDirection = "higher_is_better" | "lower_is_better" | "target_range";
export type Aggregation = "sum" | "avg" | "last" | "min" | "max";

/** Several current values in a window become one. Empty = no data (null). `values` is oldest first (for "last"). */
export function aggregate(values: readonly number[], how: Aggregation): number | null {
  if (values.length === 0) return null;
  switch (how) {
    case "sum": return values.reduce((a, b) => a + b, 0);
    case "avg": return values.reduce((a, b) => a + b, 0) / values.length;
    case "last": return values[values.length - 1]!;
    case "min": return Math.min(...values);
    case "max": return Math.max(...values);
  }
}

/**
 * Attainment 0 to `cap` of a value against a target:
 *   higher is better  min(v / T, cap)            (T > 0)
 *   lower is better   v = 0 ? cap : min(T / v, cap)
 *   target range      inside T..Tmax → 1; outside → max(0, 1 − distance / (Tmax − T))
 * A negative value is floored at 0. `null` when the value or the target is missing, or the target cannot be used (T ≤ 0 for the ratios).
 */
export function kpiAttainment(direction: KpiDirection, value: number | null, target: number | null, targetMax: number | null, cap = 1): number | null {
  if (value === null || target === null) return null;
  if (direction === "target_range") {
    if (targetMax === null || targetMax <= target) return null;
    if (value >= target && value <= targetMax) return 1;
    const distance = value < target ? target - value : value - targetMax;
    return Math.max(0, 1 - distance / (targetMax - target));
  }
  if (target <= 0) return null;
  if (direction === "higher_is_better") return Math.min(Math.max(value / target, 0), cap);
  return value <= 0 ? cap : Math.min(target / value, cap);
}

export type Level = "excellent" | "warning" | "critical";
export type SeriesStatus = "no_data" | "excellent" | "ok" | Exclude<Level, "excellent">;
export interface Threshold { level: Level; comparator: "lt" | "lte" | "gt" | "gte"; basis: "absolute" | "percent_of_target"; value: number }

const compare = (c: Threshold["comparator"], a: number, b: number): boolean => (c === "lt" ? a < b : c === "lte" ? a <= b : c === "gt" ? a > b : a >= b);

/**
 * Which level a value reaches, checking critical first, then warning, then excellent. A threshold measured as a percentage of
 * the target is skipped when there is no usable target (it cannot be evaluated; it is never guessed). `null` = no threshold matched.
 */
export function levelOf(value: number | null, target: number | null, thresholds: readonly Threshold[]): Level | null {
  if (value === null) return null;
  for (const level of ["critical", "warning", "excellent"] as const) {
    for (const t of thresholds) {
      if (t.level !== level) continue;
      let v = value;
      if (t.basis === "percent_of_target") {
        if (target === null || target <= 0) continue;
        v = (value / target) * 100;
      }
      if (compare(t.comparator, v, t.value)) return level;
    }
  }
  return null;
}
export const statusOf = (value: number | null, target: number | null, thresholds: readonly Threshold[]): SeriesStatus => (value === null ? "no_data" : (levelOf(value, target, thresholds) ?? "ok"));

/** Share (0 to 1) of the expected periods that have a value. No expected periods: null (nothing to compare with). */
export const coverage = (present: number, expected: number): number | null => (expected === 0 ? null : Math.min(1, present / expected));
