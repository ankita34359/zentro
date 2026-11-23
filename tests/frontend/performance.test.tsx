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
});
