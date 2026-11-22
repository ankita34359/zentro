// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, envelope, HEALTH_OK, json, ME_NO_ROLE, ME_READY, renderApp, setMe, stubFetch, stubMatchMedia } from "./helpers";

beforeEach(() => stubMatchMedia(false));

const calls = (fn: ReturnType<typeof stubFetch>, path: string) => fn.mock.calls.filter((c) => String(c[0]) === path);
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));
function server(extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined) {
  return stubFetch((url, init) => extra(url, init) ?? json(HEALTH_OK));
}

const CODE = "0f0e0d0c-0b0a-4908-8706-050403020100.AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe";
const PREVIEW = { organizationName: "Acme Robotics", email: "sam@example.com", displayName: "Sam", expiresAt: "2026-12-01T00:00:00.000Z" };
const ME_SAM = { ...ME_READY, user: { id: "u2", email: "sam@example.com", name: "Sam" }, organization: null, membership: null, roles: [], needsOnboarding: true };

describe("forgot password", () => {
  beforeEach(() => setMe(null));

  it("is linked from the login page and always shows the same notice, telling the person to ask their administrator", async () => {
    const f = server((url) => (url === "/api/auth/forgot-password" ? envelope({ accepted: true, message: "If that email has an account, ask your administrator for a password reset link. Nothing is sent automatically yet." }, 202) : undefined));
    renderApp("/login");
    await userEvent.click(await screen.findByRole("link", { name: "Forgot your password?" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Forgot your password?" })).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Email"), "someone@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Ask for a reset link" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/ask your administrator/i);
    expect(bodyOf(calls(f, "/api/auth/forgot-password")[0]!)).toEqual({ email: "someone@example.com" });
  });

  it("checks the email first, and shows how long to wait when rate limited", async () => {
    const f = server((url) => (url === "/api/auth/forgot-password" ? apiError(429, "rate_limited", "Too many attempts.", { retryAfterSeconds: 120 }) : undefined));
    renderApp("/forgot-password");
    await userEvent.click(await screen.findByRole("button", { name: "Ask for a reset link" }));
    expect(screen.getByText("Enter a valid email address")).toBeTruthy();
    expect(calls(f, "/api/auth/forgot-password")).toHaveLength(0);
    await userEvent.type(screen.getByLabelText("Email"), "a@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Ask for a reset link" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/try again in 2 minutes/i);
  });
});

describe("reset password with the administrator's link", () => {
  beforeEach(() => setMe(null));

  it("reads the token from the fragment, checks the passwords, sends it in the body (never in the URL) and returns to sign in with a notice", async () => {
    const f = server((url) => (url === "/api/auth/reset-password" ? envelope({ reset: true }) : undefined));
    renderApp("/reset-password#token=tok_abc123def456ghi789jkl012mno345pqr678");
    await userEvent.type(await screen.findByLabelText("New password"), "a brand new password");
    await userEvent.type(screen.getByLabelText("Repeat the new password"), "something different");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));
    expect(screen.getByText("The two passwords do not match")).toBeTruthy();
    expect(calls(f, "/api/auth/reset-password")).toHaveLength(0);
    await userEvent.clear(screen.getByLabelText("Repeat the new password"));
    await userEvent.type(screen.getByLabelText("Repeat the new password"), "a brand new password");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/password changed/i);
    expect(bodyOf(calls(f, "/api/auth/reset-password")[0]!)).toEqual({ token: "tok_abc123def456ghi789jkl012mno345pqr678", password: "a brand new password" });
    expect(f.mock.calls.every((c) => !String(c[0]).includes("tok_abc"))).toBe(true); // the secret is in no URL
  });

  it("explains an expired, used or replaced link in the server's words, and an incomplete link", async () => {
    server((url) => (url === "/api/auth/reset-password" ? apiError(410, "reset_link_expired", "This reset link has expired. Ask your administrator for a new one.") : undefined));
    const first = renderApp("/reset-password#token=tok_abc123def456ghi789jkl012mno345pqr678");
    await userEvent.type(await screen.findByLabelText("New password"), "a brand new password");
    await userEvent.type(screen.getByLabelText("Repeat the new password"), "a brand new password");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/has expired/);
    first.unmount();
    renderApp("/reset-password");
    expect((await screen.findByRole("alert")).textContent).toMatch(/incomplete/i);
  });
});

