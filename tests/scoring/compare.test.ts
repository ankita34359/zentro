import { describe, expect, it } from "vitest";
import { explainDifference, positions } from "../../backend/src/modules/scoring/engine/compare.js";

const cohort = (...totals: number[]) => totals.map((total, i) => ({ id: `p${i + 1}`, total }));
const by = (r: ReturnType<typeof positions>, id: string) => r.positions.find((p) => p.id === id)!;

describe("cohort positions (docs/scoring-architecture.md 8.1) — golden vectors", () => {
  it("fewer than 3 people: no rank, no percentile, only the raw numbers ('too few peers to rank')", () => {
    const r = positions(cohort(70, 80));
    expect(r.normalization).toBe("raw");
    expect(r.positions.map((p) => [p.id, p.rank, p.percentile, p.zScore])).toEqual([["p2", 1, null, null], ["p1", 2, null, null]]);
    expect(positions([]).positions).toEqual([]);
  });

  it("3 people: rank and mid-rank percentile: (below + half of those level) / N", () => {
    const r = positions(cohort(70, 80, 90));
    expect(r.normalization).toBe("percentile");
    expect(r.positions.map((p) => [p.id, p.rank, p.percentile, p.zScore])).toEqual([["p3", 1, 83.3, null], ["p2", 2, 50, null], ["p1", 3, 16.7, null]]);
  });

  it("ties share a rank and a percentile: 90, 80, 80, 70 → ranks 1, 2, 2, 4; the two level people sit at (1 + 1) / 4 = 50 %", () => {
    const r = positions(cohort(90, 80, 80, 70));
    expect(r.positions.map((p) => [p.rank, p.percentile])).toEqual([[1, 87.5], [2, 50], [2, 50], [4, 12.5]]);
  });

  it("8 people: a z-score too, with the population standard deviation", () => {
    const r = positions(cohort(60, 65, 70, 75, 80, 85, 90, 95));
    expect(r.normalization).toBe("percentile_z");
    expect(by(r, "p8")).toMatchObject({ rank: 1, percentile: 93.8, zScore: 1.53 });
    expect(by(r, "p1")).toMatchObject({ rank: 8, percentile: 6.3, zScore: -1.53 });
    expect(by(r, "p4").zScore).toBe(-0.22);
    // the z-scores of a cohort add up to (nearly) zero
    expect(Math.abs(r.positions.reduce((n, p) => n + (p.zScore ?? 0), 0))).toBeLessThan(0.05);
  });

  it("everyone level: z-score 0, not a division by zero", () => {
    const r = positions(cohort(80, 80, 80, 80, 80, 80, 80, 80));
    expect(r.positions.every((p) => p.zScore === 0 && p.percentile === 50 && p.rank === 1)).toBe(true);
  });

  it("the same input always gives the same answer, whatever the order it arrives in", () => {
    const a = positions(cohort(55, 91, 72, 72, 64, 88, 79, 40, 83));
    const b = positions([...cohort(55, 91, 72, 72, 64, 88, 79, 40, 83)].reverse());
    const key = (r: ReturnType<typeof positions>) => JSON.stringify(r.positions.map((p) => [p.id, p.rank, p.percentile, p.zScore]).sort());
    expect(key(a)).toBe(key(b));
  });
});

describe("explainDifference", () => {
  const a = [{ key: "okr", label: "OKR", score: 90, points: 36 }, { key: "kpi", label: "KPI", score: 80, points: 24 }, { key: "delivery", label: "Delivery", score: null, points: null }];
  const b = [{ key: "okr", label: "OKR", score: 70, points: 28 }, { key: "kpi", label: "KPI", score: 85, points: 25.5 }, { key: "delivery", label: "Delivery", score: 60, points: 9 }];
  it("each part is A's points minus B's, largest first, and a part with no data adds nothing and says so", () => {
    const d = explainDifference(a, b);
    expect(d.map((x) => [x.key, x.contribution])).toEqual([["delivery", -9], ["okr", 8], ["kpi", -1.5]]);
    expect(d[0]!.note).toMatch(/No data for the first person/);
    expect(d[1]!.note).toBeNull();
  });
  it("a part only one model has is shown with a note; two people with no data on a part have nothing to explain", () => {
    expect(explainDifference(a.slice(0, 2), b).find((x) => x.key === "delivery")).toMatchObject({ a: null, b: 60, contribution: -9, note: "Not part of both models" });
    expect(explainDifference([{ key: "x", label: "X", score: null, points: null }], [{ key: "x", label: "X", score: null, points: null }])[0]).toMatchObject({ contribution: 0, note: "No data for either person" });
  });
});
