// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { apiError, envelope, HEALTH_OK, json, ME_NO_ROLE, ME_READY, renderApp, setMe, stubFetch, stubMatchMedia } from "./helpers";

beforeEach(() => stubMatchMedia(false));

const calls = (fn: ReturnType<typeof stubFetch>, path: string, method: string) => fn.mock.calls.filter((c) => String(c[0]) === path && (c[1] as RequestInit | undefined)?.method === method);
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));

const item = { description: "", archived: false, archivedAt: null };
const STRUCTURE = {
  departments: [
    { id: "d-eng", parentId: null, name: "Engineering", ...item, description: "Builds the product" },
    { id: "d-plat", parentId: "d-eng", name: "Platform group", ...item },
    { id: "d-sales", parentId: null, name: "Sales", ...item },
    { id: "d-old", parentId: null, name: "Old Dept", description: "", archived: true, archivedAt: "2026-01-01T00:00:00Z" },
  ],
  teams: [
    { id: "t-core", departmentId: "d-eng", parentTeamId: null, name: "Core", ...item },
    { id: "t-infra", departmentId: "d-eng", parentTeamId: "t-core", name: "Infra", ...item },
  ],
  roleFamilies: [{ id: "f-eng", name: "Engineering roles", ...item }],
  designations: [
    { id: "g-mentor", roleFamilyId: "f-eng", name: "Mentor", ...item },
    { id: "g-founder", roleFamilyId: null, name: "Founder", ...item },
  ],
  limits: { maxDepth: 8 },
  partial: false,
};
const server = (extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined, data: unknown = STRUCTURE) =>
  stubFetch((url, init) => {
    if (url === "/api/organization/structure") return envelope(data);
    return extra(url, init) ?? json(HEALTH_OK);
  });
const withCaps = (caps: Record<string, string[]>) => ({ ...ME_READY, roles: [{ key: "x", name: "Some Role" }], capabilities: caps });
const MANAGE = { "org.view": ["all_in_scope"], "org.manage": ["all_in_scope"] };

