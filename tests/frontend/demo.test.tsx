// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { apiError, envelope, HEALTH_OK, json, ME_READY, renderApp, setMe, stubFetch, stubMatchMedia } from "./helpers";

beforeEach(() => stubMatchMedia(false));

const isGet = (init?: RequestInit) => (init?.method ?? "GET") === "GET";
const calls = (fn: ReturnType<typeof stubFetch>, path: string, method: string) => fn.mock.calls.filter((c) => String(c[0]).split("?")[0] === path && ((c[1] as RequestInit | undefined)?.method ?? "GET") === method);
const withCaps = (caps: Record<string, string[]>) => ({ ...ME_READY, roles: [{ key: "x", name: "Some Role" }], capabilities: caps });
const ADMIN = { "demo.manage": ["all_in_scope"], "org.manage": ["all_in_scope"], "people.manage": ["all_in_scope"] };

const NOT_LOADED = { loaded: false, loadedAt: null, counts: {}, realPeople: 1 };
const LOADED = { loaded: true, loadedAt: "2026-11-23T09:00:00.000Z", counts: { people: 64, departments: 6, teams: 12, designations: 24, tasks: 150 }, realPeople: 1 };
const PERSONAS = [
  { id: "d1", name: "Carla Chief", designation: "Chief Executive Officer", department: "Executive", roles: ["CEO"], group: "leadership" },
  { id: "d2", name: "Victor Platform", designation: "Vice President", department: "Engineering", roles: ["Department Head"], group: "heads" },
  { id: "d3", name: "Mia Lead", designation: "Support Lead", department: "Customer Success", roles: ["Manager"], group: "managers" },
  { id: "d4", name: "Dev One", designation: "Software Engineer", department: "Engineering", roles: ["Employee"], group: "employees" },
];

