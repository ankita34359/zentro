import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../backend/src/modules/scoring/engine/canonical.js";
import { computeScore } from "../../backend/src/modules/scoring/engine/engine.js";
import { PROVIDERS, TASK_PROVIDERS } from "../../backend/src/modules/scoring/engine/registry.js";
import { DEFAULT_BANDS, TEMPLATES } from "../../backend/src/modules/scoring/engine/templates.js";
import type { KpiInput, ModelDef, ObjectiveInput, ScoreInputs, TaskInput } from "../../backend/src/modules/scoring/engine/types.js";

const model = (key: string, over: Partial<ModelDef> = {}): ModelDef => {
  const t = TEMPLATES.find((x) => x.key === key)!;
  return { name: t.name, version: 1, minWeightCoverage: 0.6, minConfidenceForFinal: 0.6, bands: DEFAULT_BANDS, components: t.components.map((c, i) => ({ ...c, sortOrder: i })), ...over };
};
const inputs = (over: Partial<ScoreInputs> = {}): ScoreInputs => ({
  subject: { type: "membership", id: "m1", label: "Ann" }, period: { start: "2026-07-01", end: "2026-09-30", open: false }, asOf: "2026-09-30",
  objectives: { personal: [], team: [], department: [], company: [] }, kpis: [], teamKpis: [], tasks: [], teamTasks: [], ...over,
});
const direct = (v: Record<string, number | null>): ScoreInputs["overrides"] => Object.fromEntries(Object.entries(v).map(([k, value]) => [k, { value }]));

