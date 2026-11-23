// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { envelope, HEALTH_OK, json, ME_READY, renderApp, setMe, stubFetch, stubMatchMedia } from "./helpers";

beforeEach(() => stubMatchMedia(false));

const isGet = (init?: RequestInit) => (init?.method ?? "GET") === "GET";
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));
const withCaps = (caps: Record<string, string[]>) => ({ ...ME_READY, roles: [{ key: "x", name: "Some Role" }], capabilities: caps });
const ALL = { "kpi.view": ["all_in_scope"], "kpi.configure": ["all_in_scope"], "kpi.assign": ["all_in_scope"], "kpi.record": ["all_in_scope"] };

const KPI = (over: Record<string, unknown> = {}) => ({
  id: "k1", key: "qualified-leads", name: "Qualified leads", description: "Leads that passed qualification", category: "growth", unit: "leads", valueType: "number", direction: "higher_is_better", frequency: "monthly", aggregation: "sum",
  defaultTarget: 40, defaultTargetMax: null, archived: false, isDemo: false, assignmentCount: 1, ...over,
});
const DETAIL = (over: Record<string, unknown> = {}) => ({
  ...KPI(), assignments: [{ id: "a1", subject: { kind: "role_family", id: "f1", name: "Sales" }, targetValue: 40, targetMax: null, weight: 1, effectiveFrom: "2026-01-01", effectiveTo: null, active: true, appliesTo: 12 }],
  thresholds: [{ id: "t1", level: "critical", comparator: "lt", basis: "percent_of_target", value: 50, notify: true }, { id: "t2", level: "warning", comparator: "lt", basis: "percent_of_target", value: 80, notify: true }],
  can: { configure: true, assign: true, record: true }, ...over,
});
const HISTORY = {
  kpi: { id: "k1", name: "Qualified leads", unit: "leads", frequency: "monthly", direction: "higher_is_better", aggregation: "sum" },
  subject: { kind: "person", id: "p1", name: "Ann Seller" }, target: { targetValue: 40, targetMax: null, weight: 1 },
  lines: [{ level: "warning", comparator: "lt", value: 32 }, { level: "critical", comparator: "lt", value: 20 }],
  periods: [
    { start: "2026-08-01", end: "2026-08-31", label: "Aug 2026", state: "recorded", value: 42, valueStatus: "recorded", attainmentPct: 100, level: null, corrections: 0, rows: [{ id: "r1", value: 42, valueStatus: "recorded", recordedAt: "2026-09-02T10:00:00Z", recordedBy: { id: "m", name: "Max Manager" }, source: "manual", note: null, current: true, supersedes: null }] },
    { start: "2026-09-01", end: "2026-09-30", label: "Sep 2026", state: "missing", value: null, valueStatus: null, attainmentPct: null, level: null, corrections: 0, rows: [] },
    { start: "2026-10-01", end: "2026-10-31", label: "Oct 2026", state: "recorded", value: 39, valueStatus: "recorded", attainmentPct: 98, level: null, corrections: 1, rows: [{ id: "r2", value: 38, valueStatus: "recorded", recordedAt: "2026-11-02T10:00:00Z", recordedBy: { id: "m", name: "Max Manager" }, source: "manual", note: null, current: false, supersedes: null }, { id: "r3", value: 39, valueStatus: "recorded", recordedAt: "2026-11-03T10:00:00Z", recordedBy: { id: "m", name: "Max Manager" }, source: "manual", note: "Two leads were counted twice", current: true, supersedes: "r2" }] },
    { start: "2026-11-01", end: "2026-11-30", label: "Nov 2026", state: "open", value: null, valueStatus: null, attainmentPct: null, level: null, corrections: 0, rows: [] },
  ],
  expected: 3, present: 2, missingCount: 1, coveragePct: 67, status: "ok", can: { record: true },
};
const OVERVIEW = {
  totals: { series: 3, byStatus: { critical: 1, ok: 2 }, missingPeriods: 4, kpis: 1 },
  kpis: [{ id: "k1", name: "Qualified leads", category: "growth", frequency: "monthly", series: 3, byStatus: { critical: 1, ok: 2 }, missingPeriods: 4, coveragePct: 78 }],
  attention: [{ kpiId: "k1", kpiName: "Qualified leads", subject: { kind: "person", id: "p1", name: "Ann Seller" }, status: "critical", label: "Oct 2026: 12 leads", value: 12, missing: 1 }],
};
const server = (extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined) =>
  stubFetch((url, init) => {
    const special = extra(url, init);
    if (special) return special;
    const path = url.split("?")[0];
    if (path === "/api/kpis" && isGet(init)) return envelope([KPI()]);
    if (path === "/api/kpis/k1" && isGet(init)) return envelope(DETAIL());
    if (path === "/api/kpis/k1/subjects") return envelope([{ subject: { kind: "person", id: "p1", name: "Ann Seller" }, status: "warning", missing: 1, latest: "Oct 2026: 30", canRecord: true }]);
    if (path === "/api/kpis/k1/history") return envelope(HISTORY);
    if (path === "/api/kpis/overview") return envelope(OVERVIEW);
    if (path === "/api/organization/structure") return envelope({ departments: [], teams: [], roleFamilies: [{ id: "f1", name: "Sales", description: "", archived: false, archivedAt: null }], designations: [], organization: { id: "o", name: "Acme" } });
    if (path === "/api/employees") return envelope({ people: [], total: 0, limit: 500, offset: 0 });
    if (path === "/api/notifications") return envelope({ notifications: [], unreadCount: 0, nextCursor: null });
    return json(HEALTH_OK);
  });

