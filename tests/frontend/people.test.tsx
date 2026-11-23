// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { apiError, envelope, HEALTH_OK, json, ME_READY, renderApp, setMe, stubFetch, stubMatchMedia } from "./helpers";

beforeEach(() => stubMatchMedia(false));

const calls = (fn: ReturnType<typeof stubFetch>, path: string, method: string) => fn.mock.calls.filter((c) => String(c[0]).split("?")[0] === path && ((c[1] as RequestInit | undefined)?.method ?? "GET") === method);
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));

const item = { description: "", archived: false, archivedAt: null };
const STRUCTURE = {
  departments: [{ id: "d-eng", parentId: null, name: "Engineering", ...item }, { id: "d-sales", parentId: null, name: "Sales", ...item }],
  teams: [{ id: "t-core", departmentId: "d-eng", parentTeamId: null, name: "Core", ...item }, { id: "t-in", departmentId: "d-sales", parentTeamId: null, name: "Inside sales", ...item }],
  roleFamilies: [],
  designations: [{ id: "g-dev", roleFamilyId: null, name: "Developer", ...item }, { id: "g-lead", roleFamilyId: null, name: "Tech Lead", ...item }],
  limits: { maxDepth: 8 },
  partial: false,
};
const person = (id: string, displayName: string, extra: Record<string, unknown> = {}) => ({ id, displayName, status: "active", hasLogin: false, archived: false, designation: null, departments: [], teams: [], managers: [], email: null, ...extra });
const PEOPLE = [
  person("p-ann", "Ann Boss", { designation: { id: "g-lead", name: "Tech Lead" }, teams: [{ id: "t-core", name: "Core", type: "lead" }] }),
  person("p-bo", "Bo Dev", { designation: { id: "g-dev", name: "Developer" }, teams: [{ id: "t-core", name: "Core", type: "member" }], managers: [{ id: "p-ann", name: "Ann Boss", type: "primary" }] }),
];
const TREE_REPORTING = {
  view: "reporting", asOf: "2026-11-23", partial: false,
  nodes: [{ kind: "person", id: "p-ann", name: "Ann Boss", subtitle: "Tech Lead", detail: "Core", childCount: 2, children: [
    { kind: "person", id: "p-bo", name: "Bo Dev", subtitle: "Developer", detail: "Core", childCount: 1, children: null },
    { kind: "person", id: "p-cy", name: "Cy Intern", subtitle: null, detail: null, childCount: 0, children: [] },
  ] }],
};
const TREE_ORG = {
  view: "organization", asOf: "2026-11-23", partial: false,
  nodes: [{ kind: "department", id: "d-eng", name: "Engineering", subtitle: "Head: Ann Boss", childCount: 1, children: [{ kind: "team", id: "t-core", name: "Core", subtitle: "Lead: Ann Boss", childCount: 2, children: null }] }],
};
const profile = (over: Record<string, unknown> = {}) => ({
  ...PEOPLE[1]!, roleFamily: null,
  departmentRows: [{ rowId: "dr1", department: { id: "d-eng", name: "Engineering" }, type: "member", startDate: "2026-01-01", endDate: null }],
  teamRows: [{ rowId: "tr1", team: { id: "t-core", name: "Core" }, departmentId: "d-eng", type: "member", allocationPct: 100, startDate: "2026-01-01", endDate: null }],
  managerRows: [{ rowId: "mr1", manager: { id: "p-ann", name: "Ann Boss" }, type: "primary", startDate: "2026-01-01", endDate: null, reason: null }],
  directReports: [{ id: "p-cy", name: "Cy Intern", type: "primary" }],
  employment: { employeeCode: "E-2", employmentType: "full_time", startDate: "2024-01-15", endDate: null },
  can: { edit: true, manageHierarchy: true, archive: true, restore: false },
  ...over,
});
const HISTORY = { designations: [{ id: "h1", label: "Developer", detail: "Added with the person", startDate: "2024-01-15", endDate: null }], departments: [], teams: [{ id: "h2", label: "Core", detail: "member", startDate: "2024-01-15", endDate: null }], managers: [], reports: [] };