describe("Settings → Demo data (stage 2.8)", () => {
  it("not loaded: asks first, loads, and says what was loaded", async () => {
    setMe(withCaps(ADMIN));
    let loaded = false;
    const f = stubFetch((url, init) => {
      if (url === "/api/demo/status") return envelope(loaded ? LOADED : NOT_LOADED);
      if (url === "/api/demo/load" && init?.method === "POST") { loaded = true; return envelope(LOADED, 201); }
      if (url === "/api/demo/personas") return envelope(PERSONAS);
      return json(HEALTH_OK);
    });
    renderApp("/settings/demo");
    expect(await screen.findByText("Not loaded")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Load demo data/ }));
    expect(calls(f, "/api/demo/load", "POST")).toHaveLength(0); // it asks first
    expect(screen.getByText(/adds about 60 fictional people/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Yes, load demo data" }));
    expect(await screen.findByText(/Demo data loaded: 64 people, 6 departments, 12 teams and 150 tasks/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Demo data loaded", { selector: "span" })).toBeTruthy());
  });

  it("loaded: lists the demo people to view as, grouped, and shows the counts", async () => {
    setMe(withCaps(ADMIN));
    stubFetch((url) => (url === "/api/demo/status" ? envelope(LOADED) : url === "/api/demo/personas" ? envelope(PERSONAS) : json(HEALTH_OK)));
    renderApp("/settings/demo");
    expect(await screen.findByText("Company leadership")).toBeTruthy();
    expect(screen.getByText("Department heads")).toBeTruthy();
    expect(screen.getByText("Managers and team leads")).toBeTruthy();
    expect(screen.getByText("Employees")).toBeTruthy();
    expect(screen.getByRole("button", { name: "View as Carla Chief" })).toBeTruthy();
    expect(screen.getByText("64")).toBeTruthy();
  });

  it("viewing as a person shows the banner on every page and Stop viewing brings the administrator back", async () => {
    setMe(withCaps(ADMIN));
    const viewing = { ...withCaps({ "okr.view": ["own"] }), user: { id: "d1", email: "carla@x.invalid", name: "Carla Chief" }, viewingAs: { personName: "Carla Chief", adminName: "Ada Lovelace" } };
    const f = stubFetch((url, init) => {
      if (url === "/api/demo/status") return envelope(LOADED);
      if (url === "/api/demo/personas") return envelope(PERSONAS);
      if (url === "/api/demo/view-as/d1" && init?.method === "POST") return envelope({ viewingAs: "Carla Chief", me: viewing });
      if (url === "/api/demo/stop-viewing" && init?.method === "POST") return envelope({ ...ME_READY, capabilities: ADMIN });
      return json(HEALTH_OK);
    });
    renderApp("/settings/demo");
    await userEvent.click(await screen.findByRole("button", { name: "View as Carla Chief" }));
    const banner = await screen.findByText(/This view is read only/);
    expect(banner.textContent).toContain("Carla Chief");
    await userEvent.click(screen.getByRole("button", { name: "Stop viewing" }));
    await waitFor(() => expect(calls(f, "/api/demo/stop-viewing", "POST")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText(/This view is read only/)).toBeNull());
  });

  it("a removal refused because real data points at demo data lists what to fix", async () => {
    setMe(withCaps(ADMIN));
    stubFetch((url, init) => {
      if (url === "/api/demo/status") return envelope(LOADED);
      if (url === "/api/demo/personas") return envelope(PERSONAS);
      if (url === "/api/demo/remove" && init?.method === "POST") return apiError(409, "demo_blocked", "Demo data cannot be removed yet: some of your own data still points at it. Nothing was changed.", { blockers: [{ kind: "tasks", count: 2, message: "2 of your own tasks are assigned to, created by or linked to demo people or teams. Reassign or delete them first." }] });
      return json(HEALTH_OK);
    });
    renderApp("/settings/demo");
    await userEvent.click(await screen.findByRole("button", { name: /Remove demo data/ }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, remove demo data" }));
    const list = await screen.findByRole("list", { name: "Blockers" });
    expect(within(list).getByText(/2 of your own tasks are assigned to/)).toBeTruthy();
    expect((await screen.findByRole("alert")).textContent).toContain("Nothing was changed");
  });

  it("removing says your own data was not touched", async () => {
    setMe(withCaps(ADMIN));
    let loaded = true;
    stubFetch((url, init) => {
      if (url === "/api/demo/status") return envelope(loaded ? LOADED : NOT_LOADED);
      if (url === "/api/demo/personas") return envelope(PERSONAS);
      if (url === "/api/demo/remove" && init?.method === "POST") { loaded = false; return envelope(NOT_LOADED); }
      return json(HEALTH_OK);
    });
    renderApp("/settings/demo");
    await userEvent.click(await screen.findByRole("button", { name: /Remove demo data/ }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, remove demo data" }));
    expect(await screen.findByText(/Your own data was not touched/)).toBeTruthy();
  });

  it("without demo.manage the page is not available", async () => {
    setMe(withCaps({ "okr.view": ["own"] }));
    stubFetch(() => json(HEALTH_OK));
    renderApp("/settings/demo");
    expect(await screen.findByText("You do not have access to this page")).toBeTruthy();
  });
});

const OVERVIEW = (over: Record<string, unknown> = {}) => ({
  today: "2026-11-23", preset: "executive",
  personal: { open: 3, overdue: 1, dueToday: 1, blocked: 0, completedRecently: 2, unreadNotifications: 2, next: { id: "t1", title: "Send the invoice", reasons: ["Overdue by 3 days"] } },
  team: null,
  organization: {
    people: 65, departments: 6, teams: 12, tasksByStatus: { not_started: 30, in_progress: 40, completed: 70, blocked: 5 }, overdueTasks: 12, openTasks: 75,
    completedByDay: Array.from({ length: 14 }, (_, i) => ({ date: `2026-11-${String(10 + i).padStart(2, "0")}`, count: i % 4 })),
    departmentLoad: [{ id: "d1", name: "Engineering", people: 22, open: 30, overdue: 4 }, { id: "d2", name: "Sales", people: 12, open: 18, overdue: 0 }],
  },
  checklist: [
    { key: "departments", label: "Create departments", to: "/settings/structure", done: true, stage: null },
    { key: "people", label: "Add or invite people", to: "/organization/people", done: true, stage: null },
    { key: "reporting", label: "Set reporting lines", to: "/organization", done: true, stage: null },
    { key: "objective", label: "Create a company objective", to: "/okrs", done: false, stage: "3.1" },
    { key: "kpi", label: "Define KPIs", to: "/kpis", done: false, stage: "3.3" },
    { key: "tasks", label: "Assign tasks", to: "/my-work", done: true, stage: null },
  ],
  flags: { demoLoaded: true, canManageDemo: true, canSetUp: true }, ...over,
});

describe("Overview (stage 6.1)", () => {
  it("an executive sees their work, the organization's numbers and charts, and the checklist ticked by real data", async () => {
    setMe(withCaps(ADMIN));
    stubFetch((url) => (url === "/api/overview" ? envelope(OVERVIEW()) : json(HEALTH_OK)));
    renderApp("/overview");
    expect(await screen.findByText("Your work")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Send the invoice" })).toBeTruthy();
    expect(screen.getByText("Overdue by 3 days")).toBeTruthy();
    expect(screen.getByText("Tasks by status")).toBeTruthy();
    expect(screen.getByRole("img", { name: /Tasks by status: 30 not started, 40 in progress, 5 blocked, 70 completed/ })).toBeTruthy();
    expect(screen.getByRole("img", { name: /Tasks completed per day, last 14 days/ })).toBeTruthy();
    const loads = screen.getByRole("list", { name: "Department workload" });
    expect(within(loads).getByText(/30 open, 4 overdue/)).toBeTruthy();
    const ring = screen.getByRole("progressbar", { name: "Getting started steps done" });
    expect(ring.getAttribute("aria-valuenow")).toBe("4");
    expect(screen.getAllByText(/^Done:/, { selector: "span" })).toHaveLength(4);
    // the chart can be read as a table
    await userEvent.click(screen.getByRole("button", { name: "View as table" }));
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.queryByRole("img", { name: /Tasks completed per day/ })).toBeNull();
  });

  it("an employee sees only their own work: no team, no organization widgets, and no checklist once everything is done", async () => {
    setMe(withCaps({ "task.view": ["own"] }));
    stubFetch((url) => (url === "/api/overview" ? envelope(OVERVIEW({ preset: "personal", organization: null, flags: { demoLoaded: true, canManageDemo: false, canSetUp: false }, checklist: OVERVIEW().checklist.map((c) => ({ ...c, done: true })) })) : json(HEALTH_OK)));
    renderApp("/overview");
    expect(await screen.findByText("Your work")).toBeTruthy();
    expect(screen.queryByText("Tasks by status")).toBeNull();
    expect(screen.queryByText("Getting started")).toBeNull();
  });

  it("a manager sees the team widget with who needs attention", async () => {
    setMe(withCaps({ "task.view": ["reports"] }));
    stubFetch((url) => (url === "/api/overview" ? envelope(OVERVIEW({ preset: "team", organization: null, flags: { demoLoaded: true, canManageDemo: false, canSetUp: false }, team: { label: "Your people", people: 4, openTasks: 11, overdueTasks: 3, blockedTasks: 1, completedRecently: 6, needsAttention: [{ id: "p1", name: "Emma Employee", overdue: 2, blocked: 1 }] } })) : json(HEALTH_OK)));
    renderApp("/overview");
    expect(await screen.findByText("Your people")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Emma Employee" }).getAttribute("href")).toBe("/organization/people?person=p1");
    expect(screen.getByText("2 overdue")).toBeTruthy();
  });

  it("an empty organization shows the demo offer to someone who may load it, and nothing is claimed as done", async () => {
    setMe(withCaps(ADMIN));
    stubFetch((url) => (url === "/api/overview" ? envelope(OVERVIEW({ checklist: OVERVIEW().checklist.map((c) => ({ ...c, done: false })), flags: { demoLoaded: false, canManageDemo: true, canSetUp: true }, organization: { people: 1, departments: 0, teams: 0, tasksByStatus: {}, overdueTasks: 0, openTasks: 0, completedByDay: Array.from({ length: 14 }, (_, i) => ({ date: `2026-11-${10 + i}`, count: 0 })), departmentLoad: [] } })) : json(HEALTH_OK)));
    renderApp("/overview");
    expect(await screen.findByText("See Zentro with a whole company in it")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Load demo data" }).getAttribute("href")).toBe("/settings/demo");
    expect(screen.getByText(/There are no tasks yet/)).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Getting started steps done" }).getAttribute("aria-valuenow")).toBe("0");
  });

  it("when the numbers cannot be loaded it says so and claims nothing", async () => {
    setMe(withCaps(ADMIN));
    stubFetch((url) => (url === "/api/overview" ? apiError(500, "internal_error", "Something went wrong") : json(HEALTH_OK)));
    renderApp("/overview");
    expect((await screen.findByRole("alert")).textContent).toContain("could not be loaded");
    expect(screen.getByRole("progressbar", { name: "Getting started steps done" }).getAttribute("aria-valuenow")).toBe("0");
  });
});
