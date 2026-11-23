import { roundHalfUp1 } from "./math.js";

/** Smallest cohort that gets a rank and a percentile, and the smallest that also gets a z-score (docs/scoring-architecture.md 8.1). */
export const MIN_RANKED = 3;
export const MIN_Z = 8;

export interface Ranked { id: string; total: number }
export interface Position { id: string; total: number; rank: number; of: number; percentile: number | null; zScore: number | null }
export type Normalization = "raw" | "percentile" | "percentile_z";

/**
 * Where each person stands among the cohort (PURE: only numbers in, numbers out).
 * - rank: 1 = highest; people with the same total share a rank (1, 2, 2, 4).
 * - percentile: mid-rank, (people below + half the people level with you, yourself included) / N × 100, one decimal.
 *   Needs at least 3 people; with fewer there is no ranking, only the raw numbers.
 * - z-score: (score − mean) / population standard deviation, two decimals; needs at least 8 people; 0 when everyone is level.
 */
export function positions(cohort: readonly Ranked[]): { normalization: Normalization; positions: Position[] } {
  const n = cohort.length;
  const totals = cohort.map((c) => c.total);
  const mean = n > 0 ? totals.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n > 0 ? Math.sqrt(totals.reduce((a, b) => a + (b - mean) ** 2, 0) / n) : 0;
  const normalization: Normalization = n >= MIN_Z ? "percentile_z" : n >= MIN_RANKED ? "percentile" : "raw";
  const out = cohort.map((c): Position => {
    const higher = totals.filter((t) => t > c.total).length;
    const below = totals.filter((t) => t < c.total).length;
    const level = totals.filter((t) => t === c.total).length;
    return {
      id: c.id, total: c.total, rank: higher + 1, of: n,
      percentile: n >= MIN_RANKED ? roundHalfUp1(((below + level / 2) / n) * 100) : null,
      zScore: n >= MIN_Z ? (sd === 0 ? 0 : Math.round(((c.total - mean) / sd) * 100) / 100) : null,
    };
  });
  return { normalization, positions: out.sort((a, b) => a.rank - b.rank) };
}

export interface PartPoints { key: string; label: string; score: number | null; points: number | null }
export interface DifferencePart { key: string; label: string; a: number | null; b: number | null; contribution: number; note: string | null }

/**
 * Why A and B differ, part by part. Each part's contribution is A's points minus B's points (a part with no data has no points),
 * so the contributions add up to the difference between the two totals before rounding. Sorted by the size of the contribution.
 */
export function explainDifference(a: readonly PartPoints[], b: readonly PartPoints[]): DifferencePart[] {
  const keys = [...new Map([...a, ...b].map((p) => [p.key, p.label])).entries()];
  return keys
    .map(([key, label]): DifferencePart => {
      const x = a.find((p) => p.key === key);
      const y = b.find((p) => p.key === key);
      const note = !x || !y ? "Not part of both models" : x.points === null && y.points === null ? "No data for either person" : x.points === null ? "No data for the first person, so this part adds nothing for them" : y.points === null ? "No data for the second person, so this part adds nothing for them" : null;
      return { key, label, a: x?.score ?? null, b: y?.score ?? null, contribution: roundHalfUp1((x?.points ?? 0) - (y?.points ?? 0)), note };
    })
    .sort((p, q) => Math.abs(q.contribution) - Math.abs(p.contribution) || p.key.localeCompare(q.key));
}
