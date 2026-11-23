import { describe, expect, it } from "vitest";
import { computeScore } from "../../backend/src/modules/scoring/engine/engine.js";
import { activityProvider, developmentProvider, improvementIndex, menteeGrowthProvider } from "../../backend/src/modules/scoring/engine/providers/mentorship.js";
import { DEFAULT_BANDS, TEMPLATES } from "../../backend/src/modules/scoring/engine/templates.js";
import type { MentorshipLink, ModelDef, ScoreInputs } from "../../backend/src/modules/scoring/engine/types.js";

const link = (over: Partial<MentorshipLink> = {}): MentorshipLink => ({ assignmentId: "a1", counterpart: { id: "x", name: "Xi" }, overlapDays: 60, mentorCount: 1, baselineScore: 60, currentScore: 70, scoreDelta: 10, deliveryDelta: null, qualityDelta: null, goalAchievement: null, activities: 4, cadenceDays: 14, ...over });
const cfg = { minDays: 60, k: 2.5 };

describe("improvement index (docs/scoring-architecture.md 7.4) — golden vectors", () => {
  it("50 means no change; +10 points of score at k = 2.5 gives 75; +20 reaches 100; −30 stops at 0", () => {
    expect(improvementIndex(link({ scoreDelta: 0 }), 2.5)).toBe(50);
    expect(improvementIndex(link({ scoreDelta: 10 }), 2.5)).toBe(75);
    expect(improvementIndex(link({ scoreDelta: 20 }), 2.5)).toBe(100);
    expect(improvementIndex(link({ scoreDelta: 40 }), 2.5)).toBe(100);
    expect(improvementIndex(link({ scoreDelta: -30 }), 2.5)).toBe(0);
  });
  it("averages the changes that could be measured; development goals count as attainment − 50; nothing measurable gives null, not 50", () => {
    expect(improvementIndex(link({ scoreDelta: 10, deliveryDelta: 0 }), 2.5)).toBe(62.5); // mean 5
    expect(improvementIndex(link({ scoreDelta: null, goalAchievement: 70 }), 2.5)).toBe(100);
    expect(improvementIndex(link({ scoreDelta: null, goalAchievement: 50 }), 2.5)).toBe(50);
    expect(improvementIndex(link({ scoreDelta: null }), 2.5)).toBeNull();
  });
});

describe("mentor development", () => {
  it("duration and credit share weight the mean: 75 over 60 days alone, 25 over 30 days → (75×1 + 25×0.5) / 1.5 = 58.3", () => {
    const r = developmentProvider([link({ assignmentId: "a", scoreDelta: 10 }), link({ assignmentId: "b", overlapDays: 30, scoreDelta: -10 })], 2, cfg);
    expect(r.state).toBe("ok");
    expect(r.value).toBeCloseTo(58.333, 2);
    expect(r.sampleSize).toBe(2);
  });
  it("two mentors share the credit: a mentee with 2 mentors counts half as much", () => {
    const r = developmentProvider([link({ assignmentId: "a", scoreDelta: 10 }), link({ assignmentId: "b", scoreDelta: -10, mentorCount: 2 })], 2, cfg);
    expect(r.value).toBeCloseTo((75 * 1 + 25 * 0.5) / 1.5, 3);
  });
  it("fewer measurable mentees than the minimum is 'not enough data', with the reason named; nobody assigned is 'missing'", () => {
    const one = developmentProvider([link(), link({ assignmentId: "b", scoreDelta: null, baselineScore: null })], 2, cfg);
    expect(one).toMatchObject({ value: null, state: "insufficient", sampleSize: 1 });
    expect(one.notes.join(" ")).toMatch(/no earlier score to start from/);
    expect(developmentProvider([], 2, cfg)).toMatchObject({ value: null, state: "missing" });
  });
});

describe("mentoring activity", () => {
  it("activities against the number expected at the cadence, capped at 1: 60 days / 14 = 4.3 expected; 2 logged → 47%; 9 logged → 100%", () => {
    expect(activityProvider([link({ activities: 2 })]).value).toBeCloseTo(46.67, 1);
    expect(activityProvider([link({ activities: 9 })]).value).toBe(100);
    expect(activityProvider([link({ activities: 0 })]).value).toBe(0); // an assignment with nothing logged is a real zero
  });
  it("a few days inside the period is too short to expect a session and is left out, with a note", () => {
    const r = activityProvider([link({ overlapDays: 5, activities: 0 })]);
    expect(r).toMatchObject({ value: null, state: "insufficient" });
    expect(r.notes[0]).toMatch(/too short to expect a session/);
  });
});

describe("mentee growth and the Mentor model", () => {
  it("a mentee's growth is their own improvement index", () => {
    expect(menteeGrowthProvider([link({ scoreDelta: 10 })], cfg)).toMatchObject({ value: 75, state: "ok" });
    expect(menteeGrowthProvider([], cfg).state).toBe("missing");
  });
  it("the standard Mentor model scores mentee development and activity from the snapshot, and says missing when there are no mentees", () => {
    const t = TEMPLATES.find((x) => x.key === "model_mentor")!;
    const model: ModelDef = { name: t.name, version: 1, minWeightCoverage: 0.6, minConfidenceForFinal: 0.6, bands: DEFAULT_BANDS, components: t.components.map((c, i) => ({ ...c, sortOrder: i })) };
    const base: ScoreInputs = { subject: { type: "membership", id: "m", label: "Mo" }, period: { start: "2026-07-01", end: "2026-09-30", open: false }, asOf: "2026-09-30", objectives: { personal: [], team: [], department: [], company: [] }, kpis: [], teamKpis: [], tasks: [], teamTasks: [], overrides: { okr: { value: 80 }, kpi: { value: 80 }, delivery: { value: 80 } } };
    const withMentees = computeScore({ ...base, extra: { mentorship: { asMentor: [link({ assignmentId: "a", scoreDelta: 10 }), link({ assignmentId: "b", scoreDelta: 10, activities: 4 })], asMentee: [] } } }, model);
    const dev = withMentees.components.find((c) => c.key === "mentee_development")!;
    const act = withMentees.components.find((c) => c.key === "mentoring_activity")!;
    expect(dev).toMatchObject({ state: "ok", score: 75 });
    expect(act.state).toBe("ok");
    const none = computeScore(base, model);
    expect(none.components.find((c) => c.key === "mentee_development")).toMatchObject({ state: "missing", score: null, points: null });
  });
});
