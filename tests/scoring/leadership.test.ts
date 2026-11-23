import { describe, expect, it } from "vitest";
import { computeScore } from "../../backend/src/modules/scoring/engine/engine.js";
import { contributionProvider, departmentPeopleProvider, managementProvider, orgHealthProvider, strategicExecutionProvider, teamDevelopmentProvider } from "../../backend/src/modules/scoring/engine/providers/leadership.js";
import { DEFAULT_BANDS, TEMPLATES } from "../../backend/src/modules/scoring/engine/templates.js";
import type { ModelDef, ObjectiveInput, ScoreInputs } from "../../backend/src/modules/scoring/engine/types.js";

/** An objective with one key result 0 → 100 at `value`. */
const obj = (id: string, value: number | null, over: Partial<ObjectiveInput> = {}): ObjectiveInput => ({ id, title: `Objective ${id}`, level: "department", weight: 1, lifecycle: "active", keyResults: [{ id: `k${id}`, title: "KR", direction: "increase", method: "linear", start: 0, target: 100, current: value, weight: 1 }], start: "2026-07-01", end: "2026-12-31", health: "on_track", parent: { id: "company", title: "Company goal", weight: 1 }, ...over });

describe("contribution to the company (department head)", () => {
  it("weights linked objectives by how heavily they contribute: 80 at weight 3 and 40 at weight 1 → (80×3 + 40×1) / 4 = 70", () => {
    const r = contributionProvider([obj("a", 80, { parent: { id: "c", title: "Revenue", weight: 3 } }), obj("b", 40, { parent: { id: "c", title: "Revenue", weight: 1 } })], 1);
    expect(r).toMatchObject({ state: "ok", sampleSize: 2 });
    expect(r.value).toBeCloseTo(70, 5);
    expect(r.contributors[0]!.label).toBe("Objective a → Revenue");
  });
  it("an objective linked to nothing adds nothing and says so; with nothing linked at all the part is not scored, never 0", () => {
    const one = contributionProvider([obj("a", 80), obj("b", 10, { parent: null })], 1);
    expect(one.value).toBeCloseTo(80, 5);
    expect(one.notes.join(" ")).toMatch(/"Objective b" is not linked to a company objective/);
    expect(one.coverage).toBe(0.5);
    expect(contributionProvider([obj("b", 10, { parent: null })], 1)).toMatchObject({ value: null, state: "insufficient" });
    expect(contributionProvider([], 1)).toMatchObject({ value: null, state: "missing" });
  });
});

describe("strategic execution (CEO): attainment 70 % and pace 30 %", () => {
  it("on pace: 50 % done halfway through → 0.7×50 + 0.3×100 = 65; behind pace: 25 % halfway → 0.7×25 + 0.3×50 = 32.5; a finished objective counts pace 1", () => {
    const half = { start: "2026-07-01", end: "2026-12-31" }; // 184 days
    const asOf = "2026-09-30"; // day 92 of 184: exactly half
    expect(strategicExecutionProvider([obj("a", 50, half)], asOf, 1).value).toBeCloseTo(65, 5);
    expect(strategicExecutionProvider([obj("a", 25, half)], asOf, 1).value).toBeCloseTo(32.5, 5);
    expect(strategicExecutionProvider([obj("a", 100, { ...half, lifecycle: "completed" })], asOf, 1).value).toBeCloseTo(100, 5);
  });
  it("the very start of an objective is not held to a pace (under 5 % of the time has passed)", () => {
    expect(strategicExecutionProvider([obj("a", 0, { start: "2026-07-01", end: "2026-12-31" })], "2026-07-03", 1).value).toBeCloseTo(30, 5);
  });
});