describe("golden vectors (docs/scoring-architecture.md 5.4)", () => {
  const employee = model("model_employee");
  it("A. all present: 85, 90, 80, 90 → 86.5, final in a closed period", () => {
    const r = computeScore(inputs({ overrides: direct({ okr: 85, kpi: 90, delivery: 80, quality: 90 }) }), employee);
    expect(r.total).toBe(86.5);
    expect(r.status).toBe("final");
    expect(r.weightCoverage).toBe(1);
    expect(r.explanation.formula).toBe("(85.0 × 0.40) + (90.0 × 0.30) + (80.0 × 0.15) + (90.0 × 0.15) = 86.5");
    expect(r.explanation.band).toBe("On target");
  });
  it("A in an OPEN period is provisional, with the reason", () => {
    const r = computeScore(inputs({ period: { start: "2026-07-01", end: "2026-09-30", open: true }, overrides: direct({ okr: 85, kpi: 90, delivery: 80, quality: 90 }) }), employee);
    expect(r.total).toBe(86.5);
    expect(r.status).toBe("provisional");
    expect(r.explanation.reasons).toEqual(["The period is still open"]);
  });
  it("B. KPI missing: 85.0, provisional, 70% coverage, and it says what would change it", () => {
    const r = computeScore(inputs({ overrides: direct({ okr: 85, kpi: null, delivery: 80, quality: 90 }) }), employee);
    expect(r.total).toBe(85);
    expect(r.status).toBe("provisional");
    expect(r.weightCoverage).toBeCloseTo(0.7);
    expect(r.explanation.reasons).toContain("KPI achievement: no data recorded");
    expect(r.explanation.whatWouldChangeThis[0]).toMatch(/KPI achievement/);
    expect(r.components.find((c) => c.key === "kpi")).toMatchObject({ state: "missing", score: null, effectiveWeight: 0, points: null });
  });
  it("C. too little data: only quality → insufficient, total null", () => {
    const r = computeScore(inputs({ overrides: direct({ okr: null, kpi: null, delivery: null, quality: 90 }) }), employee);
    expect(r.status).toBe("insufficient");
    expect(r.total).toBeNull();
    expect(r.explanation.formula).toBe("Not enough data to score");
    expect(r.explanation.reasons[0]).toMatch(/15% of the model's weight/);
  });
  it("D. a recorded zero is a real zero: 59.5; no record at all is case B", () => {
    expect(computeScore(inputs({ overrides: direct({ okr: 85, kpi: 0, delivery: 80, quality: 90 }) }), employee).total).toBe(59.5);
    expect(computeScore(inputs({ overrides: direct({ okr: 85, kpi: null, delivery: 80, quality: 90 }) }), employee).total).toBe(85);
  });
  it("F. the CEO model: 70, 80, 60, 75 → 72.25 rounds half-up to 72.3", () => {
    const r = computeScore(inputs({ overrides: direct({ company_okr: 70, exec_kpi: 80, strategic: 60, org_health: 75 }) }), model("model_ceo"));
    expect(r.rawTotal).toBeCloseTo(72.25, 10);
    expect(r.total).toBe(72.3);
  });
  it("rounds half-up on every platform: 86.45 → 86.5, 86.44 → 86.4", () => {
    const m: ModelDef = { ...model("model_employee"), components: [{ key: "a", label: "A", weight: 100, providerKey: "okr.attainment", minSample: 1, sortOrder: 0, config: {} }] };
    expect(computeScore(inputs({ overrides: { a: { value: 86.45 } } }), m).total).toBe(86.5);
    expect(computeScore(inputs({ overrides: { a: { value: 86.44 } } }), m).total).toBe(86.4);
    expect(computeScore(inputs({ overrides: { a: { value: 0.05 } } }), m).total).toBe(0.1);
  });
});

describe("properties", () => {
  const employee = model("model_employee");
  const base = { okr: 70, kpi: 60, delivery: 80, quality: 90 };
  it("monotonicity: raising any component never lowers the total", () => {
    for (const k of Object.keys(base) as (keyof typeof base)[]) {
      for (const bump of [1, 5, 20]) {
        const lo = computeScore(inputs({ overrides: direct(base) }), employee).rawTotal!;
        const hi = computeScore(inputs({ overrides: direct({ ...base, [k]: Math.min(100, base[k] + bump) }) }), employee).rawTotal!;
        expect(hi).toBeGreaterThanOrEqual(lo);
      }
    }
  });
  it("weight scaling: multiplying every weight by a constant gives the same total", () => {
    const scaled: ModelDef = { ...employee, components: employee.components.map((c) => ({ ...c, weight: c.weight * 7.5 })) };
    expect(computeScore(inputs({ overrides: direct(base) }), scaled).rawTotal).toBeCloseTo(computeScore(inputs({ overrides: direct(base) }), employee).rawTotal!, 10);
  });
  it("permutation: reordering the components gives identical output and the same canonical text", () => {
    const shuffled: ModelDef = { ...employee, components: [...employee.components].reverse().map((c, i) => ({ ...c, sortOrder: employee.components.length - 1 - i })) };
    const a = computeScore(inputs({ overrides: direct(base) }), employee);
    const b = computeScore(inputs({ overrides: direct(base) }), shuffled);
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });
  it("missing is not zero: dropping a value never lowers the score by treating it as 0, setting it to 0 does", () => {
    const withAll = computeScore(inputs({ overrides: direct(base) }), employee).rawTotal!;
    const dropped = computeScore(inputs({ overrides: direct({ ...base, kpi: null }) }), employee).rawTotal!;
    const zeroed = computeScore(inputs({ overrides: direct({ ...base, kpi: 0 }) }), employee).rawTotal!;
    expect(dropped).toBeGreaterThan(zeroed);
    expect(Math.abs(dropped - (base.okr * 40 + base.delivery * 15 + base.quality * 15) / 70)).toBeLessThan(1e-9);
    expect(zeroed).toBeLessThan(withAll);
  });
  it("purity: calling it twice gives deep-equal results and the inputs are not changed", () => {
    const i = inputs({ overrides: direct(base) });
    const before = canonicalJson(i);
    expect(computeScore(i, employee)).toEqual(computeScore(i, employee));
    expect(canonicalJson(i)).toBe(before);
  });
  it("the CEO template reaches no task-based provider", () => {
    for (const c of TEMPLATES.find((t) => t.key === "model_ceo")!.components) expect(TASK_PROVIDERS).not.toContain(c.providerKey);
    expect(TEMPLATES.every((t) => t.components.reduce((n, c) => n + c.weight, 0) === 100)).toBe(true);
    for (const t of TEMPLATES) for (const c of t.components) expect(Object.keys(PROVIDERS).concat(["mentorship.mentee_growth", "mentorship.development", "mentorship.activity", "team.development", "mgmt.responsibilities", "dept.team_performance", "dept.contribution", "leadership.strategic_execution", "org.health"])).toContain(c.providerKey);
  });
});

const task = (id: string, due: string, done: string | null, over: Partial<TaskInput> = {}): TaskInput => ({ id, title: `Task ${id}`, importance: 3, priority: "medium", dueAt: due, status: done ? "completed" : "in_progress", completedOn: done, estimatedMinutes: null, actualMinutes: null, quality: null, ...over });
const deliveryOnly = (tasks: TaskInput[], asOf = "2026-09-30", cfg: Record<string, unknown> = {}): ModelDef => ({ ...model("model_employee"), components: [{ key: "delivery", label: "Delivery", weight: 100, providerKey: "tasks.delivery", minSample: 5, sortOrder: 0, config: cfg }] }) as ModelDef & { tasks?: never };

describe("delivery provider (3.3)", () => {
  const run = (tasks: TaskInput[], asOf = "2026-09-30") => computeScore(inputs({ tasks, asOf }), deliveryOnly(tasks)).components[0]!;
  it("on time = 1, late decays to 0 over 7 days (half credit at most), overdue = 0, weighted by importance and priority", () => {
    const tasks = [task("1", "2026-08-01", "2026-08-01"), task("2", "2026-08-02", "2026-08-02"), task("3", "2026-08-03", "2026-08-03"), task("4", "2026-08-04", "2026-08-04"), task("5", "2026-08-10", "2026-08-12")];
    // four on time (credit 1) and one late by 2 days (0.5 × (1 − 2/7) = 0.357…), equal weights
    expect(run(tasks).rawValue).toBeCloseTo(((4 + 0.5 * (1 - 2 / 7)) / 5) * 100, 8);
    const overdue = [...tasks.slice(0, 4), task("6", "2026-08-20", null)];
    expect(run(overdue).rawValue).toBeCloseTo(80, 8);
    const heavy = [...tasks.slice(0, 4), task("7", "2026-08-20", null, { importance: 5, priority: "critical" })]; // weight 10 vs 3 each
    expect(run(heavy).rawValue).toBeCloseTo((12 / 22) * 100, 6);
  });
  it("quantity is irrelevant: 20 and 100 on-time tasks give the same value; only confidence can differ", () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => task(String(i), "2026-08-01", "2026-08-01"));
    expect(run(mk(20)).rawValue).toBe(run(mk(100)).rawValue);
    const a = computeScore(inputs({ tasks: mk(6) }), deliveryOnly([]));
    const b = computeScore(inputs({ tasks: mk(60) }), deliveryOnly([]));
    expect(a.total).toBe(b.total);
    expect(b.confidence).toBeGreaterThanOrEqual(a.confidence);
  });
  it("tasks not yet due are pending and left out; fewer than the minimum is insufficient; no tasks is missing; cancelled tasks never count", () => {
    expect(run([task("1", "2026-12-01", null)]).state).toBe("missing");
    expect(run([task("1", "2026-08-01", "2026-08-01")]).state).toBe("insufficient");
    expect(run([task("1", "2026-08-01", null, { status: "cancelled" })]).state).toBe("missing");
    expect(run([task("1", "2026-12-01", null)]).notes.join(" ")).toMatch(/1 task is not due yet/);
  });
  it("estimate accuracy is blended in at 20% once there are enough estimated and measured tasks", () => {
    const tasks = Array.from({ length: 5 }, (_, i) => task(String(i), "2026-08-01", "2026-08-01", { estimatedMinutes: 100, actualMinutes: 200 }));
    expect(run(tasks).rawValue).toBeCloseTo(100 * 0.8 + 50 * 0.2, 8);
  });
});