describe("KPIs page (stage 3.3)", () => {
  it("lists KPIs with a sentence about each, and a person without kpi.view cannot open the page", async () => {
    setMe(withCaps(ALL));
    server();
    renderApp("/kpis");
    const list = await screen.findByRole("list", { name: "KPIs" });
    const card = within(list).getByRole("button", { name: "Open KPI: Qualified leads" });
    expect(within(card).getByText("Monthly · Higher is better · target 40 leads")).toBeTruthy();
    expect(within(card).getByText("1 active assignment")).toBeTruthy();
  });

  it("shows who has the KPI with the target and how many people it covers, and the thresholds in words", async () => {
    setMe(withCaps(ALL));
    server();
    renderApp("/kpis?kpi=k1");
    const panel = await screen.findByRole("dialog");
    const targets = await within(panel).findByRole("region", { name: "Who has this KPI" });
    expect(within(targets).getByText(/Sales/)).toBeTruthy();
    expect(within(targets).getByText(/covers 12 people/)).toBeTruthy();
    expect(within(targets).getByText(/Target 40 leads · weight 1/)).toBeTruthy();
    const th = within(panel).getByRole("region", { name: "Thresholds" });
    expect(within(th).getAllByText(/Warning/).length).toBeGreaterThan(0);
    expect(within(th).getAllByText(/is below 80% of the target/).length).toBeGreaterThan(0);
  });

  it("assigning sends the subject and the target the person typed; a read-only viewer sees no forms", async () => {
    setMe(withCaps(ALL));
    const f = server((url, init) => (url === "/api/kpis/k1/assignments" && init?.method === "POST" ? envelope(DETAIL(), 201) : undefined));
    renderApp("/kpis?kpi=k1");
    const panel = await screen.findByRole("dialog");
    const form = await within(panel).findByRole("form", { name: "Assign this KPI" });
    await within(form).findByRole("option", { name: "Sales" });
    await userEvent.selectOptions(within(form).getByLabelText("Give it to"), "role_family:f1");
    await userEvent.type(within(form).getByLabelText("Target"), "45");
    await userEvent.click(within(form).getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(f.mock.calls.some((c) => c[0] === "/api/kpis/k1/assignments" && (c[1] as RequestInit | undefined)?.method === "POST")).toBe(true));
    expect(bodyOf(f.mock.calls.find((c) => c[0] === "/api/kpis/k1/assignments" && (c[1] as RequestInit | undefined)?.method === "POST")!)).toEqual({ roleFamilyId: "f1", targetValue: 45, weight: 1 });
  });

  it("a viewer who may not configure or assign sees the facts only", async () => {
    setMe(withCaps({ "kpi.view": ["own"] }));
    server((url) => (url === "/api/kpis/k1" ? envelope(DETAIL({ can: { configure: false, assign: false, record: false } })) : undefined));
    renderApp("/kpis?kpi=k1");
    const panel = await screen.findByRole("dialog");
    await within(panel).findByRole("region", { name: "Who has this KPI" });
    expect(within(panel).queryByRole("form", { name: "Assign this KPI" })).toBeNull();
    expect(within(panel).queryByRole("form", { name: "Set thresholds" })).toBeNull();
    expect(within(panel).queryByRole("region", { name: "Manage this KPI" })).toBeNull();
  });

  it("creating a KPI checks the form, then sends it", async () => {
    setMe(withCaps(ALL));
    const f = server((url, init) => (url === "/api/kpis" && init?.method === "POST" ? envelope(DETAIL(), 201) : undefined));
    renderApp("/kpis");
    await userEvent.click(await screen.findByRole("button", { name: "New KPI" }));
    const form = await screen.findByRole("form", { name: "New KPI" });
    await userEvent.click(within(form).getByRole("button", { name: "Create KPI" }));
    expect(await within(form).findByText("Give the KPI a name")).toBeTruthy();
    await userEvent.type(within(form).getByLabelText("Name"), "Qualified leads");
    await userEvent.type(within(form).getByLabelText("Default target (optional)"), "40");
    await userEvent.click(within(form).getByRole("button", { name: "Create KPI" }));
    await waitFor(() => expect(f.mock.calls.some((c) => c[0] === "/api/kpis" && (c[1] as RequestInit | undefined)?.method === "POST")).toBe(true));
    expect(bodyOf(f.mock.calls.find((c) => c[0] === "/api/kpis" && (c[1] as RequestInit | undefined)?.method === "POST")!)).toMatchObject({ name: "Qualified leads", frequency: "monthly", direction: "higher_is_better", defaultTarget: 40 });
  });

  it("shows a missing period as a gap and '1 missing', never as zero, and lists the correction with its reason", async () => {
    setMe(withCaps(ALL));
    server();
    renderApp("/kpis?kpi=k1");
    const panel = await screen.findByRole("dialog");
    const section = await within(panel).findByRole("region", { name: "Measurements" });
    expect(await within(section).findByText(/2 of 3 periods have a value/)).toBeTruthy();
    expect(within(section).getByText("1 missing")).toBeTruthy();
    const periods = within(section).getByRole("list", { name: "Periods" });
    const sep = within(periods).getByText("Sep 2026").closest("li")!;
    expect(within(sep).getByText("Missing")).toBeTruthy();
    expect(within(sep).queryByText("0")).toBeNull();
    expect(within(periods).getByText("Nov 2026").closest("li")!.textContent).toContain("Not yet recorded");
    const oct = within(periods).getByText("Oct 2026").closest("li")!;
    await userEvent.click(within(oct).getByRole("button", { name: "1 correction" }));
    expect(within(oct).getByText(/Two leads were counted twice/)).toBeTruthy();
    expect(within(oct).getByText(/\(replaced\)/)).toBeTruthy();
    expect(within(oct).getByText(/\(current\)/)).toBeTruthy();
    // the chart has a text equivalent that says what is missing
    expect(within(section).getByRole("img").getAttribute("aria-label")).toMatch(/Sep 2026 missing/);
    await userEvent.click(within(section).getByRole("button", { name: "View as table" }));
    expect(within(within(section).getByRole("table")).getByText("Missing")).toBeTruthy();
  });

  it("recording picks the missing period first, sends the value, and a period that already has one becomes a correction that needs a reason", async () => {
    setMe(withCaps(ALL));
    const f = server((url, init) => (url === "/api/kpis/k1/measurements" && init?.method === "POST" ? envelope(HISTORY, 201) : undefined));
    renderApp("/kpis?kpi=k1");
    const panel = await screen.findByRole("dialog");
    const form = await within(panel).findByRole("form", { name: "Record a value" });
    expect((within(form).getByLabelText("Period") as HTMLSelectElement).value).toBe("2026-09-01"); // the missing one
    await userEvent.type(within(form).getByLabelText("Value (leads)"), "35");
    await userEvent.click(within(form).getByRole("button", { name: "Record" }));
    await waitFor(() => expect(f.mock.calls.some((c) => c[0] === "/api/kpis/k1/measurements")).toBe(true));
    expect(bodyOf(f.mock.calls.find((c) => c[0] === "/api/kpis/k1/measurements")!)).toEqual({ subject: { type: "person", id: "p1" }, periodStart: "2026-09-01", value: 35, valueStatus: "recorded" });
    // now choose a period that already has a value
    await userEvent.selectOptions(within(form).getByLabelText("Period"), "2026-10-01");
    const fix = await within(panel).findByRole("form", { name: "Correct a value" });
    await userEvent.type(within(fix).getByLabelText("Value (leads)"), "40");
    await userEvent.click(within(fix).getByRole("button", { name: "Save the correction" }));
    expect(await within(fix).findByText("Say why the value is being corrected")).toBeTruthy();
    await userEvent.type(within(fix).getByLabelText("Why it is corrected"), "Recount");
    await userEvent.click(within(fix).getByRole("button", { name: "Save the correction" }));
    await waitFor(() => expect(f.mock.calls.filter((c) => c[0] === "/api/kpis/k1/measurements")).toHaveLength(2));
    expect(bodyOf(f.mock.calls.filter((c) => c[0] === "/api/kpis/k1/measurements")[1]!)).toMatchObject({ periodStart: "2026-10-01", value: 40, note: "Recount", supersedes: "r3" });
  });

  it("someone who may not record sees the values but no form", async () => {
    setMe(withCaps({ "kpi.view": ["own"] }));
    server((url) => (url.startsWith("/api/kpis/k1/history") ? envelope({ ...HISTORY, can: { record: false } }) : undefined));
    renderApp("/kpis?kpi=k1");
    const panel = await screen.findByRole("dialog");
    await within(panel).findByRole("list", { name: "Periods" });
    expect(within(panel).queryByRole("form", { name: /Record a value|Correct a value/ })).toBeNull();
  });

  it("the Overview tab counts series by status and lists who needs attention", async () => {
    setMe(withCaps(ALL));
    server();
    renderApp("/kpis?view=overview");
    const attention = await screen.findByRole("region", { name: "Needs attention" });
    expect(within(attention).getByText(/Ann Seller/)).toBeTruthy();
    expect(within(attention).getByText("Critical")).toBeTruthy();
    expect(within(attention).getByText("1 missing")).toBeTruthy();
    const tiles = screen.getByLabelText("Series by status");
    expect(within(tiles).getByText("Measured series").nextSibling?.textContent).toBe("3");
    expect(screen.getByText(/4 measurement periods are missing/)).toBeTruthy();
  });
});
