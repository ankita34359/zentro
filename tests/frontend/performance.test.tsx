// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { envelope, HEALTH_OK, json, ME_READY, renderApp, setMe, stubFetch, stubMatchMedia } from "./helpers";

beforeEach(() => stubMatchMedia(false));
const isGet = (init?: RequestInit) => (init?.method ?? "GET") === "GET";
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));
const withCaps = (caps: Record<string, string[]>) => ({ ...ME_READY, roles: [{ key: "x", name: "Some Role" }], capabilities: caps });

const PERIOD = { id: "p1", name: "Q4 2026", periodType: "quarter", startDate: "2026-10-01", endDate: "2026-12-31", status: "open", closedAt: null, isDemo: false, scorecards: 1 };
const SUMMARY = { scoreId: "s2", runNumber: 2, status: "provisional", total: 84.3, band: "On target", confidence: 0.46, confidenceLabel: "low", weightCoverage: 0.7, modelName: "Employee", modelVersion: 1, computedAt: "2026-11-23T10:00:00.000Z", trigger: "manual" };
const COMPONENTS = [
  { key: "okr", label: "OKR achievement", providerKey: "okr.attainment", state: "ok", score: 80, weight: 0.4, effectiveWeight: 0.5714, points: 45.7, sampleSize: 1, minSample: 1, coverage: 1, stateText: "Enough data", contributors: [{ ref: { type: "key_result", id: "k1" }, label: "Activated accounts (Ship the onboarding)", value: 0.8, weight: 1 }], notes: [] },
  { key: "kpi", label: "KPI achievement", providerKey: "kpi.attainment", state: "ok", score: 90, weight: 0.3, effectiveWeight: 0.4286, points: 38.6, sampleSize: 6, minSample: 1, coverage: 1, stateText: "Enough data", contributors: [], notes: [] },
  { key: "delivery", label: "Delivery and reliability", providerKey: "tasks.delivery", state: "missing", score: null, weight: 0.15, effectiveWeight: 0, points: null, sampleSize: 0, minSample: 5, coverage: 0, stateText: "No data recorded", contributors: [], notes: ["No task was due in this period"] },
  { key: "quality", label: "Quality and business impact", providerKey: "quality.impact", state: "insufficient", score: null, weight: 0.15, effectiveWeight: 0, points: null, sampleSize: 1, minSample: 3, coverage: 0, stateText: "Not enough data (1 of 3 needed)", contributors: [], notes: [] },
];
const SCORE = (over: Record<string, unknown> = {}) => ({ ...SUMMARY, scorecardId: "c1", subject: { id: "me-1", name: "Emma Employee" }, period: { id: "p1", name: "Q4 2026", startDate: "2026-10-01", endDate: "2026-12-31", status: "open" }, componentsHidden: false, components: COMPONENTS, explanation: { formula: "(80.0 × 0.40) + (90.0 × 0.30) = 84.3", status: "provisional", band: "On target", confidence: { value: 0.46, label: "low", parts: { coverage: 0.7, sample: 0.66, evidence: 1 } }, components: [], reasons: ["OKR achievement is the largest part."], dataQuality: ["Delivery and reliability has no data recorded."], whatWouldChangeThis: ["Completing five tasks would add Delivery."], rounding: "Rounded half up to one decimal." }, engineVersion: "1", isLatest: true, ...over });
const CARD = (over: Record<string, unknown> = {}) => ({ scorecardId: "c1", subject: { id: "me-1", name: "Emma Employee" }, period: PERIOD, latest: SCORE(), runs: [SUMMARY, { ...SUMMARY, scoreId: "s1", runNumber: 1, total: 80, trigger: "scheduled" }], can: { recalculate: false, components: true }, ...over });
const server = (periods: unknown[] = [PERIOD], extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined) =>
  stubFetch((url, init) => {
    const special = extra(url, init);
    if (special) return special;
    const path = url.split("?")[0];
    if (path === "/api/performance/periods" && isGet(init)) return envelope(periods);
    if (path === "/api/performance/scorecards" && isGet(init)) return envelope([{ ...SUMMARY, scorecardId: "c1", subject: { id: "me-1", name: "Emma Employee" }, periodId: "p1", isDemo: false }]);
    if (path === "/api/performance/scorecards/for") return envelope(CARD());
    if (path === "/api/performance/scores/s2") return envelope(SCORE());
    if (path === "/api/performance/scores/s1") return envelope(SCORE({ scoreId: "s1", runNumber: 1, total: 80, isLatest: false }));
    if (path === "/api/performance/scores/s2/verify") return envelope({ matches: true, expected: { total: 84.3, status: "provisional" }, actual: { total: 84.3, status: "provisional" }, engineVersion: "1", modelVersion: 1, mismatches: [] });
    if (path === "/api/performance/trends") return envelope({ subject: { id: "me-1", name: "Emma Employee" }, componentsHidden: false, points: [], comparison: null });
    if (path === "/api/organization/structure") return envelope({ departments: [], teams: [], roleFamilies: [{ id: "f1", name: "Engineers", description: "", archived: false, archivedAt: null }, { id: "f2", name: "Designers", description: "", archived: false, archivedAt: null }], designations: [], organization: { id: "o", name: "Acme" } });
    if (path === "/api/notifications") return envelope({ notifications: [], unreadCount: 0, nextCursor: null });
    return json(HEALTH_OK);
  });