const kr = (id: string, current: number | null, over = {}) => ({ id, title: `KR ${id}`, direction: "increase" as const, method: "linear" as const, start: 0, target: 100, current, weight: 1, ...over });
const objective = (id: string, krs: ReturnType<typeof kr>[], over: Partial<ObjectiveInput> = {}): ObjectiveInput => ({ id, title: `Objective ${id}`, level: "individual", weight: 1, lifecycle: "active", keyResults: krs, ...over });
const okrOnly = (minSample = 1): ModelDef => ({ ...model("model_employee"), components: [{ key: "okr", label: "OKR", weight: 100, providerKey: "okr.attainment", minSample, sortOrder: 0, config: {} }] });

describe("OKR provider (3.1)", () => {
  it("is the weighted mean of objective attainment; no recorded value is left out, not zero; drafts and cancelled never count", () => {
    const set = [objective("a", [kr("1", 80), kr("2", 40)], { weight: 2 }), objective("b", [kr("3", 100)]), objective("c", [kr("4", 0)], { lifecycle: "draft" }), objective("d", [kr("5", 0)], { lifecycle: "cancelled" })];
    const r = computeScore(inputs({ objectives: { personal: set, team: [], department: [], company: [] } }), okrOnly());
    expect(r.components[0]!.rawValue).toBeCloseTo((2 * 60 + 1 * 100) / 3, 8); // a = (80 + 40) / 2 = 60 with weight 2, b = 100
    const noData = computeScore(inputs({ objectives: { personal: [objective("a", [kr("1", null)])], team: [], department: [], company: [] } }), okrOnly());
    expect(noData.components[0]).toMatchObject({ state: "missing", score: null });
    const zero = computeScore(inputs({ objectives: { personal: [objective("a", [kr("1", 0)])], team: [], department: [], company: [] } }), okrOnly());
    expect(zero.components[0]).toMatchObject({ state: "ok", rawValue: 0 });
  });
  it("an objective with under half of its key-result weight measured is shown but left out", () => {
    const r = computeScore(inputs({ objectives: { personal: [objective("a", [kr("1", 100), kr("2", null, { weight: 3 })]), objective("b", [kr("3", 50)])], team: [], department: [], company: [] } }), okrOnly());
    expect(r.components[0]!.rawValue).toBe(50);
    expect(r.components[0]!.notes.join(" ")).toMatch(/left out of the score/);
  });
  it("a falling key result counts as 0 and says so; one beyond its target counts as 100% and says so", () => {
    const r = computeScore(inputs({ objectives: { personal: [objective("a", [kr("1", -20), kr("2", 150)])], team: [], department: [], company: [] } }), okrOnly());
    expect(r.components[0]!.rawValue).toBe(50);
    expect(r.components[0]!.contributors.map((c) => c.note)).toEqual(["went backwards: counted as 0", "beyond the target: counted as 100%"]);
  });
});

