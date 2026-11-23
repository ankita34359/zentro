// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { envelope, HEALTH_OK, json, ME_READY, renderApp, setMe, stubFetch, stubMatchMedia } from "./helpers";

beforeEach(() => stubMatchMedia(false));

const isGet = (init?: RequestInit) => (init?.method ?? "GET") === "GET";
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));
const withCaps = (caps: Record<string, string[]>) => ({ ...ME_READY, roles: [{ key: "x", name: "Some Role" }], capabilities: caps });
const ALL = { "okr.view": ["all_in_scope"], "okr.create": ["all_in_scope"], "okr.edit": ["all_in_scope"], "okr.update_progress": ["all_in_scope"], "okr.publish": ["all_in_scope"], "okr.archive": ["all_in_scope"], "task.view": ["all_in_scope"] };

const KR = (over: Record<string, unknown> = {}) => ({
  id: "k1", title: "Signed deals", description: "", measurementType: "number", unit: "deals", direction: "increase", method: "linear", startValue: 0, targetValue: 10, currentValue: null, currentAsOf: null,
  weight: 1, owner: null, dueDate: null, attainmentPct: null, regressed: false, capped: false, degenerate: false, isDemo: false, ...over,
});
const OBJ = (over: Record<string, unknown> = {}) => ({
  id: "o1", title: "Win more customers", level: "company", objectiveType: "strategic", priority: "high", lifecycle: "active", visibility: "scope", published: false, startDate: "2026-01-01", endDate: "2026-12-31", weight: 1,
  owner: null, department: null, team: null, keyResultCount: 1, attainmentPct: null, dataState: "none", coveragePct: 0, elapsedPct: 90, archived: false, isDemo: false, ...over,
});
const DETAIL = (over: Record<string, unknown> = {}) => ({
  ...OBJ(), description: "Grow the base", createdBy: { id: "m1", name: "Ada Lovelace" }, keyResults: [KR()],
  can: { edit: true, updateProgress: true, publish: true, archive: true, addKeyResults: true }, nextLifecycles: ["draft", "completed", "cancelled"], tasks: { total: 0, open: 0 }, ...over,
});
const server = (extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined) =>
  stubFetch((url, init) => {
    const special = extra(url, init);
    if (special) return special;
    const path = url.split("?")[0];
    if (path === "/api/objectives" && isGet(init)) return envelope([OBJ()]);
    if (path === "/api/objectives/o1" && isGet(init)) return envelope(DETAIL());
    if (path === "/api/objectives/o1/history") return envelope([]);
    if (path === "/api/tasks") return envelope({ tasks: [], total: 0, limit: 50, offset: 0 });
    if (path === "/api/notifications") return envelope({ notifications: [], unreadCount: 0, nextCursor: null });
    return json(HEALTH_OK);
  });

describe("OKRs & Goals page (stage 3.1)", () => {
  it("lists objectives and says 'No data yet' (not 0%) for one with nothing recorded", async () => {
    setMe(withCaps(ALL));
    server();
    renderApp("/okrs");
    const list = await screen.findByRole("list", { name: "Objective list" });
    const card = within(list).getByRole("button", { name: "Open objective: Win more customers" });
    expect(within(card).getByText("No data yet")).toBeTruthy();
    expect(within(card).queryByText("0%")).toBeNull();
    expect(within(card).getByText("90% of the time has passed")).toBeTruthy();
  });

  it("opens an objective, and recording an actual value sends it to the server and shows the server's word on a refusal", async () => {
    setMe(withCaps(ALL));
    const f = server((url, init) => {
      if (url === "/api/key-results/k1/progress" && init?.method === "POST") return envelope(DETAIL({ attainmentPct: 40, keyResults: [KR({ currentValue: 4, attainmentPct: 40 })] }), 201);
      return undefined;
    });
    renderApp("/okrs?objective=o1");
    const panel = await screen.findByRole("dialog");
    expect(await within(panel).findByText("Signed deals")).toBeTruthy();
    expect(within(panel).getByText("Nothing recorded")).toBeTruthy();
    const form = within(panel).getByRole("form", { name: "Record a value for Signed deals" });
    await userEvent.type(within(form).getByLabelText(/Actual value/), "4");
    await userEvent.click(within(form).getByRole("button", { name: "Record" }));
    await waitFor(() => expect(f.mock.calls.some((c) => c[0] === "/api/key-results/k1/progress")).toBe(true));
    expect(bodyOf(f.mock.calls.find((c) => c[0] === "/api/key-results/k1/progress")!)).toEqual({ value: 4 });
    expect(await within(panel).findByText("Value recorded.")).toBeTruthy();
  });

  it("a person who may only view sees no recording form and no manage buttons", async () => {
    setMe(withCaps({ "okr.view": ["all_in_scope"], "task.view": ["own"] }));
    server((url) => (url === "/api/objectives/o1" ? envelope(DETAIL({ can: { edit: false, updateProgress: false, publish: false, archive: false, addKeyResults: false } })) : undefined));
    renderApp("/okrs?objective=o1");
    const panel = await screen.findByRole("dialog");
    await within(panel).findByText("Signed deals");
    expect(within(panel).queryByRole("form", { name: /Record a value/ })).toBeNull();
    expect(within(panel).queryByRole("group", { name: "Move to" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /Add a key result/ })).toBeNull();
  });

  it("a person without okr.view cannot open the page (and nothing about objectives is requested)", async () => {
    setMe(withCaps({ "task.view": ["own"] }));
    const f = server();
    renderApp("/okrs");
    await screen.findByRole("heading", { name: "You do not have access to this page" });
    expect(f.mock.calls.some((c) => String(c[0]).startsWith("/api/objectives"))).toBe(false);
  });

  it("creating an objective checks the form first, then sends the key results with their numbers", async () => {
    setMe(withCaps(ALL));
    const f = server((url, init) => {
      if (url === "/api/organization/structure") return envelope({ departments: [], teams: [], roleFamilies: [], designations: [], organization: { id: "org", name: "Acme" } });
      if (url === "/api/objectives" && init?.method === "POST") return envelope(DETAIL(), 201);
      return undefined;
    });
    renderApp("/okrs");
    await userEvent.click(await screen.findByRole("button", { name: "New objective" }));
    const form = await screen.findByRole("form", { name: "New objective" });
    await userEvent.selectOptions(within(form).getByLabelText("Level"), "company");
    await userEvent.click(within(form).getByRole("button", { name: "Create objective" }));
    expect(await within(form).findByText("Give the objective a title")).toBeTruthy();
    await userEvent.type(within(form).getByLabelText("Title"), "Win more customers");
    await userEvent.type(within(form).getByLabelText("Key result 1"), "Signed deals");
    await userEvent.type(within(form).getByLabelText("To"), "10");
    await userEvent.click(within(form).getByRole("button", { name: "Create objective" }));
    await waitFor(() => expect(f.mock.calls.some((c) => c[0] === "/api/objectives" && (c[1] as RequestInit | undefined)?.method === "POST")).toBe(true));
    const sent = bodyOf(f.mock.calls.find((c) => c[0] === "/api/objectives" && (c[1] as RequestInit | undefined)?.method === "POST")!);
    expect(sent).toMatchObject({ level: "company", title: "Win more customers", keyResults: [{ title: "Signed deals", direction: "increase", startValue: 0, targetValue: 10 }] });
  });
});
