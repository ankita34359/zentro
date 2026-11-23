// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "../../backend/src/modules/permissions/catalog.js";
import { apiError, envelope, HEALTH_OK, json, ME_NO_ROLE, ME_READY, renderApp, setMe, stubFetch, stubMatchMedia } from "./helpers";

// The grid has about 200 checkboxes; role queries over it are slow in jsdom.
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => stubMatchMedia(false));

const calls = (fn: ReturnType<typeof stubFetch>, path: string, method?: string) => fn.mock.calls.filter((c) => String(c[0]) === path && (!method || (c[1] as RequestInit | undefined)?.method === method));
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));
function server(extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined) {
  return stubFetch((url, init) => extra(url, init) ?? json(HEALTH_OK));
}
const CATALOG = PERMISSIONS.map((p) => ({ key: p.key, module: p.module, description: p.description, modes: [...p.modes], sensitive: p.sensitive }));
const ROLES = [
  { id: "r-owner", key: "owner", name: "Owner", description: "Full control.", kind: "template", isProtected: true, permissionCount: 54, holderCount: 1 },
  { id: "r-manager", key: "manager", name: "Manager", description: "Manages reports.", kind: "template", isProtected: false, permissionCount: 2, holderCount: 0 },
];
const MANAGER = { ...ROLES[1], permissions: [
  { key: "org.view", module: "Organization", description: "x", sensitive: false, modes: ["reports"], allowedModes: ["own", "my_teams", "reports", "all_in_scope"] },
  { key: "okr.view", module: "OKRs", description: "x", sensitive: false, modes: ["own"], allowedModes: ["own", "my_teams", "reports", "all_in_scope"] },
] };
const OWNER = { ...ROLES[0], permissions: PERMISSIONS.map((p) => ({ key: p.key, module: p.module, description: p.description, sensitive: p.sensitive, modes: ["all_in_scope"], allowedModes: [...p.modes] })) };
const api = (extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined) =>
  server((url, init) => {
    if (url === "/api/roles" && (init?.method ?? "GET") === "GET") return envelope(ROLES);
    if (url === "/api/permissions") return envelope(CATALOG);
    if (url === "/api/roles/r-manager" && (init?.method ?? "GET") === "GET") return envelope(MANAGER);
    if (url === "/api/roles/r-owner") return envelope(OWNER);
    return extra(url, init);
  });
const withCaps = (caps: Record<string, string[]>) => ({ ...ME_READY, roles: [{ key: "x", name: "Some Role" }], capabilities: caps });
const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement; // getByLabelText: much faster than role queries over ~200 checkboxes

