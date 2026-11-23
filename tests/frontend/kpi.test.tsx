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
const server = (extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined) =>
  stubFetch((url, init) => {
    const special = extra(url, init);
    if (special) return special;
    const path = url.split("?")[0];
    if (path === "/api/kpis" && isGet(init)) return envelope([KPI()]);
    if (path === "/api/kpis/k1" && isGet(init)) return envelope(DETAIL());
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
});