describe("organizational health", () => {
  it("on track and completed 100, at risk 50, delayed 0; not started and no data are left out: (100 + 100 + 50 + 0) / 4 = 62.5", () => {
    const r = orgHealthProvider([obj("a", 1, { health: "on_track" }), obj("b", 1, { health: "completed" }), obj("c", 1, { health: "at_risk" }), obj("d", 1, { health: "delayed" }), obj("e", null, { health: "no_data" }), obj("f", null, { health: "not_started" })], 1);
    expect(r.value).toBeCloseTo(62.5, 5);
    expect(r.sampleSize).toBe(4);
    expect(r.notes.join(" ")).toMatch(/2 objectives are not started or have no recorded values/);
    expect(r.contributors.map((c) => c.label)).toEqual(["Objective c (at risk)", "Objective d (delayed)"]);
  });
});

describe("team development, management responsibilities, department people", () => {
  it("team development: mean change +8 points → index 70; nobody comparable → insufficient", () => {
    expect(teamDevelopmentProvider({ members: [{ baseline: 60, current: 70 }, { baseline: 70, current: 76 }, { baseline: null, current: 80 }] }, 2).value).toBeCloseTo(70, 5);
    expect(teamDevelopmentProvider({ members: [{ baseline: null, current: 80 }] }, 1)).toMatchObject({ value: null, state: "insufficient" });
    expect(teamDevelopmentProvider({ members: [] }, 1).state).toBe("missing");
  });
  it("management: 3 of 4 reports reviewed on time → 75; reviews that came late do not count; an open period with no review is simply not scored yet", () => {
    const r = managementProvider({ reports: [{ submitted: true, onTime: true }, { submitted: true, onTime: true }, { submitted: true, onTime: true }, { submitted: true, onTime: false }], graceDays: 14, periodOpen: false }, 1);
    expect(r.value).toBe(75);
    expect(r.contributors[0]!.label).toMatch(/on time for 3 of 4 direct reports \(1 more came late\)/);
    expect(r.notes.join(" ")).toMatch(/not measured yet/);
    expect(managementProvider({ reports: [{ submitted: false, onTime: false }], graceDays: 14, periodOpen: true }, 1)).toMatchObject({ value: null, state: "missing" });
    expect(managementProvider({ reports: [{ submitted: false, onTime: false }], graceDays: 14, periodOpen: false }, 1).value).toBe(0); // a period that ended with nothing written is a real 0
  });
  it("department people: the people-weighted mean, one line per department, nobody named", () => {
    const r = departmentPeopleProvider({ departments: [{ name: "Engineering", people: 10, mean: 80 }, { name: "Sales", people: 5, mean: 70 }, { name: "Tiny", people: 1, mean: 99 }] }, 2);
    expect(r.value).toBeCloseTo((80 * 10 + 70 * 5) / 15, 5);
    expect(r.contributors).toHaveLength(3);
    expect(JSON.stringify(r)).not.toMatch(/Ann|Bob/);
  });
});

describe("the CEO model has no task component, and scores from company objectives and organizational health", () => {
  const t = TEMPLATES.find((x) => x.key === "model_ceo")!;
  const model: ModelDef = { name: t.name, version: 1, minWeightCoverage: 0.6, minConfidenceForFinal: 0.6, bands: DEFAULT_BANDS, components: t.components.map((c, i) => ({ ...c, sortOrder: i })) };
  it("scores", () => {
    const inputs: ScoreInputs = { subject: { type: "membership", id: "ceo", label: "Cleo" }, period: { start: "2026-07-01", end: "2026-12-31", open: false }, asOf: "2026-09-30", objectives: { personal: [], team: [], department: [], company: [obj("a", 50, { level: "company", parent: null })] }, kpis: [], teamKpis: [], tasks: [], teamTasks: [], overrides: { exec_kpi: { value: 70 } }, extra: { org: { objectives: [obj("a", 50, { health: "at_risk" }), obj("b", 70, { health: "on_track" })] } } };
    const r = computeScore(inputs, model);
    const by = (k: string) => r.components.find((c) => c.key === k)!;
    expect(by("company_okr")).toMatchObject({ state: "ok", score: 50 });
    expect(by("strategic")).toMatchObject({ state: "ok" });
    expect(by("org_health")).toMatchObject({ state: "ok", score: 75 });
    expect(r.components.map((c) => c.providerKey)).not.toContain("tasks.delivery");
    expect(r.status).toBe("final"); // every part has data and the period is closed
  });
});