describe("Settings → Roles: the editor", () => {
  it("shows the grid for the chosen role; the Owner role is protected and view only", async () => {
    api();
    renderApp("/settings/roles");
    const list = await screen.findByRole("list", { name: "Roles" });
    expect(within(list).getByText("Protected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New role" })).toBeTruthy();
    await userEvent.click(within(list).getByRole("button", { name: /Owner/ }));
    expect(await screen.findByRole("note")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toMatch(/protected/i);
    expect(box("org.view: Everyone in scope").checked).toBe(true);
    expect(box("org.view: Everyone in scope").disabled).toBe(true); // view only
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Archive this role/ })).toBeNull();
  });

  it("ticking and unticking cells shows what will change; saving sends the whole grid; discard restores", async () => {
    const f = api((url, init) => (url === "/api/roles/r-manager/permissions" && init?.method === "PUT" ? envelope(MANAGER) : undefined));
    renderApp("/settings/roles");
    await userEvent.click(await screen.findByRole("button", { name: /Manager/ }));
    await screen.findByRole("region", { name: "Organization" });
    expect(box("org.view: Reports").checked).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("No changes.");
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(box("org.view: Reports")); // remove
    await userEvent.click(box("kpi.view: Own")); // add
    expect(screen.getByRole("status").textContent).toBe("1 to add, 1 to remove.");
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByRole("status").textContent).toBe("No changes.");
    expect(box("org.view: Reports").checked).toBe(true);
    await userEvent.click(box("kpi.view: Own"));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(calls(f, "/api/roles/r-manager/permissions", "PUT")).toHaveLength(1));
    const sent = bodyOf(calls(f, "/api/roles/r-manager/permissions", "PUT")[0]!);
    expect(sent.grants).toEqual(expect.arrayContaining([{ permission: "org.view", mode: "reports" }, { permission: "okr.view", mode: "own" }, { permission: "kpi.view", mode: "own" }]));
    expect(sent.grants).toHaveLength(3);
    expect(sent.confirmSensitive).toBeUndefined();
    expect((await screen.findByText(/Saved\. People holding this role/)).textContent).toBeTruthy();
    await new Promise((r) => setTimeout(r, 300)); // the list is re-read after saving: the notice must stay
    expect(screen.getByText(/Saved\. People holding this role/)).toBeTruthy();
  });

  it("cells the catalogue does not allow are disabled (roles.manage is 'everyone' only)", async () => {
    api();
    renderApp("/settings/roles");
    await userEvent.click(await screen.findByRole("button", { name: /Manager/ }));
    await screen.findByRole("region", { name: "Access" });
    expect(box("roles.manage: Own").disabled).toBe(true);
    expect(box("roles.manage: Reports").disabled).toBe(true);
    expect(box("roles.manage: Everyone in scope").disabled).toBe(false);
    expect(box("roles.manage: Own").closest("label")!.getAttribute("title")).toMatch(/cannot be given in this mode/);
  });

  it("adding a sensitive permission needs the confirmation box ticked, and says which permissions", async () => {
    const f = api((url, init) => (url === "/api/roles/r-manager/permissions" && init?.method === "PUT" ? envelope(MANAGER) : undefined));
    renderApp("/settings/roles");
    await userEvent.click(await screen.findByRole("button", { name: /Manager/ }));
    await screen.findByRole("region", { name: "Performance" });
    await userEvent.click(box("performance.view_scores: Reports"));
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // needs the confirmation
    const confirm = screen.getByRole("checkbox", { name: /I understand I am adding sensitive permissions \(performance\.view_scores\)/ });
    await userEvent.click(confirm);
    expect(save.disabled).toBe(false);
    await userEvent.click(save);
    await waitFor(() => expect(calls(f, "/api/roles/r-manager/permissions", "PUT")).toHaveLength(1));
    expect(bodyOf(calls(f, "/api/roles/r-manager/permissions", "PUT")[0]!).confirmSensitive).toBe(true);
  });

  it("you cannot tick a cell you do not hold yourself (disabled with a reason), but you can untick anything", async () => {
    setMe(withCaps({ "roles.view": ["all_in_scope"], "roles.manage": ["all_in_scope"], "org.view": ["reports"], "okr.view": ["own"] }));
    api();
    renderApp("/settings/roles");
    await userEvent.click(await screen.findByRole("button", { name: /Manager/ }));
    await screen.findByRole("region", { name: "KPIs" });
    expect(box("kpi.view: Own").disabled).toBe(true); // not held
    expect(box("kpi.view: Own").closest("label")!.getAttribute("title")).toMatch(/hold yourself/);
    expect(box("org.view: Reports").disabled).toBe(false); // held and currently granted: can be removed
    expect(box("okr.view: Own").disabled).toBe(false);
    expect(box("org.view: Everyone in scope").disabled).toBe(true); // wider than held
    expect(box("org.view: Own").disabled).toBe(false); // own is covered by reports
  });

  it("creates a role (empty or a copy), selects it, and shows the server's refusal for a duplicate name", async () => {
    const f = api((url, init) => {
      if (url === "/api/roles" && init?.method === "POST") {
        const b = JSON.parse(String(init.body));
        return b.name === "Manager" ? apiError(409, "already_exists", "A role with this name already exists") : envelope({ id: "r-new", key: "pd", name: b.name, description: "", kind: "custom", isProtected: false, permissionCount: 0, holderCount: 0, permissions: [] }, 201);
      }
      return undefined;
    });
    renderApp("/settings/roles");
    await userEvent.click(await screen.findByRole("button", { name: "New role" }));
    const form = screen.getByRole("form", { name: "New role" });
    await userEvent.type(within(form).getByLabelText("Role name"), "Manager");
    await userEvent.click(within(form).getByRole("button", { name: "Create role" }));
    expect((await within(form).findByRole("alert")).textContent).toMatch(/already exists/);
    await userEvent.clear(within(form).getByLabelText("Role name"));
    await userEvent.type(within(form).getByLabelText("Role name"), "Program Director");
    await userEvent.selectOptions(within(form).getByLabelText("Start from"), "A copy of Manager");
    await userEvent.click(within(form).getByRole("button", { name: "Create role" }));
    await waitFor(() => expect(calls(f, "/api/roles", "POST")).toHaveLength(2));
    expect(bodyOf(calls(f, "/api/roles", "POST")[1]!)).toEqual({ name: "Program Director", copyFromRoleId: "r-manager" });
    await waitFor(() => expect(screen.queryByRole("form", { name: "New role" })).toBeNull());
  });

  it("archiving asks for confirmation, and shows the server's reason when people still hold the role", async () => {
    const f = api((url, init) => (url === "/api/roles/r-manager/archive" && init?.method === "POST" ? apiError(409, "role_in_use", "2 people hold this role. Reassign them first, then archive it.", { holders: 2 }) : undefined));
    renderApp("/settings/roles");
    await userEvent.click(await screen.findByRole("button", { name: /Manager/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Archive this role…" }));
    expect(calls(f, "/api/roles/r-manager/archive")).toHaveLength(0); // not yet
    await userEvent.click(screen.getByRole("button", { name: "Confirm archive" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/2 people hold this role/);
  });

  it("a person with roles.view but not roles.manage sees the same grid read only, with no buttons to change anything", async () => {
    setMe(withCaps({ "roles.view": ["all_in_scope"] }));
    api();
    renderApp("/settings/roles");
    await userEvent.click(await screen.findByRole("button", { name: /Manager/ }));
    await screen.findByRole("region", { name: "Organization" });
    expect(screen.getByText("You can view roles but not change them.")).toBeTruthy();
    expect(box("org.view: Reports").disabled).toBe(true);
    for (const name of ["New role", "Save changes", "Archive this role…", "Save details"]) expect(screen.queryByRole("button", { name })).toBeNull();
  });
});

describe("Users: assign a role, take it away, remove a person", () => {
  const MEMBERS = [
    { id: "m1", displayName: "Ankita", email: "ankita@example.com", status: "active", hasLogin: true, roles: [{ key: "owner", name: "Owner" }], assignments: [{ id: "a1", roleId: "r-owner", roleName: "Owner", validTo: null }], isYou: true },
    { id: "m2", displayName: "Piyush", email: "piyush@example.com", status: "active", hasLogin: true, roles: [], assignments: [], isYou: false },
    { id: "m3", displayName: "Bo", email: "bo@example.com", status: "active", hasLogin: true, roles: [{ key: "manager", name: "Manager" }], assignments: [{ id: "a3", roleId: "r-manager", roleName: "Manager", validTo: "2027-01-31T23:59:59.000Z" }], isYou: false },
    { id: "m9", displayName: "Karishma", email: "karishma@example.com", status: "invited", hasLogin: false, roles: [], assignments: [], isYou: false },
  ];
  const usersApi = (extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined) =>
    server((url, init) => {
      if (url === "/api/organization/members") return envelope(MEMBERS);
      if (url === "/api/invitations" && (init?.method ?? "GET") === "GET") return envelope([]);
      if (url === "/api/roles") return envelope(ROLES);
      return extra(url, init);
    });

  it("someone who joined with no role is marked 'No role' and can be given one (scope: the whole organization, or one department or team)", async () => {
    const f = usersApi((url, init) => (url === "/api/role-assignments" && init?.method === "POST" ? envelope({ id: "a2", membershipId: "m2", roleId: "r-manager", roleName: "Manager", scopeType: "organization", validFrom: "x", validTo: null, revokedAt: null, grantedBy: "Ankita", state: "active" }, 201) : undefined));
    renderApp("/settings/users");
    const people = await screen.findByRole("list", { name: "People" });
    const piyush = within(people).getByText("Piyush").closest("li")!;
    expect(within(piyush).getByText("No role")).toBeTruthy();
    expect(within(people).getByText("Not joined yet")).toBeTruthy();
    expect(within(people).queryByRole("button", { name: "Assign a role to Karishma" })).toBeNull(); // only people who joined
    await userEvent.click(within(piyush).getByRole("button", { name: "Assign a role to Piyush" }));
    const form = await screen.findByRole("form", { name: "Assign a role to Piyush" });
    const scope = within(form).getByLabelText("Applies to") as HTMLSelectElement;
    expect([...scope.options].map((o) => [o.textContent, o.disabled])).toEqual([["The whole organization", false], ["One department", false], ["One team", false]]);
    await userEvent.click(within(form).getByRole("button", { name: "Assign" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Choose a role to assign");
    await userEvent.selectOptions(within(form).getByLabelText("Role"), "Manager");
    await userEvent.type(within(form).getByLabelText("Until (optional)"), "2027-03-01");
    await userEvent.click(within(form).getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(calls(f, "/api/role-assignments", "POST")).toHaveLength(1));
    const sent = bodyOf(calls(f, "/api/role-assignments", "POST")[0]!);
    expect(sent).toMatchObject({ membershipId: "m2", roleId: "r-manager", scopeType: "organization" });
    expect(new Date(sent.validTo).getFullYear()).toBe(2027);
  });

  it("a role can be given for one department: the department list comes from the structure, is required, and its id is sent", async () => {
    const STRUCT = { departments: [{ id: "d-eng", parentId: null, name: "Engineering", description: "", archived: false, archivedAt: null }], teams: [], roleFamilies: [], designations: [], limits: { maxDepth: 8 }, partial: false };
    const f = usersApi((url, init) => {
      if (url === "/api/organization/structure") return envelope(STRUCT);
      if (url === "/api/role-assignments" && init?.method === "POST") return envelope({ id: "a2", membershipId: "m2", roleId: "r-manager", roleName: "Manager", scopeType: "department", scopeId: "d-eng", scopeName: "Engineering", validFrom: "x", validTo: null, revokedAt: null, grantedBy: "Ankita", state: "active" }, 201);
      return undefined;
    });
    renderApp("/settings/users");
    const piyush = (await screen.findByText("Piyush")).closest("li")!;
    await userEvent.click(within(piyush).getByRole("button", { name: "Assign a role to Piyush" }));
    const form = await screen.findByRole("form", { name: "Assign a role to Piyush" });
    await userEvent.selectOptions(within(form).getByLabelText("Role"), "Manager");
    await userEvent.selectOptions(within(form).getByLabelText("Applies to"), "department");
    await userEvent.click(within(form).getByRole("button", { name: "Assign" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Choose the department");
    await waitFor(() => expect((within(form).getByLabelText("Department") as HTMLSelectElement).options.length).toBe(2));
    await userEvent.selectOptions(within(form).getByLabelText("Department"), "Engineering");
    await userEvent.click(within(form).getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(calls(f, "/api/role-assignments", "POST")).toHaveLength(1));
    expect(bodyOf(calls(f, "/api/role-assignments", "POST")[0]!)).toMatchObject({ membershipId: "m2", roleId: "r-manager", scopeType: "department", scopeId: "d-eng" });
  });

  it("taking a role away asks first; the end date of a time-bound role is shown", async () => {
    const f = usersApi((url, init) => (url === "/api/role-assignments/a3/revoke" && init?.method === "POST" ? envelope({ id: "a3", state: "revoked" }) : undefined));
    renderApp("/settings/users");
    const bo = (await screen.findByText("Bo")).closest("li")!;
    expect(within(bo).getByText(/until/i)).toBeTruthy();
    await userEvent.click(within(bo).getByRole("button", { name: "Take Manager away from Bo" }));
    expect(calls(f, "/api/role-assignments/a3/revoke")).toHaveLength(0);
    await userEvent.click(within(bo).getByRole("button", { name: "Confirm taking Manager away from Bo" }));
    await waitFor(() => expect(calls(f, "/api/role-assignments/a3/revoke", "POST")).toHaveLength(1));
  });

  it("shows the server's last-administrator refusal in its own words", async () => {
    usersApi((url, init) => (url === "/api/role-assignments/a1/revoke" && init?.method === "POST" ? apiError(409, "last_admin", "That change would leave the organization without an administrator. Make someone else an administrator first.") : undefined));
    renderApp("/settings/users");
    const me = (await screen.findByText("Ankita")).closest("li")!;
    await userEvent.click(within(me).getByRole("button", { name: "Take Owner away from Ankita" }));
    await userEvent.click(within(me).getByRole("button", { name: "Confirm taking Owner away from Ankita" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/without an administrator/);
  });

  it("Remove from organization asks first, explains the login stays, and never appears for yourself or for someone who has not joined", async () => {
    const f = usersApi((url, init) => (url === "/api/people/m2/remove" && init?.method === "POST" ? envelope({ removed: true }) : undefined));
    renderApp("/settings/users");
    const people = await screen.findByRole("list", { name: "People" });
    expect(within(people).queryByRole("button", { name: "Remove Ankita from the organization" })).toBeNull();
    expect(within(people).queryByRole("button", { name: "Remove Karishma from the organization" })).toBeNull();
    const piyush = within(people).getByText("Piyush").closest("li")!;
    await userEvent.click(within(piyush).getByRole("button", { name: "Remove Piyush from the organization" }));
    expect(within(piyush).getByText(/keep their login and will be asked to create an organization/)).toBeTruthy();
    expect(calls(f, "/api/people/m2/remove")).toHaveLength(0);
    await userEvent.click(within(piyush).getByRole("button", { name: "Confirm removing Piyush from the organization" }));
    await waitFor(() => expect(calls(f, "/api/people/m2/remove", "POST")).toHaveLength(1));
  });

  it("people who may manage people but not roles see no Assign role or revoke buttons", async () => {
    setMe(withCaps({ "people.manage": ["all_in_scope"] }));
    usersApi();
    renderApp("/settings/users");
    const people = await screen.findByRole("list", { name: "People" });
    expect(within(people).queryByRole("button", { name: /Assign a role/ })).toBeNull();
    expect(within(people).queryByRole("button", { name: /away from/ })).toBeNull();
    expect(within(people).getByRole("button", { name: "Remove Piyush from the organization" })).toBeTruthy();
  });
});

describe("Settings → Audit log", () => {
  const ENTRIES = [
    { id: "e2", createdAt: "2026-11-23T10:05:00.000Z", actor: { membershipId: "m1", name: "Ankita", type: "user" }, action: "role_assignment.create", entityType: "role_assignment", entityId: "a2", summary: 'Gave Piyush the role "Manager"', before: null, after: { membershipId: "m2", roleId: "r-manager", scope: "organization" } },
    { id: "e1", createdAt: "2026-11-23T10:00:00.000Z", actor: { membershipId: "m1", name: "Ankita", type: "user" }, action: "organization.create", entityType: "organization", entityId: "o1", summary: 'Created the organization "Walkover"', before: null, after: null },
  ];
  it("lists entries newest first with who and when, expands details, filters by action, pages with a cursor, and has no IP", async () => {
    const f = server((url) => {
      if (!url.startsWith("/api/audit-logs")) return undefined;
      const q = new URL(url, "http://x").searchParams;
      if (q.get("action") === "role.create") return json({ data: [], meta: { requestId: "r", page: { limit: 25, nextCursor: null } } });
      if (q.get("cursor")) return json({ data: [ENTRIES[1]], meta: { requestId: "r", page: { limit: 25, nextCursor: null } } });
      return json({ data: [ENTRIES[0]], meta: { requestId: "r", page: { limit: 25, nextCursor: "CURSOR1" } } });
    });
    renderApp("/settings/audit");
    const list = await screen.findByRole("list", { name: "Audit log" });
    expect(within(list).getByText('Gave Piyush the role "Manager"')).toBeTruthy();
    expect(within(list).getByText(/Ankita ·/)).toBeTruthy();
    expect(within(list).getByText("Role given to a person")).toBeTruthy();
    await userEvent.click(within(list).getByRole("button", { name: /Show details/ }));
    expect(within(list).getByText(/After membershipId: m2/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bIP\b|ip address/i);
    await userEvent.click(screen.getByRole("button", { name: "Load older entries" }));
    expect(await screen.findByText('Created the organization "Walkover"')).toBeTruthy();
    expect(f.mock.calls.some((c) => String(c[0]).includes("cursor=CURSOR1"))).toBe(true);
    expect(screen.getByText("That is everything.")).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("What happened"), "Role created");
    expect(await screen.findByText("Nothing recorded for this filter")).toBeTruthy();
    expect(f.mock.calls.some((c) => String(c[0]).includes("action=role.create"))).toBe(true);
  });

  it("is only for people who hold audit.view (a clear no-access page otherwise) and appears on the Settings index for them", async () => {
    setMe(ME_NO_ROLE);
    const f = server();
    const first = renderApp("/settings/audit");
    expect(await screen.findByText("You do not have access to this page")).toBeTruthy();
    expect(f.mock.calls.filter((c) => String(c[0]).startsWith("/api/audit-logs"))).toHaveLength(0);
    first.unmount();
    setMe(ME_READY);
    server();
    renderApp("/settings");
    expect(await screen.findByRole("link", { name: /Audit log/ })).toBeTruthy();
  });
});
