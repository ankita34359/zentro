// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { apiError, envelope, HEALTH_OK, json, ME_NO_ROLE, ME_READY, renderApp, setMe, stubFetch, stubMatchMedia } from "./helpers";

beforeEach(() => stubMatchMedia(false));

const calls = (fn: ReturnType<typeof stubFetch>, path: string) => fn.mock.calls.filter((c) => String(c[0]) === path);
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));
function server(extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined) {
  return stubFetch((url, init) => extra(url, init) ?? json(HEALTH_OK));
}
/** A person who holds only these permissions. */
const withCaps = (caps: string[], name = "Some Role") => ({ ...ME_READY, roles: [{ key: "x", name }], capabilities: Object.fromEntries(caps.map((c) => [c, ["all_in_scope"]])) });

/** The sidebar once the signed-in person is known (it shows only items that need no permission until then). */
const sidebarLabels = async (settled: (labels: (string | null)[]) => boolean = () => true) => {
  const nav = await screen.findByRole("navigation", { name: "Main" });
  let labels: (string | null)[] = [];
  await waitFor(() => {
    labels = within(nav).getAllByRole("link").map((a) => a.textContent);
    expect(settled(labels)).toBe(true);
  });
  return labels;
};

describe("the sidebar follows what the person may do (a convenience; the server decides)", () => {
  it("an Owner sees all eleven items", async () => {
    server();
    renderApp("/overview");
    expect(await sidebarLabels((l) => l.length === 11)).toHaveLength(11);
  });

  it("a person with no permissions sees the items that need none, and Settings; items needing a permission are hidden", async () => {
    setMe(ME_NO_ROLE);
    server();
    renderApp("/overview");
    const labels = await sidebarLabels((l) => l.length >= 6);
    expect(labels).toEqual(["Overview", "OKRs & Goals", "My Work", "Team Performance", "Performance Intelligence", "Settings"]);
    expect(labels).not.toContain("Organization");
    expect(labels).not.toContain("Leadership");
  });

  it("each hidden item reappears when its permission is granted, and an empty group heading is not shown", async () => {
    setMe(withCaps(["org.view", "leadership.view"]));
    server();
    renderApp("/overview");
    const labels = await sidebarLabels((l) => l.includes("Organization"));
    expect(labels).toContain("Organization");
    expect(labels).toContain("Leadership");
    expect(labels).not.toContain("KPIs");
    expect(labels).not.toContain("Integrations");
  });
});

describe("a person with no role and the pages they can still open", () => {
  it("OKRs, Team Performance and Performance Intelligence show only the placeholder: the browser asks the server for nothing but who they are and the health check", async () => {
    setMe(ME_NO_ROLE);
    const f = server();
    for (const [path, title] of [["/okrs", "OKRs & Goals"], ["/team-performance", "Team Performance"], ["/performance", "Performance Intelligence"]] as const) {
      const { unmount } = renderApp(path);
      expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
      expect(screen.getByText(/Planned for stage \d\.\d/)).toBeTruthy(); // no data, no numbers: an honest "not built yet"
      unmount();
    }
    const urls = new Set(f.mock.calls.map((c) => String(c[0])));
    expect([...urls].filter((u) => u !== "/api/auth/me" && u !== "/healthz")).toEqual([]); // no organization data was requested
  });
});

describe("pages that need a permission", () => {
  it("/settings/users and /settings/roles show a clear message (and ask nothing) for someone without the permission", async () => {
    setMe(ME_NO_ROLE);
    const f = server();
    for (const path of ["/settings/users", "/settings/roles"]) {
      const { unmount } = renderApp(path);
      expect(await screen.findByText("You do not have access to this page")).toBeTruthy();
      unmount();
    }
    expect(f.mock.calls.filter((c) => /\/api\/(roles|invitations|organization\/members)/.test(String(c[0])))).toHaveLength(0);
  });

  it("the Settings index lists only what the person can open; Profile is always there", async () => {
    setMe(ME_NO_ROLE);
    server();
    const first = renderApp("/settings");
    await screen.findByRole("heading", { level: 1, name: "Settings" });
    expect(screen.queryByRole("link", { name: /Users and invitations/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Roles/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Profile/ })).toBeTruthy();
    first.unmount();
    setMe(withCaps(["roles.view"]));
    renderApp("/settings");
    expect(await screen.findByRole("link", { name: /^Roles/ })).toBeTruthy();
  });
});