const kpi = (id: string, values: number[], over: Partial<KpiInput> = {}): KpiInput => ({ assignmentId: `a${id}`, kpiId: `k${id}`, name: `KPI ${id}`, category: "growth", unit: null, direction: "higher_is_better", aggregation: "sum", target: 40, targetMax: null, weight: 1, expectedPeriods: 3, values: values.map((value, i) => ({ period: `2026-0${7 + i}-01`, value })), ...over });
const kpiOnly = (): ModelDef => ({ ...model("model_employee"), components: [{ key: "kpi", label: "KPI", weight: 100, providerKey: "kpi.attainment", minSample: 1, sortOrder: 0, config: {} }] });

describe("KPI provider (3.2)", () => {
  it("a SUMMED KPI over a quarter is compared with its monthly target times the periods expected", () => {
    const r = computeScore(inputs({ kpis: [kpi("1", [30, 40, 50])] }), kpiOnly());
    expect(r.components[0]!.rawValue).toBe(100); // 120 against 40 × 3
    const half = computeScore(inputs({ kpis: [kpi("1", [20, 20, 20])] }), kpiOnly());
    expect(half.components[0]!.rawValue).toBeCloseTo(50, 8);
  });
  it("coverage: 2 of 3 is fine and noted; 1 of 3 is shown but left out; none is missing; a recorded 0 is a real 0", () => {
    expect(computeScore(inputs({ kpis: [kpi("1", [60, 60])] }), kpiOnly()).components[0]).toMatchObject({ state: "ok" });
    expect(computeScore(inputs({ kpis: [kpi("1", [60])] }), kpiOnly()).components[0]).toMatchObject({ state: "insufficient", rawValue: null });
    expect(computeScore(inputs({ kpis: [kpi("1", [])] }), kpiOnly()).components[0]).toMatchObject({ state: "missing" });
    expect(computeScore(inputs({ kpis: [] }), kpiOnly()).components[0]).toMatchObject({ state: "missing" });
    expect(computeScore(inputs({ kpis: [kpi("1", [0, 0, 0])] }), kpiOnly()).components[0]).toMatchObject({ state: "ok", rawValue: 0 });
  });
  it("lower-is-better and range KPIs, averaged and weighted", () => {
    const lower = kpi("1", [8], { direction: "lower_is_better", aggregation: "avg", target: 4, expectedPeriods: 1 });
    const range = kpi("2", [100], { direction: "target_range", aggregation: "last", target: 70, targetMax: 85, expectedPeriods: 1 });
    expect(computeScore(inputs({ kpis: [lower] }), kpiOnly()).components[0]!.rawValue).toBe(50);
    expect(computeScore(inputs({ kpis: [lower, range] }), kpiOnly()).components[0]!.rawValue).toBe(25); // (0.5 + 0) / 2
    expect(computeScore(inputs({ kpis: [{ ...lower, weight: 3 }, range] }), kpiOnly()).components[0]!.rawValue).toBe(37.5);
  });
});