const server = (extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined) =>
  stubFetch((url, init) => {
    const path = url.split("?")[0];
    const special = extra(url, init);
    if (special) return special;
    if (path === "/api/hierarchy/tree") return envelope(url.includes("view=organization") ? TREE_ORG : url.includes("root=p-bo") ? { ...TREE_REPORTING, nodes: [{ ...TREE_REPORTING.nodes[0]!.children![0]!, children: [{ kind: "person", id: "p-di", name: "Di Junior", subtitle: null, detail: null, childCount: 0, children: [] }] }] } : TREE_REPORTING);
    if (path === "/api/employees") return envelope({ people: PEOPLE, total: 2, limit: 200, offset: 0 });
    if (path === "/api/employees/p-bo") return envelope(profile());
    if (path === "/api/employees/p-bo/history") return envelope(HISTORY);
    if (path === "/api/organization/structure") return envelope(STRUCTURE);
    return json(HEALTH_OK);
  });
const withCaps = (caps: Record<string, string[]>) => ({ ...ME_READY, roles: [{ key: "x", name: "Some Role" }], capabilities: caps });
const VIEW = { "org.view": ["all_in_scope"], "people.view": ["all_in_scope"] };
const MANAGE = { ...VIEW, "people.manage": ["all_in_scope"], "hierarchy.manage": ["all_in_scope"], "org.manage": ["all_in_scope"] };