describe("Users: what shows depends on the permission", () => {
  const INVS = [{ id: "i1", membershipId: "m9", email: "sam@example.com", displayName: "Sam", status: "pending", expiresAt: "2026-12-01T00:00:00.000Z", createdAt: "2026-11-24T00:00:00.000Z", acceptedAt: null, invitedBy: "Ada", roleName: "Employee" }];
  const MEMBERS = [{ id: "m2", displayName: "Bo Builder", email: "bo@example.com", status: "active", hasLogin: true, roles: [{ key: "employee", name: "Employee" }], isYou: false }];
  const ROLES = [
    { id: "r1", key: "employee", name: "Employee", description: "", kind: "template", permissionCount: 14, holderCount: 2 },
    { id: "r2", key: "manager", name: "Manager", description: "", kind: "template", permissionCount: 30, holderCount: 0 },
  ];
  const api = (extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined) =>
    server((url, init) => {
      if (url === "/api/invitations" && (init?.method ?? "GET") === "GET") return envelope(INVS);
      if (url === "/api/organization/members") return envelope(MEMBERS);
      if (url === "/api/roles") return envelope(ROLES);
      return extra(url, init);
    });

  it("invitations.manage alone: the invite form and the invitation list, but not the people list or reset buttons", async () => {
    setMe(withCaps(["invitations.manage"]));
    const f = api();
    renderApp("/settings/users");
    expect(await screen.findByRole("button", { name: "Create invitation" })).toBeTruthy();
    expect(await screen.findByRole("list", { name: "Invitations" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "People" })).toBeNull();
    expect(calls(f, "/api/organization/members")).toHaveLength(0);
    expect(screen.queryByLabelText("Role (optional)")).toBeNull(); // no roles.view: no role picker
    expect(calls(f, "/api/roles")).toHaveLength(0);
  });

  it("people.manage alone: the people list with reset links, but no invite form", async () => {
    setMe(withCaps(["people.manage"]));
    const f = api();
    renderApp("/settings/users");
    expect(await screen.findByRole("list", { name: "People" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset password link for Bo Builder" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create invitation" })).toBeNull();
    expect(calls(f, "/api/invitations")).toHaveLength(0);
  });

  it("with roles.view the invite form offers the roles and sends the chosen one; the invitation shows its role", async () => {
    const f = api((url, init) => (url === "/api/invitations" && init?.method === "POST" ? envelope({ invitation: { ...INVS[0], id: "i2", email: "new@example.com" }, code: "c".repeat(30), expiresAt: "2026-12-01T00:00:00.000Z" }, 201) : undefined));
    renderApp("/settings/users");
    const select = (await screen.findByLabelText("Role (optional)")) as HTMLSelectElement;
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["No role yet", "Employee", "Manager"]);
    await userEvent.type(screen.getByLabelText("Email"), "new@example.com");
    await userEvent.selectOptions(select, "Manager");
    await userEvent.click(screen.getByRole("button", { name: "Create invitation" }));
    await screen.findByRole("region", { name: /Invitation link for new@example.com/ });
    expect(bodyOf(calls(f, "/api/invitations").find((c) => (c[1] as RequestInit)?.method === "POST")!)).toEqual({ email: "new@example.com", roleId: "r2" });
    expect(within(await screen.findByRole("list", { name: "Invitations" })).getByText("Employee")).toBeTruthy();
  });

  it("shows the server's refusal when the role is more than the inviter holds", async () => {
    api((url, init) => (url === "/api/invitations" && init?.method === "POST" ? apiError(403, "cannot_grant_role", "You can only invite people into a role whose permissions you hold yourself") : undefined));
    renderApp("/settings/users");
    await userEvent.type(await screen.findByLabelText("Email"), "new@example.com");
    await userEvent.selectOptions(screen.getByLabelText("Role (optional)"), "Manager");
    await userEvent.click(screen.getByRole("button", { name: "Create invitation" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/whose permissions you hold/);
  });
});

describe("Settings → Roles (read only)", () => {
  const ROLES = [
    { id: "r1", key: "owner", name: "Owner", description: "Full control.", kind: "template", permissionCount: 54, holderCount: 1 },
    { id: "r2", key: "manager", name: "Manager", description: "Manages reports.", kind: "template", permissionCount: 30, holderCount: 0 },
  ];
  const DETAIL = {
    ...ROLES[1],
    permissions: [
      { key: "org.view", module: "Organization", description: "See departments, teams, org chart", sensitive: false, modes: ["reports", "my_teams"], allowedModes: ["own", "my_teams", "reports", "all_in_scope"] },
      { key: "people.view_sensitive", module: "People", description: "Employment details", sensitive: true, modes: ["reports"], allowedModes: ["own", "reports", "all_in_scope"] },
    ],
  };
  it("lists the roles with their counts, shows the chosen role's permissions with their reach, and says it is read only", async () => {
    const f = server((url) => (url === "/api/roles" ? envelope(ROLES) : url === "/api/roles/r2" ? envelope(DETAIL) : url === "/api/roles/r1" ? envelope({ ...ROLES[0], permissions: [] }) : undefined));
    renderApp("/settings/roles");
    const list = await screen.findByRole("list", { name: "Roles" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("54 permissions")).toBeTruthy();
    expect(screen.getByText(/Read only\. Editing roles and assigning them arrives in stage 2\.4/)).toBeTruthy();
    await userEvent.click(within(list).getByRole("button", { name: /Manager/ }));
    const org = await screen.findByRole("region", { name: "Organization" });
    expect(within(org).getByText("org.view")).toBeTruthy();
    expect(within(org).getByText("Reports")).toBeTruthy();
    expect(within(org).getByText("My teams")).toBeTruthy();
    const people = screen.getByRole("region", { name: "People" });
    expect(within(people).getByText("Sensitive")).toBeTruthy(); // marked by words, not colour alone
    expect(calls(f, "/api/roles/r2")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /save|edit|delete role/i })).toBeNull(); // nothing to change
  });

  it("shows a clear error when the server refuses", async () => {
    setMe(ME_READY);
    server((url) => (url === "/api/roles" ? apiError(403, "permission_denied", "Not allowed") : undefined));
    renderApp("/settings/roles");
    expect((await screen.findByRole("alert")).textContent).toMatch(/Not allowed/);
  });
});

