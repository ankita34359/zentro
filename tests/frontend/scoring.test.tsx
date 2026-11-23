// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { envelope, HEALTH_OK, json, ME_READY, renderApp, setMe, stubFetch, stubMatchMedia } from "./helpers";

beforeEach(() => stubMatchMedia(false));
const isGet = (init?: RequestInit) => (init?.method ?? "GET") === "GET";
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));
const withCaps = (caps: Record<string, string[]>) => ({ ...ME_READY, roles: [{ key: "x", name: "Some Role" }], capabilities: caps });
const ALL = { "performance.view_components": ["all_in_scope"], "performance.configure": ["all_in_scope"] };

const COMPONENTS = [
  { key: "okr", label: "OKR achievement", weight: 40, providerKey: "okr.attainment", minSample: 1, config: {}, sortOrder: 0 },
  { key: "kpi", label: "KPI achievement", weight: 30, providerKey: "kpi.attainment", minSample: 1, config: {}, sortOrder: 1 },
  { key: "delivery", label: "Delivery and reliability", weight: 15, providerKey: "tasks.delivery", minSample: 5, config: {}, sortOrder: 2 },
  { key: "quality", label: "Quality and business impact", weight: 15, providerKey: "quality.impact", minSample: 1, config: {}, sortOrder: 3 },
];
const MODEL = (over: Record<string, unknown> = {}) => ({ id: "m1", name: "Employee", templateKey: "model_employee", version: 1, status: "active", roleFamily: null, designation: null, isDefault: true, minWeightCoverage: 0.6, minConfidenceForFinal: 0.6, bands: [], components: COMPONENTS, weightTotal: 100, isDemo: false, problems: [], ...over });
const RESULT = (over: Record<string, unknown> = {}) => ({
  total: 86.5, status: "final", weightCoverage: 1, confidence: 0.9,
  components: COMPONENTS.map((c, i) => ({ key: c.key, label: c.label, providerKey: c.providerKey, weight: c.weight / 100, state: "ok", score: [85, 90, 80, 90][i], rawValue: [85, 90, 80, 90][i], effectiveWeight: c.weight / 100, points: ([85, 90, 80, 90][i] ?? 0) * c.weight / 100, sampleSize: 5, minSample: 1, coverage: 1, contributors: [], notes: [] })),
  explanation: { formula: "(85.0 × 0.40) + (90.0 × 0.30) + (80.0 × 0.15) + (90.0 × 0.15) = 86.5", status: "final", band: "On target", confidence: { value: 0.9, label: "high", parts: { coverage: 1, sample: 1, evidence: 1 } }, components: [], reasons: [], dataQuality: [], whatWouldChangeThis: [], rounding: null }, ...over,
});
const server = (extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined) =>
  stubFetch((url, init) => {
    const special = extra(url, init);
    if (special) return special;
    const path = url.split("?")[0];
    if (path === "/api/performance/models" && isGet(init)) return envelope([MODEL(), MODEL({ id: "m2", name: "CEO", isDefault: false })]);
    if (path === "/api/performance/models/templates") return envelope([{ key: "model_employee", name: "Employee", description: "", components: [] }]);
    if (path === "/api/organization/structure") return envelope({ departments: [], teams: [], roleFamilies: [], designations: [], organization: { id: "o", name: "Acme" } });
    if (path === "/api/notifications") return envelope({ notifications: [], unreadCount: 0, nextCursor: null });
    return json(HEALTH_OK);
  });

describe("Settings → Scoring (stage 5.1)", () => {
  it("lists the models, shows what one measures with its weights adding up, and the what-if calculator sends the typed values (empty = no data)", async () => {
    setMe(withCaps(ALL));
    const f = server((url, init) => (url === "/api/performance/models/preview" && init?.method === "POST" ? envelope(RESULT()) : undefined));
    renderApp("/settings/scoring");
    const list = await screen.findByRole("region", { name: "Scoring models" });
    expect(within(list).getByRole("button", { name: "Open model: CEO version 1" })).toBeTruthy();
    await userEvent.click(within(list).getByRole("button", { name: "Open model: Employee version 1" }));
    const details = await screen.findByRole("region", { name: "Model details" });
    expect(within(details).getByText("100 of 100")).toBeTruthy();
    const calc = within(details).getByRole("form", { name: "What-if calculator" });
    await userEvent.type(within(calc).getByLabelText("OKR achievement (weight 40)"), "85");
    await userEvent.type(within(calc).getByLabelText("KPI achievement (weight 30)"), "90");
    await userEvent.type(within(calc).getByLabelText("Delivery and reliability (weight 15)"), "80");
    await userEvent.click(within(calc).getByRole("button", { name: "Calculate" }));
    await waitFor(() => expect(f.mock.calls.some((c) => c[0] === "/api/performance/models/preview")).toBe(true));
    expect(bodyOf(f.mock.calls.find((c) => c[0] === "/api/performance/models/preview")!)).toEqual({ modelId: "m1", values: { okr: 85, kpi: 90, delivery: 80, quality: null }, periodClosed: true });
    const result = await within(details).findByRole("status", { name: "Result" });
    expect(within(result).getByText("86.5")).toBeTruthy();
    expect(within(result).getByText(/\(85\.0 × 0\.40\)/)).toBeTruthy();
  });

  it("a missing part is shown as 'No data recorded', not as 0", async () => {
    setMe(withCaps(ALL));
    const missing = RESULT({ total: 85, status: "provisional", weightCoverage: 0.7 });
    (missing.components[1] as Record<string, unknown>).state = "missing";
    (missing.components[1] as Record<string, unknown>).score = null;
    (missing.components[1] as Record<string, unknown>).points = null;
    server((url, init) => (url === "/api/performance/models/preview" && init?.method === "POST" ? envelope(missing) : undefined));
    renderApp("/settings/scoring");
    await userEvent.click(await screen.findByRole("button", { name: "Open model: Employee version 1" }));
    await userEvent.click(await screen.findByRole("button", { name: "Calculate" }));
    const result = await screen.findByRole("status", { name: "Result" });
    expect(within(result).getByText("Provisional")).toBeTruthy();
    expect(within(result).getByText("No data recorded")).toBeTruthy();
    expect(within(result).getByText(/70% of the weight has data/)).toBeTruthy();
  });

  it("weights that do not add up to 100 are flagged as typed; a viewer without configure sees the model but no editing or calculator", async () => {
    setMe(withCaps(ALL));
    server();
    renderApp("/settings/scoring");
    await userEvent.click(await screen.findByRole("button", { name: "Open model: Employee version 1" }));
    const w = await screen.findByLabelText("Weight of OKR achievement");
    await userEvent.clear(w);
    await userEvent.type(w, "50");
    expect(screen.getByText("110 of 100")).toBeTruthy();
    expect(screen.getByText(/must add up to exactly 100/)).toBeTruthy();
  });

  it("without performance.configure there are no forms", async () => {
    setMe(withCaps({ "performance.view_components": ["reports"] }));
    server();
    renderApp("/settings/scoring");
    await userEvent.click(await screen.findByRole("button", { name: "Open model: Employee version 1" }));
    const details = await screen.findByRole("region", { name: "Model details" });
    expect(within(details).queryByRole("form", { name: "What-if calculator" })).toBeNull();
    expect(within(details).queryByRole("button", { name: /Start a new version|Save the draft|Activate/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "New model" })).toBeNull();
  });
});
