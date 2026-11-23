/**
 * The attainment math for key results and objectives (docs/scoring-architecture.md section 3.1). Pure functions: no
 * database, no clock. A result comes from stored values only, so the same inputs always give the same number, and the
 * scorecards later reuse this exact file.
 *
 *   increase   a = (current − start) / (target − start)
 *   decrease   a = (start − current) / (start − target)
 *   boolean    a = current (0 or 1)
 *   manual     a = current / 100 (the owner records a percentage)
 * then a = clamp(a, 0, cap), cap defaulting to 1 (no credit above 100%).
 * A key result with no recorded value has NO DATA: it is left out, never counted as zero.
 */
export type Direction = "increase" | "decrease";
export type ProgressMethod = "linear" | "binary" | "manual";

export interface KeyResultInput {
  direction: Direction;
  method: ProgressMethod;
  start: number;
  target: number;
  /** null = nothing has been recorded yet. */
  current: number | null;
  weight: number;
}

export interface KeyResultAttainment {
  /** 0 to `cap`, or null when there is no data. */
  value: number | null;
  /** The raw value went below 0 (a regression) and was floored. */
  regressed: boolean;
  /** The target equals the start: the key result cannot be measured as a ratio (a data-quality note). */
  degenerate: boolean;
  /** The raw value went above the cap and was capped. */
  capped: boolean;
}

export function keyResultAttainment(kr: KeyResultInput, cap = 1): KeyResultAttainment {
  if (kr.current === null) return { value: null, regressed: false, degenerate: false, capped: false };
  let raw: number;
  let degenerate = false;
  if (kr.method === "binary") raw = kr.current >= 1 ? 1 : 0;
  else if (kr.method === "manual") raw = kr.current / 100;
  else if (kr.target === kr.start) {
    degenerate = true;
    raw = kr.direction === "increase" ? (kr.current >= kr.target ? 1 : 0) : kr.current <= kr.target ? 1 : 0;
  } else if (kr.direction === "increase") raw = (kr.current - kr.start) / (kr.target - kr.start);
  else raw = (kr.start - kr.current) / (kr.start - kr.target);
  const regressed = raw < 0;
  const capped = raw > cap;
  return { value: Math.min(Math.max(raw, 0), cap), regressed, degenerate, capped };
}

export type DataState = "ok" | "insufficient" | "none";

export interface ObjectiveAttainment {
  /** The weighted mean over key results that have data, or null when none has. */
  value: number | null;
  dataState: DataState;
  /** Share (0 to 1) of the total key-result weight that has data. */
  coverage: number;
  withData: number;
  total: number;
}

/** `minCoverage` (default 0.5): below it the number is shown but marked "insufficient". */
export function objectiveAttainment(krs: readonly { attainment: number | null; weight: number }[], minCoverage = 0.5): ObjectiveAttainment {
  const total = krs.length;
  const totalWeight = krs.reduce((n, k) => n + k.weight, 0);
  const measured = krs.filter((k) => k.attainment !== null);
  const measuredWeight = measured.reduce((n, k) => n + k.weight, 0);
  if (measured.length === 0 || measuredWeight <= 0) return { value: null, dataState: "none", coverage: 0, withData: 0, total };
  const value = measured.reduce((n, k) => n + k.weight * (k.attainment as number), 0) / measuredWeight;
  const coverage = totalWeight > 0 ? measuredWeight / totalWeight : 0;
  return { value, dataState: coverage >= minCoverage ? "ok" : "insufficient", coverage, withData: measured.length, total };
}

/** Whole-number percentage for display: rounded once, at the end. */
export const toPercent = (a: number | null): number | null => (a === null ? null : Math.round(a * 100));