describe("Performance Intelligence (stage 5.2)", () => {
  it("a person with no grants opens their own scorecard: total, status, every part with its weight, missing parts as chips (never zero), the explanation, and Verify", async () => {
    setMe(withCaps({}));
    const f = server();
    renderApp("/performance");
    const card = await screen.findByRole("region", { name: "Scorecard" });
    expect(await within(card).findByLabelText("Total score 84.3")).toBeTruthy();
    expect(within(card).getAllByText("Provisional").length).toBeGreaterThan(0);
    expect(within(card).getByText("On target")).toBeTruthy();
    const parts = within(card).getByRole("list", { name: "What the score is made of" });
    expect(within(parts).getByText("OKR achievement")).toBeTruthy();
    expect(within(parts).getByText("Missing")).toBeTruthy(); // delivery: no data recorded
    expect(within(parts).getAllByText("No score")).toHaveLength(2); // never "0"
    expect(within(parts).getByText("Not enough data")).toBeTruthy(); // quality: some data, too little
    expect(within(parts).queryByText("0.0")).toBeNull();
    expect(within(card).getByText("How was this calculated?")).toBeTruthy();
    expect(within(card).getByText("(80.0 × 0.40) + (90.0 × 0.30) = 84.3")).toBeTruthy();
    expect(within(card).getByText(/Completing five tasks would add Delivery/)).toBeTruthy();
    // no recalculate for someone without the permission
    expect(within(card).queryByRole("button", { name: /Recalculate/ })).toBeNull();
    await userEvent.click(within(card).getByRole("button", { name: "Verify" }));
    expect(await within(card).findByText(/Matches: recomputed 84\.3/)).toBeTruthy();
    expect(f.mock.calls.some((c) => c[0] === "/api/performance/scores/s2/verify" && (c[1] as RequestInit).method === "POST")).toBe(true);
  });

  it("the run history lists every run, and opening an older run says so and shows it as it was", async () => {
    setMe(withCaps({}));
    server();
    renderApp("/performance");
    const history = await screen.findByRole("region", { name: "Run history" });
    expect(within(history).getByRole("button", { name: "Open run 2" })).toBeTruthy();
    await userEvent.click(within(history).getByRole("button", { name: "Open run 1" }));
    expect(await screen.findByText(/This is run 1, an earlier run/)).toBeTruthy();
    expect(await screen.findByLabelText("Total score 80.0")).toBeTruthy();
  });

  it("someone who may see the total but not the parts sees the total and a plain note", async () => {
    setMe(withCaps({ "performance.view_scores": ["all_in_scope"] }));
    server([PERIOD], (url) => (url.startsWith("/api/performance/scorecards/for") ? envelope(CARD({ latest: SCORE({ componentsHidden: true, components: [], explanation: null }), can: { recalculate: false, components: false } })) : undefined));
    renderApp("/performance");
    const card = await screen.findByRole("region", { name: "Scorecard" });
    expect(await within(card).findByLabelText("Total score 84.3")).toBeTruthy();
    expect(within(card).getByText(/What it is made of is only shown to the person themself/)).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Verify" })).toBeNull();
  });

  it("no period: an empty state that says what to do (administrator) or who to ask (everyone else)", async () => {
    setMe(withCaps({}));
    server([]);
    renderApp("/performance");
    expect(await screen.findByText("No performance period yet")).toBeTruthy();
    expect(screen.getByText(/An administrator creates a performance period/)).toBeTruthy();
  });

  it("the Periods tab: an administrator creates a period and calculates scores for everyone; others see neither button", async () => {
    setMe(withCaps({ "performance.manage_periods": ["all_in_scope"], "performance.recalculate": ["all_in_scope"] }));
    const f = server([PERIOD], (url, init) => {
      if (url === "/api/performance/periods" && init?.method === "POST") return envelope({ ...PERIOD, id: "p2", name: "Q1 2027" }, 201);
      if (url === "/api/performance/scorecards/recalculate" && init?.method === "POST") return envelope({ periodId: "p1", scored: 3, unchanged: 1, skipped: 0 });
      return undefined;
    });
    renderApp("/performance?tab=periods");
    const periods = await screen.findByRole("region", { name: "Periods" });
    await userEvent.click(within(periods).getByRole("button", { name: "Calculate scores for Q4 2026" }));
    expect(await within(periods).findByText(/Calculated: 3 new runs, 1 unchanged/)).toBeTruthy();
    expect(bodyOf(f.mock.calls.find((c) => c[0] === "/api/performance/scorecards/recalculate")!)).toEqual({ periodId: "p1" });
    await userEvent.click(within(periods).getByRole("button", { name: "New period" }));
    const form = await screen.findByRole("form", { name: "New period" });
    await userEvent.type(within(form).getByLabelText("Name"), "Q1 2027");
    await userEvent.type(within(form).getByLabelText("First day"), "2027-01-01");
    await userEvent.type(within(form).getByLabelText("Last day"), "2027-03-31");
    await userEvent.click(within(form).getByRole("button", { name: "Create period" }));
    await waitFor(() => expect(f.mock.calls.some((c) => c[0] === "/api/performance/periods" && (c[1] as RequestInit)?.method === "POST")).toBe(true));
    expect(bodyOf(f.mock.calls.find((c) => c[0] === "/api/performance/periods" && (c[1] as RequestInit)?.method === "POST")!)).toEqual({ name: "Q1 2027", periodType: "quarter", startDate: "2027-01-01", endDate: "2027-03-31" });
  });

  it("a person without the permissions sees the periods but no New period or Calculate buttons", async () => {
    setMe(withCaps({}));
    server();
    renderApp("/performance?tab=periods");
    const periods = await screen.findByRole("region", { name: "Periods" });
    expect(within(periods).getByText("Q4 2026")).toBeTruthy();
    expect(within(periods).queryByRole("button", { name: /New period|Calculate/ })).toBeNull();
  });

  it("closing a period asks first, explains what it does, then closes; a closed one offers Reopen and Lock; a locked one offers neither", async () => {
    setMe(withCaps({ "performance.manage_periods": ["all_in_scope"] }));
    const closed = { ...PERIOD, id: "p0", name: "Q3 2026", status: "closed" };
    const locked = { ...PERIOD, id: "p9", name: "Q2 2026", status: "locked" };
    const f = server([PERIOD, closed, locked], (url, init) => {
      if (url === "/api/performance/periods/p1/close" && init?.method === "POST") return envelope({ ...PERIOD, status: "closed", calculated: { scored: 4, unchanged: 1, skipped: 0 } });
      return undefined;
    });
    renderApp("/performance?tab=periods");
    const periods = await screen.findByRole("region", { name: "Periods" });
    expect(within(periods).queryByRole("button", { name: "Reopen Q2 2026" })).toBeNull(); // locked: nothing to do
    expect(within(periods).queryByRole("button", { name: "Lock Q2 2026" })).toBeNull();
    expect(within(periods).queryByRole("button", { name: "Calculate scores for Q2 2026" })).toBeNull();
    expect(within(periods).getByRole("button", { name: "Reopen Q3 2026" })).toBeTruthy();
    expect(within(periods).getByRole("button", { name: "Lock Q3 2026" })).toBeTruthy();
    await userEvent.click(within(periods).getByRole("button", { name: "Close Q4 2026" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Confirm: close Q4 2026" });
    expect(within(dialog).getByText(/final score for everyone/)).toBeTruthy();
    expect(f.mock.calls.some((c) => String(c[0]).endsWith("/close"))).toBe(false); // nothing happens before the answer
    await userEvent.click(within(dialog).getByRole("button", { name: "Yes, close Q4 2026" }));
    expect(await screen.findByText(/Q4 2026 is closed\. Final scores were calculated: 4 new runs/)).toBeTruthy();
    expect(f.mock.calls.some((c) => c[0] === "/api/performance/periods/p1/close" && (c[1] as RequestInit).method === "POST")).toBe(true);
    // Lock asks too, and warns that it is permanent
    await userEvent.click(within(periods).getByRole("button", { name: "Lock Q3 2026" }));
    expect(within(await screen.findByRole("alertdialog", { name: "Confirm: lock Q3 2026" })).getByText(/Locking is permanent/)).toBeTruthy();
  });

  it("the trend lists each period with the change, shows 'No comparison' when a period had no data, and compares two periods part by part", async () => {
    setMe(withCaps({}));
    const pt = (id: string, name: string, total: number | null, delta: number | null, status = "final") => ({ periodId: id, periodName: name, startDate: "2026-01-01", endDate: "2026-03-31", periodStatus: "closed", scoreId: `s-${id}`, runNumber: 1, status, total, band: null, confidence: 1, confidenceLabel: "high", model: "Employee v1", totalDelta: delta, components: [] });
    const points = [pt("pa", "Q2 2026", null, null, "insufficient"), pt("pb", "Q3 2026", 70, null), pt("p1", "Q4 2026", 90, 20, "provisional")];
    server([PERIOD], (url) => {
      if (!url.startsWith("/api/performance/trends")) return undefined;
      if (url.includes("from=pb&to=p1")) return envelope({ subject: { id: "me-1", name: "Emma" }, componentsHidden: false, points, comparison: { from: { periodId: "pb", name: "Q3 2026", total: 70, status: "final", model: "Employee v1" }, to: { periodId: "p1", name: "Q4 2026", total: 90, status: "provisional", model: "Employee v2" }, totalDelta: 20, modelChanged: true, components: [{ key: "okr", label: "OKR achievement", from: 70, to: 90, delta: 20, note: null }, { key: "kpi", label: "KPI achievement", from: null, to: 90, delta: null, note: "No data in Q3 2026" }] } });
      return envelope({ subject: { id: "me-1", name: "Emma" }, componentsHidden: false, points, comparison: null });
    });
    renderApp("/performance");
    const over = await screen.findByRole("region", { name: "Over time" });
    const table = within(over).getByRole("table", { name: "Score by period" });
    expect(within(table).getByText("Not scored")).toBeTruthy(); // never "0.0"
    expect(within(table).getByText("+20.0")).toBeTruthy();
    expect(within(table).getAllByText("No comparison").length).toBe(2);
    await userEvent.selectOptions(within(over).getByLabelText("Compare"), "pb");
    await userEvent.selectOptions(within(over).getByLabelText("With"), "p1");
    const cmp = await within(over).findByRole("region", { name: "Comparison" });
    expect(within(cmp).getByText(/Q3 2026 70\.0 → Q4 2026 90\.0/)).toBeTruthy();
    expect(within(cmp).getByText(/may not be like for like/)).toBeTruthy();
    expect(within(cmp).getByText("No data in Q3 2026")).toBeTruthy();
  });

  it("Compare, for someone with no permission: only their own position, in words, and no names anywhere", async () => {
    setMe(withCaps({}));
    server([PERIOD], (url) => (url.startsWith("/api/performance/compare?") ? envelope({ period: { id: "p1", name: "Q4 2026", status: "open" }, roleFamily: { id: "f1", name: "Engineers" }, filters: { departmentId: null, minTenureDays: 30, includeInsufficient: false, subjectIds: [] }, cohortSize: 8, excluded: { insufficient: 0, tenure: 0 }, normalization: "percentile_z", notes: ["Tenure, team size and workload are shown beside the scores, not applied to them: a comparison is a conversation starter, not a verdict."], you: { rank: 4, of: 8, percentile: 56.3, zScore: 0.22, total: 80 }, entries: [{ subject: { id: "me-1", name: "Emma Employee" }, total: 80, status: "provisional", band: null, model: "Employee v1", rank: 4, percentile: 56.3, zScore: 0.22, isYou: true, context: { tenureDays: 200, teamSize: 8, taskLoad: 0, dataCoverage: 1, confidence: "low", evidence: 1 } }], hiddenCount: 7, canSeeNames: false }) : undefined));
    renderApp("/performance?tab=compare");
    const you = await screen.findByRole("status", { name: "Your position" });
    expect(you.textContent).toMatch(/You are 4th of 8, at the 56\.3 percentile \(z-score 0\.22\)\. Your score is 80\.0\./);
    expect(screen.getByText(/Only your own position is shown/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull(); // no table of other people
    expect(screen.queryByRole("combobox", { name: "Role family" })).toBeNull(); // no choice of group without permission to compare
    expect(screen.queryByRole("form", { name: "Save this comparison" })).toBeNull();
  });

  it("Compare, with permission: names and ranks, a note for people outside the viewer's scope, why two people differ, and saving a snapshot", async () => {
    setMe(withCaps({ "performance.compare": ["all_in_scope"] }));
    const entry = (id: string, name: string, total: number, rank: number) => ({ subject: { id, name }, total, status: "provisional", band: null, model: "Employee v1", rank, percentile: 50, zScore: null, isYou: false, context: { tenureDays: 120, teamSize: 5, taskLoad: 12, dataCoverage: 0.7, confidence: "medium", evidence: 1 } });
    const result = { period: { id: "p1", name: "Q4 2026", status: "open" }, roleFamily: { id: "f1", name: "Engineers" }, filters: { departmentId: null, minTenureDays: 30, includeInsufficient: false, subjectIds: [] }, cohortSize: 5, excluded: { insufficient: 0, tenure: 0 }, normalization: "percentile", notes: ["A z-score needs at least 8 people, so only the rank and the percentile are shown."], you: null, entries: [entry("a", "Ann Engineer", 90, 1), entry("b", "Bob Engineer", 70, 2)], hiddenCount: 3, canSeeNames: true };
    const f = server([PERIOD], (url, init) => {
      if (url.startsWith("/api/performance/compare/difference")) return envelope({ period: { id: "p1", name: "Q4 2026" }, a: { id: "a", name: "Ann Engineer", total: 90 }, b: { id: "b", name: "Bob Engineer", total: 70 }, totalDifference: 20, parts: [{ key: "okr", label: "OKR achievement", a: 90, b: 70, contribution: 20, note: null }] });
      if (url.startsWith("/api/performance/compare?")) return envelope(result);
      if (url === "/api/performance/comparisons" && init?.method === "POST") return envelope({ id: "c1", name: "Engineers now", periodId: "p1", createdBy: { id: "x", name: "Owner" }, createdAt: "2026-11-23T10:00:00.000Z", cohortSize: 5, normalization: "percentile", result }, 201);
      if (url === "/api/performance/comparisons/c1") return envelope({ id: "c1", name: "Engineers now", periodId: "p1", createdBy: { id: "x", name: "Owner" }, createdAt: "2026-11-23T10:00:00.000Z", cohortSize: 5, normalization: "percentile", result });
      if (url === "/api/performance/comparisons") return envelope([{ id: "c1", name: "Engineers now", periodId: "p1", createdBy: { id: "x", name: "Owner" }, createdAt: "2026-11-23T10:00:00.000Z", cohortSize: 5, normalization: "percentile" }]);
      return undefined;
    });
    renderApp("/performance?tab=compare");
    const table = await screen.findByRole("table", { name: "People compared, highest first" });
    expect(within(table).getByText("Ann Engineer")).toBeTruthy();
    expect(within(table).getAllByText(/days in role/).length).toBe(2); // context beside the numbers
    expect(screen.getByText(/3 more people are in this group but outside what you may see/)).toBeTruthy();
    const group = await screen.findByRole("group", { name: "Pick two people" });
    await userEvent.selectOptions(within(group).getByLabelText("First person"), "a");
    await userEvent.selectOptions(within(group).getByLabelText("Second person"), "b");
    const diff = await screen.findByRole("region", { name: "Difference" });
    expect(within(diff).getAllByText("+20.0")).toHaveLength(2); // the gap, and the one part that makes it
    await userEvent.type(screen.getByLabelText("Save this comparison as"), "Engineers now");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(f.mock.calls.some((c) => c[0] === "/api/performance/comparisons" && (c[1] as RequestInit)?.method === "POST")).toBe(true));
    expect(bodyOf(f.mock.calls.find((c) => c[0] === "/api/performance/comparisons" && (c[1] as RequestInit)?.method === "POST")!)).toMatchObject({ name: "Engineers now", periodId: "p1", minTenureDays: 30, includeInsufficient: false });
    expect(await screen.findByText(/shown exactly as it was saved/)).toBeTruthy();
  });
});