describe("Delete my account (Profile)", () => {
  const preview = (p: Record<string, unknown>) => (url: string) => (url === "/api/auth/delete-account/preview" ? envelope(p) : undefined);

  it("an ordinary member sees what happens, must type their password and email, and is signed out with a notice", async () => {
    const f = server((url, init) =>
      preview({ mode: "account_only", organizationName: "Acme Robotics", others: 2, pendingInvitations: 0, reason: null })(url) ?? (url === "/api/auth/delete-account" && init?.method === "POST" ? envelope({ deleted: true, organizationDeleted: false }) : undefined),
    );
    renderApp("/settings/profile");
    expect(calls(f, "/api/auth/delete-account/preview")).toHaveLength(0); // nothing is asked until the person opens it
    await userEvent.click(await screen.findByRole("button", { name: "Delete my account…" }));
    expect(await screen.findByText(/Your login is erased and you leave Acme Robotics/)).toBeTruthy();
    expect(screen.getByText(/The organization and the other people carry on/)).toBeTruthy();
    expect(screen.queryByLabelText(/organization name/i)).toBeNull();
    const confirm = screen.getByRole("button", { name: "Delete my account" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true); // password and email are required first
    await userEvent.type(screen.getByLabelText("Your password"), "correct horse battery");
    await userEvent.type(screen.getByLabelText(/Type your email/), "ada@example.com");
    setMe(null);
    await userEvent.click(confirm);
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/account was deleted/i);
    expect(bodyOf(calls(f, "/api/auth/delete-account")[0]!)).toEqual({ password: "correct horse battery", confirmEmail: "ada@example.com" });
  });

  it("the only member gets a strong warning that the organization goes too, and must type its name as well", async () => {
    const f = server((url, init) =>
      preview({ mode: "account_and_organization", organizationName: "Acme Robotics", others: 0, pendingInvitations: 0, reason: null })(url) ?? (url === "/api/auth/delete-account" && init?.method === "POST" ? envelope({ deleted: true, organizationDeleted: true }) : undefined),
    );
    renderApp("/settings/profile");
    await userEvent.click(await screen.findByRole("button", { name: "Delete my account…" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/This also deletes the organization .Acme Robotics./);
    expect(screen.getByText(/There is no undo and no backup/)).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Delete my account and the organization" }) as HTMLButtonElement;
    await userEvent.type(screen.getByLabelText("Your password"), "correct horse battery");
    await userEvent.type(screen.getByLabelText(/Type your email/), "ada@example.com");
    expect(confirm.disabled).toBe(true); // still needs the organization name
    await userEvent.type(screen.getByLabelText(/Type the organization name/), "Acme Robotics");
    expect(confirm.disabled).toBe(false);
    setMe(null);
    await userEvent.click(confirm);
    await screen.findByRole("heading", { level: 1, name: "Sign in" });
    expect(bodyOf(calls(f, "/api/auth/delete-account")[0]!)).toEqual({ password: "correct horse battery", confirmEmail: "ada@example.com", confirmOrganizationName: "Acme Robotics" });
  });

  it("explains why deleting is blocked (pending invitations, or last administrator) and offers no confirm button", async () => {
    server(preview({ mode: "blocked", organizationName: "Acme Robotics", others: 0, pendingInvitations: 2, reason: "pending_invitations" }));
    const first = renderApp("/settings/profile");
    await userEvent.click(await screen.findByRole("button", { name: "Delete my account…" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/2 invitations are still pending/);
    expect(screen.queryByLabelText("Your password")).toBeNull();
    first.unmount();
    server(preview({ mode: "blocked", organizationName: "Acme Robotics", others: 3, pendingInvitations: 0, reason: "last_admin" }));
    renderApp("/settings/profile");
    await userEvent.click(await screen.findByRole("button", { name: "Delete my account…" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/last administrator of Acme Robotics, and 3 other people remain/);
  });

  it("shows the server's message for a wrong password, keeps the person signed in, and Cancel closes the panel", async () => {
    server((url, init) => preview({ mode: "account_only", organizationName: null, others: 0, pendingInvitations: 0, reason: null })(url) ?? (init?.method === "POST" && url === "/api/auth/delete-account" ? apiError(403, "current_password_incorrect", "The password is not right") : undefined));
    renderApp("/settings/profile");
    await userEvent.click(await screen.findByRole("button", { name: "Delete my account…" }));
    await userEvent.type(await screen.findByLabelText("Your password"), "wrong");
    await userEvent.type(screen.getByLabelText(/Type your email/), "ada@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    expect((await screen.findAllByRole("alert")).map((a) => a.textContent).join(" ")).toMatch(/The password is not right/);
    expect(screen.getByRole("heading", { level: 1, name: "Profile" })).toBeTruthy(); // still here
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Delete my account…" })).toBeTruthy();
  });

  it("the profile shows the person's role names", async () => {
    server();
    renderApp("/settings/profile");
    expect(await screen.findByText("Owner")).toBeTruthy();
  });
});