describe("Organization → chart (stage 2.7)", () => {
  it("draws the reporting tree from the first levels, opens deeper levels on demand, and switches to departments and teams", async () => {
    setMe(withCaps(VIEW));
    const fn = server();
    renderApp("/organization");
    const tree = await screen.findByRole("tree", { name: "Reporting lines" });
    const ann = within(tree).getByRole("treeitem", { name: /Ann Boss/ });
    expect(ann.getAttribute("aria-expanded")).toBe("true"); // the first level opens by itself
    expect(within(tree).getByText("Bo Dev")).toBeTruthy();
    expect(within(tree).getByText("Cy Intern")).toBeTruthy();
    expect(within(tree).getByText("Tech Lead · Core")).toBeTruthy();
    // Bo's reports are not loaded: opening Bo asks the server for them
    await userEvent.click(within(tree).getByRole("button", { name: "Expand Bo Dev" }));
    await within(tree).findByText("Di Junior");
    expect(calls(fn, "/api/hierarchy/tree", "GET").some((c) => String(c[0]).includes("root=p-bo"))).toBe(true);
    // collapse again
    await userEvent.click(within(tree).getByRole("button", { name: "Collapse Bo Dev" }));
    expect(within(tree).queryByText("Di Junior")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Departments and teams" }));
    const org = await screen.findByRole("tree", { name: "Departments and teams" });
    expect(within(org).getByText("Head: Ann Boss")).toBeTruthy();
    expect(within(org).getByText("Core")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Departments and teams" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("works from the keyboard: arrows move, Right opens, Left closes, Enter opens a profile", async () => {
    setMe(withCaps(VIEW));
    server();
    renderApp("/organization");
    const tree = await screen.findByRole("tree", { name: "Reporting lines" });
    const ann = within(tree).getByRole("treeitem", { name: /Ann Boss/ });
    ann.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(within(tree).getByRole("treeitem", { name: /Bo Dev/ }));
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(within(tree).getByRole("treeitem", { name: /Cy Intern/ }));
    await userEvent.keyboard("{Home}");
    expect(document.activeElement).toBe(ann);
    await userEvent.keyboard("{ArrowLeft}"); // closes Ann
    expect(ann.getAttribute("aria-expanded")).toBe("false");
    expect(within(tree).queryByText("Bo Dev")).toBeNull();
    await userEvent.keyboard("{ArrowRight}"); // opens again
    expect(ann.getAttribute("aria-expanded")).toBe("true");
    await userEvent.keyboard("{ArrowRight}"); // moves to the first child
    expect(document.activeElement).toBe(within(tree).getByRole("treeitem", { name: /Bo Dev/ }));
    await userEvent.keyboard("{ArrowLeft}"); // a closed (unloaded) node: back to the parent
    expect(document.activeElement).toBe(ann);
    await userEvent.keyboard("{End}");
    await userEvent.keyboard("{Enter}");
    await screen.findByRole("dialog");
  });

  it("opens a person's profile in the side panel and shows managers, reports and employment details", async () => {
    setMe(withCaps(VIEW));
    server((url) => (url === "/api/employees/p-bo" ? envelope(profile({ can: { edit: false, manageHierarchy: false, archive: false, restore: false } })) : undefined));
    renderApp("/organization");
    await userEvent.click(await screen.findByRole("button", { name: "Open profile of Bo Dev" }));
    const dlg = await screen.findByRole("dialog");
    expect(await within(dlg).findByRole("heading", { name: "Bo Dev" })).toBeTruthy();
    expect(within(dlg).getByText("Developer")).toBeTruthy();
    expect(within(dlg).getByRole("button", { name: "Ann Boss" })).toBeTruthy(); // reports to
    expect(within(dlg).getByRole("button", { name: "Cy Intern" })).toBeTruthy();
    expect(within(dlg).getByText("E-2")).toBeTruthy();
    expect(within(dlg).queryByRole("tab", { name: "Manage" })).toBeNull(); // read only for this person
    await userEvent.click(within(dlg).getByRole("tab", { name: "History" }));
    expect(await within(dlg).findByText(/Added with the person/)).toBeTruthy();
    await userEvent.click(within(dlg).getByRole("button", { name: "Close profile" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows a calm empty state with a way to add the first person", async () => {
    setMe(withCaps(MANAGE));
    stubFetch((url) => (url.startsWith("/api/hierarchy/tree") ? envelope({ view: "reporting", asOf: "x", partial: false, nodes: [] }) : json(HEALTH_OK)));
    renderApp("/organization");
    expect(await screen.findByText("No one is in the chart yet")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Add a person|Add person/ }).length).toBeGreaterThan(0);
  });

  it("says so when the chart cannot be loaded", async () => {
    setMe(withCaps(VIEW));
    stubFetch((url) => (url.startsWith("/api/hierarchy/tree") ? apiError(500, "internal_error", "Something went wrong") : json(HEALTH_OK)));
    renderApp("/organization");
    expect(await screen.findByText("The chart could not be loaded")).toBeTruthy();
  });

  it("a person who cannot see the organization is sent away from the page", async () => {
    setMe(withCaps({ "okr.view": ["own"] }));
    server();
    renderApp("/organization");
    await waitFor(() => expect(screen.queryByRole("tree")).toBeNull());
  });
});

describe("Organization → people list and adding people (stage 2.6)", () => {
  it("lists people with designation, team and manager, filters through the server, and opens a profile", async () => {
    setMe(withCaps(MANAGE));
    const fn = server();
    renderApp("/organization/people");
    const list = await screen.findByRole("list", { name: "People list" });
    expect(within(list).getAllByText("Core").length).toBe(2);
    expect(within(list).getAllByText("Ann Boss").length).toBe(2); // as a person and as Bo's manager
    expect((await screen.findAllByText("No login")).length).toBe(2);
    expect(screen.getByRole("status").textContent).toContain("Showing 2 of 2 people");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Team" }), "t-core");
    await waitFor(() => expect(calls(fn, "/api/employees", "GET").some((c) => String(c[0]).includes("teamId=t-core"))).toBe(true));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search people" }), "bo");
    await waitFor(() => expect(calls(fn, "/api/employees", "GET").some((c) => String(c[0]).includes("search=bo"))).toBe(true));
    await userEvent.click(within(list).getByRole("button", { name: "Open profile of Bo Dev" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("adds a person with a designation, team and manager in one step and says so", async () => {
    setMe(withCaps(MANAGE));
    const fn = server((url, init) => (url === "/api/employees" && init?.method === "POST" ? envelope({ id: "p-new" }, 201) : undefined));
    renderApp("/organization/people");
    await userEvent.click(await screen.findByRole("button", { name: "Add person" }));
    const form = await screen.findByRole("form", { name: "Add a person" });
    await userEvent.click(within(form).getByRole("button", { name: "Add person" }));
    expect(await within(form).findByText("Enter the person's name")).toBeTruthy();
    expect(calls(fn, "/api/employees", "POST")).toHaveLength(0);
    await userEvent.type(within(form).getByLabelText("Name"), "Dee Tester");
    await userEvent.selectOptions(within(form).getByLabelText("Designation"), "g-dev");
    await userEvent.selectOptions(within(form).getByLabelText("Team"), "t-core");
    await waitFor(() => expect((within(form).getByLabelText("Reports to") as HTMLSelectElement).options.length).toBeGreaterThan(1));
    await userEvent.selectOptions(within(form).getByLabelText("Reports to"), "p-ann");
    await userEvent.click(within(form).getByRole("button", { name: "Add person" }));
    await within(form).findByText(/Dee Tester was added/);
    expect(bodyOf(calls(fn, "/api/employees", "POST")[0]!)).toEqual({ name: "Dee Tester", designationId: "g-dev", teamId: "t-core", managerId: "p-ann" });
  });

  it("shows the server's refusal in plain words and keeps the form", async () => {
    setMe(withCaps(MANAGE));
    server((url, init) => (url === "/api/employees" && init?.method === "POST" ? apiError(409, "employee_code_taken", "Another person already has that employee code.") : undefined));
    renderApp("/organization/people");
    await userEvent.click(await screen.findByRole("button", { name: "Add person" }));
    const form = await screen.findByRole("form", { name: "Add a person" });
    await userEvent.type(within(form).getByLabelText("Name"), "Dee");
    await userEvent.click(within(form).getByRole("button", { name: "Add person" }));
    expect((await within(form).findByRole("alert")).textContent).toContain("employee code");
    expect((within(form).getByLabelText("Name") as HTMLInputElement).value).toBe("Dee");
  });

  it("a viewer without people.manage sees no Add person button", async () => {
    setMe(withCaps(VIEW));
    server();
    renderApp("/organization/people");
    await screen.findByRole("list", { name: "People list" });
    expect(screen.queryByRole("button", { name: "Add person" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Edit structure" })).toBeNull();
  });
});

describe("Profile → manage (stage 2.6)", () => {
  async function openManage(extra?: (url: string, init?: RequestInit) => Response | undefined) {
    setMe(withCaps(MANAGE));
    const fn = server(extra);
    renderApp("/organization/people?person=p-bo");
    const dlg = await screen.findByRole("dialog");
    await userEvent.click(await within(dlg).findByRole("tab", { name: "Manage" }));
    return { fn, dlg };
  }

  it("adds a primary manager with a date and says the old one ends; shows the server's refusal for a loop", async () => {
    let refuse = true;
    const { fn, dlg } = await openManage((url, init) => {
      if (url === "/api/hierarchy/reporting" && init?.method === "POST") return refuse ? apiError(409, "would_create_cycle", "Ann Boss already reports, directly or through others, to Bo Dev. That would make a loop.") : envelope({ id: "r1", endedPrimary: "Ann Boss" }, 201);
      return undefined;
    });
    await userEvent.click(within(dlg).getByRole("button", { name: "Add manager" }));
    const form = within(dlg).getByRole("form", { name: "Add manager" });
    await userEvent.click(within(form).getByRole("button", { name: "Add reporting line" }));
    expect(await within(form).findByText("Choose the manager")).toBeTruthy();
    await waitFor(() => expect((within(form).getByLabelText("Manager") as HTMLSelectElement).options.length).toBeGreaterThan(1));
    await userEvent.selectOptions(within(form).getByLabelText("Manager"), "p-ann");
    await userEvent.click(within(form).getByRole("button", { name: "Add reporting line" }));
    expect((await within(dlg).findByRole("alert")).textContent).toContain("loop");
    refuse = false;
    await userEvent.click(within(form).getByRole("button", { name: "Add reporting line" }));
    expect(await within(dlg).findByText(/Primary manager set/)).toBeTruthy();
    const sent = calls(fn, "/api/hierarchy/reporting", "POST").map(bodyOf).at(-1);
    expect(sent).toMatchObject({ subordinateId: "p-bo", managerId: "p-ann", type: "primary" });
  });

  it("moves a person to a team on a chosen date", async () => {
    const { fn, dlg } = await openManage((url, init) => (url === "/api/hierarchy/move" && init?.method === "POST" ? envelope({ moved: true }) : undefined));
    await userEvent.click(within(dlg).getByRole("button", { name: "Move" }));
    const form = within(dlg).getByRole("form", { name: "Move person" });
    await userEvent.click(within(form).getByRole("button", { name: "Move" }));
    expect(await within(form).findByText("Choose where to move them")).toBeTruthy();
    await userEvent.selectOptions(within(form).getByLabelText("Move to"), "team:t-in");
    const date = within(form).getByLabelText("On") as HTMLInputElement;
    await userEvent.clear(date);
    await userEvent.type(date, "2027-01-15");
    await userEvent.type(within(form).getByLabelText("Reason (optional)"), "Joined sales");
    await userEvent.click(within(form).getByRole("button", { name: "Move" }));
    await within(dlg).findByText(/Moved\./);
    expect(bodyOf(calls(fn, "/api/hierarchy/move", "POST")[0]!)).toEqual({ membershipId: "p-bo", toTeamId: "t-in", effectiveDate: "2027-01-15", reason: "Joined sales" });
  });

  it("ends a team membership only after confirming, and changes a role from the list", async () => {
    const { fn, dlg } = await openManage((url, init) => (url.startsWith("/api/teams/t-core/members/tr1") && init?.method === "PATCH" ? envelope({ id: "tr1" }) : undefined));
    await userEvent.selectOptions(within(dlg).getByLabelText("Role in Core"), "lead");
    await within(dlg).findByText(/Now the team lead/);
    expect(bodyOf(calls(fn, "/api/teams/t-core/members/tr1", "PATCH")[0]!)).toEqual({ type: "lead" });
    await userEvent.click(within(dlg).getByRole("button", { name: "Remove Bo Dev from Core" }));
    expect(calls(fn, "/api/teams/t-core/members/tr1", "PATCH")).toHaveLength(1); // not yet
    await userEvent.click(within(dlg).getByRole("button", { name: "Confirm: Remove Bo Dev from Core" }));
    await waitFor(() => expect(calls(fn, "/api/teams/t-core/members/tr1", "PATCH")).toHaveLength(2));
    expect(bodyOf(calls(fn, "/api/teams/t-core/members/tr1", "PATCH")[1]!)).toMatchObject({ endDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });

  it("changes the designation with a start day and archives only after a confirmation", async () => {
    const { fn, dlg } = await openManage((url, init) => {
      if (url === "/api/employees/p-bo/designation" && init?.method === "POST") return envelope({ id: "p-bo" });
      if (url === "/api/employees/p-bo/archive" && init?.method === "POST") return envelope({ archived: true });
      return undefined;
    });
    await userEvent.click(within(dlg).getByRole("button", { name: "Change designation" }));
    const form = within(dlg).getByRole("form", { name: "Change designation" });
    await userEvent.selectOptions(within(form).getByLabelText("New designation"), "g-lead");
    await userEvent.click(within(form).getByRole("button", { name: "Change designation" }));
    await within(dlg).findByText(/Designation changed/);
    expect(bodyOf(calls(fn, "/api/employees/p-bo/designation", "POST")[0]!)).toMatchObject({ designationId: "g-lead" });
    await userEvent.click(within(dlg).getByRole("button", { name: /Archive this person/ }));
    expect(calls(fn, "/api/employees/p-bo/archive", "POST")).toHaveLength(0);
    expect(within(dlg).getByText(/Nothing is deleted/)).toBeTruthy();
    await userEvent.click(within(dlg).getByRole("button", { name: "Confirm archive" }));
    await waitFor(() => expect(calls(fn, "/api/employees/p-bo/archive", "POST")).toHaveLength(1));
  });

  it("without hierarchy.manage and people.manage the profile has no Manage tab at all", async () => {
    setMe(withCaps(VIEW));
    server((url) => (url === "/api/employees/p-bo" ? envelope(profile({ can: { edit: false, manageHierarchy: false, archive: false, restore: false } })) : undefined));
    renderApp("/organization/people?person=p-bo");
    const dlg = await screen.findByRole("dialog");
    await within(dlg).findByRole("heading", { name: "Bo Dev" });
    expect(within(dlg).queryByRole("tab", { name: "Manage" })).toBeNull();
  });

  it("a person outside the viewer's scope is a calm message, not a crash", async () => {
    setMe(withCaps(VIEW));
    server((url) => (url === "/api/employees/p-bo" ? apiError(404, "not_found", "Not found") : undefined));
    renderApp("/organization/people?person=p-bo");
    expect(await screen.findByText("This person is not in your view")).toBeTruthy();
  });
});