describe("Settings → Organization structure", () => {
  it("draws the department → team → sub-team tree, hides archived items until asked, and lists designations by role family", async () => {
    setMe(withCaps(MANAGE));
    server();
    renderApp("/settings/structure");
    const tree = await screen.findByRole("list", { name: "Departments" });
    expect(within(tree).getByText("Engineering")).toBeTruthy();
    expect(within(tree).getByText("Builds the product")).toBeTruthy();
    expect(within(tree).getByText("Platform group")).toBeTruthy(); // sub-department
    expect(within(tree).getByText("Core")).toBeTruthy();
    expect(within(tree).getByText("Infra")).toBeTruthy();
    expect(within(tree).getByText("Sub-team")).toBeTruthy();
    expect(within(tree).queryByText("Old Dept")).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: /Show archived \(1\)/ }));
    expect(within(tree).getByText("Old Dept")).toBeTruthy();
    expect(within(tree).getByRole("button", { name: "Restore Old Dept" })).toBeTruthy();

    const families = screen.getByRole("list", { name: "Role families" });
    expect(within(families).getByText("Engineering roles")).toBeTruthy();
    expect(within(families).getByText("Mentor")).toBeTruthy();
    expect(screen.getByText("Designations without a role family")).toBeTruthy();
    expect(screen.getByText("Founder")).toBeTruthy();
  });

  it("adds a department, a team under it and a sub-team, sending the right parents", async () => {
    setMe(withCaps(MANAGE));
    const f = server((url, init) => (init?.method === "POST" && /^\/api\/(departments|teams)$/.test(url) ? envelope({ id: "new" }, 201) : undefined));
    renderApp("/settings/structure");
    await screen.findByRole("list", { name: "Departments" });

    await userEvent.click(screen.getByRole("button", { name: "Add department" }));
    await userEvent.type(screen.getByLabelText("Name"), "Finance");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls(f, "/api/departments", "POST")).toHaveLength(1));
    expect(bodyOf(calls(f, "/api/departments", "POST")[0]!)).toEqual({ name: "Finance", parentId: null });

    await userEvent.click(screen.getByRole("button", { name: "Add sub-department to Sales" }));
    await userEvent.type(screen.getByLabelText("Name"), "Inside sales");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls(f, "/api/departments", "POST")).toHaveLength(2));
    expect(bodyOf(calls(f, "/api/departments", "POST")[1]!)).toEqual({ name: "Inside sales", parentId: "d-sales" });

    await userEvent.click(screen.getByRole("button", { name: "Add team to Sales" }));
    await userEvent.type(screen.getByLabelText("Name"), "Accounts");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls(f, "/api/teams", "POST")).toHaveLength(1));
    expect(bodyOf(calls(f, "/api/teams", "POST")[0]!)).toEqual({ name: "Accounts", departmentId: "d-sales", parentTeamId: null });

    await userEvent.click(screen.getByRole("button", { name: "Add sub-team to Core" }));
    await userEvent.type(screen.getByLabelText("Name"), "Night");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls(f, "/api/teams", "POST")).toHaveLength(2));
    expect(bodyOf(calls(f, "/api/teams", "POST")[1]!)).toEqual({ name: "Night", departmentId: "d-eng", parentTeamId: "t-core" });
  });

  it("shows the server's refusal in its own words and keeps the form open (a name already used)", async () => {
    setMe(withCaps(MANAGE));
    server((url, init) => (url === "/api/departments" && init?.method === "POST" ? apiError(409, "name_taken", "There is already an active department with that name here. Choose another name.") : undefined));
    renderApp("/settings/structure");
    await screen.findByRole("list", { name: "Departments" });
    await userEvent.click(screen.getByRole("button", { name: "Add department" }));
    await userEvent.type(screen.getByLabelText("Name"), "sales");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/already an active department/);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("sales");
  });

  it("archiving asks first, and a refusal because of active children is shown", async () => {
    setMe(withCaps(MANAGE));
    let refuse = true;
    const f = server((url, init) => {
      if (url === "/api/departments/d-eng/archive" && init?.method === "POST") {
        return refuse ? apiError(409, "has_active_children", "This department still has 1 active sub-department and 2 active teams. Move or archive them first.") : envelope({ archived: true });
      }
      return undefined;
    });
    renderApp("/settings/structure");
    await screen.findByRole("list", { name: "Departments" });
    await userEvent.click(screen.getByRole("button", { name: "Archive Engineering" }));
    expect(calls(f, "/api/departments/d-eng/archive", "POST")).toHaveLength(0); // nothing sent until confirmed
    expect(screen.getByText(/nothing is deleted, and you can restore it later/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Confirm archive" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/2 active teams/);
    refuse = false;
    await userEvent.click(screen.getByRole("button", { name: "Confirm archive" }));
    await waitFor(() => expect(calls(f, "/api/departments/d-eng/archive", "POST")).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Confirm archive" })).toBeNull());
  });

  it("restores an archived item with one click", async () => {
    setMe(withCaps(MANAGE));
    const f = server((url, init) => (url === "/api/departments/d-old/restore" && init?.method === "POST" ? envelope({ id: "d-old" }) : undefined));
    renderApp("/settings/structure");
    await screen.findByRole("list", { name: "Departments" });
    await userEvent.click(screen.getByRole("checkbox", { name: /Show archived/ }));
    await userEvent.click(screen.getByRole("button", { name: "Restore Old Dept" }));
    await waitFor(() => expect(calls(f, "/api/departments/d-old/restore", "POST")).toHaveLength(1));
  });

  it("moving a department offers no parent inside itself, nor itself, nor archived ones; moving a team lists the department's teams", async () => {
    setMe(withCaps(MANAGE));
    const f = server((url, init) => (init?.method === "PATCH" ? envelope({ id: "x" }) : undefined));
    renderApp("/settings/structure");
    await screen.findByRole("list", { name: "Departments" });
    await userEvent.click(screen.getByRole("button", { name: "Move Engineering" }));
    const select = screen.getByLabelText("New parent department") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Top level (no parent)", "Sales"]); // not Engineering, not its sub-department, not the archived one
    await userEvent.selectOptions(select, "d-sales");
    await userEvent.click(screen.getByRole("button", { name: "Move" }));
    await waitFor(() => expect(calls(f, "/api/departments/d-eng", "PATCH")).toHaveLength(1));
    expect(bodyOf(calls(f, "/api/departments/d-eng", "PATCH")[0]!)).toEqual({ parentId: "d-sales" });

    await userEvent.click(screen.getByRole("button", { name: "Move Core" }));
    const dept = screen.getByLabelText("Department") as HTMLSelectElement;
    expect(dept.value).toBe("d-eng");
    const parent = screen.getByLabelText("Parent team") as HTMLSelectElement;
    expect([...parent.options].map((o) => o.textContent)).toEqual(["Directly under the department"]); // Infra is below Core, Core is itself
    await userEvent.selectOptions(dept, "d-sales");
    await userEvent.click(screen.getByRole("button", { name: "Move" }));
    await waitFor(() => expect(calls(f, "/api/teams/t-core", "PATCH")).toHaveLength(1));
    expect(bodyOf(calls(f, "/api/teams/t-core", "PATCH")[0]!)).toEqual({ departmentId: "d-sales", parentTeamId: null });
  });

  it("renames, and creates the designation \"Mentor\" in a role family", async () => {
    setMe(withCaps(MANAGE));
    const f = server((url, init) => (init?.method === "PATCH" || (init?.method === "POST" && url === "/api/designations") ? envelope({ id: "n" }, init?.method === "POST" ? 201 : 200) : undefined));
    renderApp("/settings/structure");
    await screen.findByRole("list", { name: "Departments" });
    await userEvent.click(screen.getByRole("button", { name: "Rename Sales" }));
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    expect(name.value).toBe("Sales");
    await userEvent.clear(name);
    await userEvent.type(name, "Revenue");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls(f, "/api/departments/d-sales", "PATCH")).toHaveLength(1));
    expect(bodyOf(calls(f, "/api/departments/d-sales", "PATCH")[0]!)).toEqual({ name: "Revenue", description: "" });

    await userEvent.click(screen.getByRole("button", { name: "Add designation to Engineering roles" }));
    await userEvent.type(screen.getByLabelText("Name"), "Staff mentor");
    expect((screen.getByLabelText("Role family") as HTMLSelectElement).value).toBe("f-eng"); // opened from the family
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls(f, "/api/designations", "POST")).toHaveLength(1));
    expect(bodyOf(calls(f, "/api/designations", "POST")[0]!)).toEqual({ name: "Staff mentor", roleFamilyId: "f-eng" });
  });

  it("is read only for people with org.view alone (no Add, Rename, Move or Archive) and says when they see only part", async () => {
    setMe(withCaps({ "org.view": ["my_teams"] }));
    server(undefined, { ...STRUCTURE, partial: true });
    renderApp("/settings/structure");
    await screen.findByRole("list", { name: "Departments" });
    expect(screen.getByText(/You see the departments and teams in your scope/)).toBeTruthy();
    for (const name of [/^Add /, /^Rename /, /^Move /, /^Archive /, /^Restore /]) expect(screen.queryByRole("button", { name }), String(name)).toBeNull();
    expect(screen.queryByLabelText("Organization name")).toBeNull();
  });

  it("renames the organization for people with org.settings", async () => {
    setMe(withCaps({ ...MANAGE, "org.settings": ["all_in_scope"] }));
    const f = server((url, init) => (url === "/api/organization" && init?.method === "PATCH" ? envelope({ id: "o1", name: "Acme Global" }) : undefined));
    renderApp("/settings/structure");
    const field = (await screen.findByLabelText("Organization name", { selector: "input" })) as HTMLInputElement;
    expect(field.value).toBe("Acme Robotics");
    const save = screen.getByRole("button", { name: "Save name" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // nothing changed yet
    await userEvent.clear(field);
    await userEvent.type(field, "Acme Global");
    await userEvent.click(save);
    await waitFor(() => expect(calls(f, "/api/organization", "PATCH")).toHaveLength(1));
    expect(bodyOf(calls(f, "/api/organization", "PATCH")[0]!)).toEqual({ name: "Acme Global" });
    expect(await screen.findByText("Organization name saved.")).toBeTruthy();
  });

  it("is only for people who hold org.view (a clear no-access page otherwise) and appears on the Settings index for them", async () => {
    setMe(ME_NO_ROLE);
    const f = server();
    const first = renderApp("/settings/structure");
    expect(await screen.findByText("You do not have access to this page")).toBeTruthy();
    expect(f.mock.calls.filter((c) => String(c[0]) === "/api/organization/structure")).toHaveLength(0);
    first.unmount();
    setMe(ME_READY);
    server();
    renderApp("/settings");
    expect(await screen.findByRole("link", { name: /Organization structure/ })).toBeTruthy();
  });

  it("shows a helpful empty state for a new organization", async () => {
    setMe(withCaps(MANAGE));
    server(undefined, { ...STRUCTURE, departments: [], teams: [], roleFamilies: [], designations: [] });
    renderApp("/settings/structure");
    expect(await screen.findByText("No departments yet")).toBeTruthy();
    expect(screen.getByText("No designations yet")).toBeTruthy();
  });
});