describe("accept an invitation", () => {
  const previewOk = (url: string) => (url === "/api/auth/invitation-preview" ? envelope(PREVIEW) : undefined);

  it("a new person sees the organization and the invited email (read only), sets a name and password, and lands in the organization", async () => {
    setMe(null);
    const f = server((url) => previewOk(url) ?? (url === "/api/auth/accept-invitation" ? envelope(ME_READY) : undefined));
    renderApp(`/accept-invite#code=${CODE}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Join Acme Robotics" })).toBeTruthy();
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    expect(email.value).toBe("sam@example.com");
    expect(email.readOnly).toBe(true);
    expect(screen.queryByLabelText(/registration code/i)).toBeNull(); // the invitation replaces the code
    await userEvent.click(screen.getByRole("button", { name: "Create account and join" }));
    expect(screen.getByText("Enter your name")).toBeTruthy();
    expect(screen.getByText("Use at least 10 characters")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Your name"), "Sam Rivera");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery");
    setMe(ME_READY);
    await userEvent.click(screen.getByRole("button", { name: "Create account and join" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
    expect(bodyOf(calls(f, "/api/auth/accept-invitation")[0]!)).toEqual({ code: CODE, name: "Sam Rivera", email: "sam@example.com", password: "correct horse battery" });
    expect(bodyOf(calls(f, "/api/auth/invitation-preview")[0]!)).toEqual({ code: CODE });
    expect(f.mock.calls.every((c) => !String(c[0]).includes("AbCdEf"))).toBe(true); // the code is never in a URL
  });

  it("shows the server's reason for an expired, used, revoked or unknown invitation, and no form", async () => {
    setMe(null);
    for (const [status, code, message] of [
      [410, "invitation_expired", "This invitation has expired. Ask for a new one."],
      [410, "invitation_used", "This invitation was already used"],
      [410, "invitation_revoked", "This invitation was cancelled. Ask for a new one."],
      [404, "invitation_not_found", "This invitation link is not valid"],
    ] as const) {
      server((url) => (url === "/api/auth/invitation-preview" ? apiError(status, code, message) : undefined));
      const { unmount } = renderApp(`/accept-invite#code=${CODE}`);
      expect((await screen.findByRole("alert")).textContent).toBe(message);
      expect(screen.queryByLabelText("Password")).toBeNull();
      unmount();
    }
    server();
    renderApp("/accept-invite");
    expect((await screen.findByRole("alert")).textContent).toMatch(/send the link again/i);
  });

  it("a signed-in person with the invited email joins with one click; another account is told to log out", async () => {
    setMe(ME_SAM);
    const f = server((url) => previewOk(url) ?? (url === "/api/auth/accept-invitation" ? envelope({ ...ME_READY, user: ME_SAM.user }) : undefined));
    const first = renderApp(`/accept-invite#code=${CODE}`);
    await userEvent.click(await screen.findByRole("button", { name: "Join Acme Robotics" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
    expect(bodyOf(calls(f, "/api/auth/accept-invitation")[0]!)).toEqual({ code: CODE });
    first.unmount();
    setMe({ ...ME_SAM, user: { id: "u9", email: "other@example.com", name: "Other" } });
    renderApp(`/accept-invite#code=${CODE}`);
    expect(await screen.findByText(/signed in as other@example.com/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log out and continue" })).toBeTruthy();
  });

  it("an existing account can sign in first: the link goes to the login page", async () => {
    setMe(null);
    server(previewOk);
    renderApp(`/accept-invite#code=${CODE}`);
    const link = await screen.findByRole("link", { name: "Sign in first" });
    expect(link.getAttribute("href")).toBe("/login");
  });
});

describe("Settings → Users and invitations", () => {
  const INVITATIONS = [
    { id: "i1", membershipId: "m9", email: "sam@example.com", displayName: "Sam", status: "pending", expiresAt: "2026-12-01T00:00:00.000Z", createdAt: "2026-11-24T00:00:00.000Z", acceptedAt: null, invitedBy: "Ada", roleName: null },
    { id: "i2", membershipId: "m8", email: "old@example.com", displayName: "Old", status: "expired", expiresAt: "2026-11-01T00:00:00.000Z", createdAt: "2026-10-25T00:00:00.000Z", acceptedAt: null, invitedBy: "Ada", roleName: null },
    { id: "i3", membershipId: "m7", email: "done@example.com", displayName: "Done", status: "accepted", expiresAt: "2026-11-20T00:00:00.000Z", createdAt: "2026-11-13T00:00:00.000Z", acceptedAt: "2026-11-14T00:00:00.000Z", invitedBy: "Ada", roleName: null },
  ];
  const MEMBERS = [
    { id: "m1", displayName: "Ada Lovelace", email: "ada@example.com", status: "active", hasLogin: true, roles: [{ key: "owner", name: "Owner" }], isYou: true },
    { id: "m2", displayName: "Bo Builder", email: "bo@example.com", status: "active", hasLogin: true, roles: [], isYou: false },
    { id: "m9", displayName: "Sam", email: "sam@example.com", status: "invited", hasLogin: false, roles: [], isYou: false },
  ];
  const api = (extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined) =>
    server((url, init) => {
      if (url === "/api/invitations" && (init?.method ?? "GET") === "GET") return envelope(INVITATIONS);
      if (url === "/api/organization/members") return envelope(MEMBERS);
      return extra(url, init);
    });

  it("is reached from Settings, and shows invitations with their state and the people list", async () => {
    api();
    renderApp("/settings");
    await userEvent.click(await screen.findByRole("link", { name: /Users and invitations/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "Users and invitations" })).toBeTruthy();
    const list = await screen.findByRole("list", { name: "Invitations" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getByText("Pending")).toBeTruthy();
    expect(within(list).getByText("Expired")).toBeTruthy();
    expect(within(list).getByText("Accepted")).toBeTruthy();
    expect(within(await screen.findByRole("list", { name: "People" })).getByText("Not joined yet")).toBeTruthy();
  });

  it("a person whose roles do not allow it is told so on the page, and the server is never asked", async () => {
    setMe(ME_NO_ROLE);
    const f = api();
    renderApp("/settings/users");
    expect(await screen.findByText("You do not have access to this page")).toBeTruthy();
    expect(calls(f, "/api/invitations")).toHaveLength(0);
  });

  it("creating an invitation shows the copyable link once, built from the code in the fragment; hiding it removes it", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const f = api((url, init) => (url === "/api/invitations" && init?.method === "POST" ? envelope({ invitation: { ...INVITATIONS[0], id: "i4", email: "new@example.com" }, code: CODE, expiresAt: "2026-12-01T00:00:00.000Z" }, 201) : undefined));
    renderApp("/settings/users");
    await userEvent.type(await screen.findByLabelText("Email"), "new@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Create invitation" }));
    const box = await screen.findByRole("region", { name: /Invitation link for new@example.com/ });
    const field = within(box).getByRole("textbox") as HTMLInputElement;
    expect(field.value).toBe(`${window.location.origin}/accept-invite#code=${encodeURIComponent(CODE)}`);
    expect(within(box).getByText(/shown once/i)).toBeTruthy();
    await userEvent.click(within(box).getByRole("button", { name: /Copy link/ }));
    expect(writeText).toHaveBeenCalledWith(field.value);
    expect(await within(box).findByText("Copied")).toBeTruthy();
    expect(bodyOf(calls(f, "/api/invitations").find((c) => (c[1] as RequestInit)?.method === "POST")!)).toEqual({ email: "new@example.com" });
    await userEvent.click(within(box).getByRole("button", { name: "Hide this link" }));
    expect(screen.queryByRole("region", { name: /Invitation link/ })).toBeNull();
    expect(document.body.textContent).not.toContain("AbCdEf"); // gone from the page for good
  });

  it("asks for a valid email before calling the server, and shows a duplicate in plain words", async () => {
    const f = api((url, init) => (url === "/api/invitations" && init?.method === "POST" ? apiError(409, "already_exists", "There is already an open invitation for this email. Regenerate its link instead.") : undefined));
    renderApp("/settings/users");
    await userEvent.click(await screen.findByRole("button", { name: "Create invitation" }));
    expect(screen.getByText("Enter a valid email address")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Email"), "dup@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Create invitation" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/already an open invitation/);
    expect(calls(f, "/api/invitations").filter((c) => (c[1] as RequestInit)?.method === "POST")).toHaveLength(1);
  });

  it("New link shows a fresh one-time link; Revoke asks for confirmation first, then calls the server", async () => {
    const f = api((url, init) => {
      if (url === "/api/invitations/i1/regenerate") return envelope({ invitation: INVITATIONS[0], code: CODE, expiresAt: "2026-12-08T00:00:00.000Z" });
      if (url === "/api/invitations/i1/revoke") return envelope({ ...INVITATIONS[0], status: "revoked" });
      return init ? undefined : undefined;
    });
    renderApp("/settings/users");
    await userEvent.click(await screen.findByRole("button", { name: "New link for sam@example.com" }));
    expect(await screen.findByRole("region", { name: /Invitation link for sam@example.com/ })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Revoke the invitation for sam@example.com" }));
    expect(calls(f, "/api/invitations/i1/revoke")).toHaveLength(0); // not yet: needs a second click
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: /Confirm revoking/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Revoke the invitation for sam@example.com" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm revoking the invitation for sam@example.com" }));
    await waitFor(() => expect(calls(f, "/api/invitations/i1/revoke")).toHaveLength(1));
    expect((calls(f, "/api/invitations/i1/revoke")[0]![1] as RequestInit).method).toBe("POST");
  });

  it("offers a reset link only for people who can sign in and are not you; the link is shown once with the token in the fragment", async () => {
    const TOKEN = "ResetTokenResetTokenResetTokenResetTokenAb1";
    const f = api((url) => (url === "/api/people/m2/reset-link" ? envelope({ token: TOKEN, expiresAt: "2026-11-24T13:00:00.000Z", displayName: "Bo Builder" }, 201) : undefined));
    renderApp("/settings/users");
    const people = await screen.findByRole("list", { name: "People" });
    expect(within(people).getAllByRole("button", { name: /Reset password link/ })).toHaveLength(1); // not you, not the person who has not joined
    await userEvent.click(within(people).getByRole("button", { name: "Reset password link for Bo Builder" }));
    const box = await screen.findByRole("region", { name: /Password reset link for Bo Builder/ });
    expect((within(box).getByRole("textbox") as HTMLInputElement).value).toBe(`${window.location.origin}/reset-password#token=${TOKEN}`);
    expect(within(box).getByText(/works once/i)).toBeTruthy();
    expect((calls(f, "/api/people/m2/reset-link")[0]![1] as RequestInit).method).toBe("POST");
  });
});

describe("Settings → Profile: change password", () => {
  it("checks the fields, sends the current and new password, and confirms", async () => {
    const f = server((url) => (url === "/api/auth/change-password" ? envelope({ changed: true }) : undefined));
    renderApp("/settings/profile");
    await userEvent.click(await screen.findByRole("button", { name: "Change password" }));
    expect(screen.getByText("Enter your current password")).toBeTruthy();
    expect(screen.getByText("Use at least 10 characters")).toBeTruthy();
    expect(calls(f, "/api/auth/change-password")).toHaveLength(0);
    await userEvent.type(screen.getByLabelText("Current password"), "old password here");
    await userEvent.type(screen.getByLabelText("New password"), "a brand new password");
    await userEvent.type(screen.getByLabelText("Repeat the new password"), "a brand new password");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/other devices were signed out/i);
    expect(bodyOf(calls(f, "/api/auth/change-password")[0]!)).toEqual({ currentPassword: "old password here", newPassword: "a brand new password" });
    expect((screen.getByLabelText("Current password") as HTMLInputElement).value).toBe(""); // fields are cleared
  });

  it("shows the server's message for a wrong current password", async () => {
    server((url) => (url === "/api/auth/change-password" ? apiError(403, "current_password_incorrect", "The current password is not right") : undefined));
    renderApp("/settings/profile");
    await userEvent.type(await screen.findByLabelText("Current password"), "wrong one here");
    await userEvent.type(screen.getByLabelText("New password"), "a brand new password");
    await userEvent.type(screen.getByLabelText("Repeat the new password"), "a brand new password");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The current password is not right");
  });
});