describe("quality provider (3.4)", () => {
  const q = (kpis: KpiInput[], tasks: TaskInput[]) => computeScore(inputs({ kpis, tasks }), { ...model("model_employee"), components: [{ key: "q", label: "Quality", weight: 100, providerKey: "quality.impact", minSample: 1, sortOrder: 0, config: {} }] }).components[0]!;
  const rated = (n: number, quality: number) => Array.from({ length: n }, (_, i) => task(String(i), "2026-08-01", "2026-08-01", { quality }));
  it("blends quality KPIs and rated tasks 50/50, uses one when only one exists and says so, and needs 3 rated tasks", () => {
    const k = kpi("1", [40, 40, 40], { category: "quality" }); // 100
    expect(q([k], rated(3, 3)).rawValue).toBe(75); // KPI 100, ratings (3−1)/4 = 50
    expect(q([k], []).notes.join(" ")).toMatch(/Only quality and impact KPIs/);
    expect(q([], rated(3, 5)).rawValue).toBe(100);
    expect(q([], rated(2, 5))).toMatchObject({ state: "insufficient" });
    expect(q([], [])).toMatchObject({ state: "missing" });
    expect(q([kpi("2", [40, 40, 40], { category: "delivery" })], [])).toMatchObject({ state: "missing" }); // not a quality KPI
  });
});

describe("evidence and confidence", () => {
  it("absent evidence lowers confidence only for components that expect it, never the value", () => {
    const m: ModelDef = { ...model("model_employee"), components: model("model_employee").components.map((c) => ({ ...c, config: { evidence: "recommended" } })) };
    const none = computeScore(inputs({ overrides: direct({ okr: 85, kpi: 90, delivery: 80, quality: 90 }) }), m);
    const plain = computeScore(inputs({ overrides: direct({ okr: 85, kpi: 90, delivery: 80, quality: 90 }) }), model("model_employee"));
    expect(none.total).toBe(plain.total);
    expect(none.explanation.confidence.parts.evidence).toBe(0.5);
    expect(plain.explanation.confidence.parts.evidence).toBe(1);
    expect(none.confidence).toBeLessThan(plain.confidence);
  });
});
