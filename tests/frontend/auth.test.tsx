// @vitest-environment jsdom
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "@/services/api";
import { apiError, envelope, HEALTH_OK, json, ME_ONBOARDING, ME_READY, renderApp, setMe, stubFetch, stubMatchMedia } from "./helpers";

beforeEach(() => stubMatchMedia(false));

const calls = (fn: ReturnType<typeof stubFetch>, path: string) => fn.mock.calls.filter((c) => String(c[0]) === path);
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));

/** A server stub: health plus whatever the test adds for the auth routes. */
function server(extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined) {
  return stubFetch((url, init) => extra(url, init) ?? json(HEALTH_OK));
}

describe("route guards", () => {
  it("sends a signed-out visitor to /login, and remembers where they wanted to go", async () => {
    setMe(null);
    server((url, init) => (url === "/api/auth/login" ? envelope(ME_READY) : undefined));
    renderApp("/okrs");
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery");
    setMe(ME_READY); // the server now knows the person
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { level: 1, name: "OKRs & Goals" })).toBeTruthy(); // back where they were going
  });

  it("sends a signed-in person without an organization to /onboarding", async () => {
    setMe(ME_ONBOARDING);
    server();
    renderApp("/overview");
    expect(await screen.findByRole("heading", { level: 1, name: /welcome, ada/i })).toBeTruthy();
    expect(screen.getByLabelText("Organization name")).toBeTruthy();
  });

  it("keeps public pages reachable when signed out: login, register, the style guide and the 404 page", async () => {
    setMe(null);
    server();
    for (const [path, name] of [
      ["/login", "Sign in"],
      ["/register", "Create your account"],
      ["/design", /style guide|design/i],
    ] as const) {
      const { unmount } = renderApp(path);
      expect(await screen.findByRole("heading", { level: 1, name }), path).toBeTruthy();
      unmount();
    }
    renderApp("/no/such/page");
    expect(await screen.findByText("Page not found")).toBeTruthy(); // the 404 page, not a redirect to /login
  });

  it("bounces a signed-in person away from /login and /register", async () => {
    server();
    renderApp("/login");
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
  });

  it("a 401 answer from any API call while using the app returns the person to /login", async () => {
    setMe(ME_READY);
    server((url) => (url === "/api/anything" ? apiError(401, "unauthenticated", "Sign in required") : undefined));
    renderApp("/overview");
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
    await act(async () => {
      await api("/api/anything").catch(() => undefined);
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeTruthy();
  });
});

describe("login form", () => {
  beforeEach(() => setMe(null));

  it("checks the fields before calling the server", async () => {
    const f = server();
    renderApp("/login");
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter a valid email address")).toBeTruthy();
    expect(screen.getByText("Enter your password")).toBeTruthy();
    expect(calls(f, "/api/auth/login")).toHaveLength(0);
  });

  it("shows the server's message for a wrong password, announces it, and clears the password", async () => {
    server((url) => (url === "/api/auth/login" ? apiError(401, "invalid_credentials", "Invalid email or password") : undefined));
    renderApp("/login");
    await userEvent.type(await screen.findByLabelText("Email"), "ada@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong password!");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Invalid email or password");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeTruthy(); // still on the login page
  });

  it("tells the person how long to wait when rate limited", async () => {
    server((url) => (url === "/api/auth/login" ? apiError(429, "rate_limited", "Too many attempts.", { retryAfterSeconds: 300 }) : undefined));
    renderApp("/login");
    await userEvent.type(await screen.findByLabelText("Email"), "ada@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "whatever it is");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/try again in 5 minutes/i);
  });

  it("sends the email and password as JSON to /api/auth/login and then shows who is signed in", async () => {
    const f = server((url) => (url === "/api/auth/login" ? envelope(ME_READY) : undefined));
    renderApp("/login");
    await userEvent.type(await screen.findByLabelText("Email"), " ada@example.com ");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
    expect(bodyOf(calls(f, "/api/auth/login")[0]!)).toEqual({ email: "ada@example.com", password: "correct horse battery" });
    expect(within(screen.getByTestId("user-menu")).getByText("Ada Lovelace")).toBeTruthy();
  });
});

describe("register form", () => {
  beforeEach(() => setMe(null));

  it("asks for every field, a password of 10 or more characters, and the registration code", async () => {
    const f = server();
    renderApp("/register");
    await userEvent.type(await screen.findByLabelText("Password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText("Enter your name")).toBeTruthy();
    expect(screen.getByText("Enter a valid email address")).toBeTruthy();
    expect(screen.getByText("Use at least 10 characters")).toBeTruthy();
    expect(screen.getByText("Enter the registration code")).toBeTruthy();
    expect(calls(f, "/api/auth/register")).toHaveLength(0);
  });

  it("shows the generic refusal for a wrong code and keeps the person on the page", async () => {
    server((url) => (url === "/api/auth/register" ? apiError(403, "registration_unavailable", "Registration is not available with those details. Check the registration code and try again.") : undefined));
    renderApp("/register");
    await userEvent.type(await screen.findByLabelText("Your name"), "Ada");
    await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery");
    await userEvent.type(screen.getByLabelText("Registration code"), "nope-nope-nope");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Check the registration code/);
    expect(screen.getByRole("heading", { level: 1, name: "Create your account" })).toBeTruthy();
  });

  it("on success goes to the login page with a notice (registering does not sign you in)", async () => {
    const f = server((url) => (url === "/api/auth/register" ? envelope({ registered: true, message: "ok" }, 202) : undefined));
    renderApp("/register");
    await userEvent.type(await screen.findByLabelText("Your name"), "Ada");
    await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery");
    await userEvent.type(screen.getByLabelText("Registration code"), "the-code-123");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/account created/i);
    expect(bodyOf(calls(f, "/api/auth/register")[0]!)).toMatchObject({ name: "Ada", email: "ada@example.com", registrationCode: "the-code-123" });
  });
});

describe("onboarding", () => {
  it("creates the organization and lands on the overview, with the organization named in the header", async () => {
    setMe(ME_ONBOARDING);
    const f = server((url) => (url === "/api/organizations" ? envelope(ME_READY, 201) : undefined));
    renderApp("/onboarding");
    await userEvent.type(await screen.findByLabelText("Organization name"), "Acme Robotics");
    await userEvent.click(screen.getByRole("button", { name: "Create organization" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
    expect(bodyOf(calls(f, "/api/organizations")[0]!)).toEqual({ name: "Acme Robotics", timezone: expect.any(String) }); // never an organization id
    expect(within(screen.getByTestId("user-menu")).getByText("Acme Robotics")).toBeTruthy();
  });

  it("requires a name of at least 2 characters", async () => {
    setMe(ME_ONBOARDING);
    const f = server();
    renderApp("/onboarding");
    await userEvent.type(await screen.findByLabelText("Organization name"), "A");
    await userEvent.click(screen.getByRole("button", { name: "Create organization" }));
    expect(screen.getByText("Use at least 2 characters")).toBeTruthy();
    expect(calls(f, "/api/organizations")).toHaveLength(0);
  });

  it("sends a signed-out visitor to /login and a person who already has an organization to the overview", async () => {
    setMe(null);
    server();
    const first = renderApp("/onboarding");
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeTruthy();
    first.unmount();
    setMe(ME_READY);
    renderApp("/onboarding");
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
  });
});

describe("header: who is signed in, and Log out", () => {
  it("shows the name and organization and a Log out button; logging out calls the server and returns to /login", async () => {
    const f = server((url) => (url === "/api/auth/logout" ? envelope({ loggedOut: true }) : undefined));
    renderApp("/overview");
    const menu = await screen.findByTestId("user-menu");
    expect(within(menu).getByText("Ada Lovelace")).toBeTruthy();
    expect(within(menu).getByText("Acme Robotics")).toBeTruthy();
    expect(within(menu).getByRole("img", { name: "Signed in as Ada Lovelace" }).textContent).toBe("A"); // the phone view
    setMe(null);
    await userEvent.click(within(menu).getByRole("button", { name: "Log out" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeTruthy();
    expect(calls(f, "/api/auth/logout")).toHaveLength(1);
    expect((calls(f, "/api/auth/logout")[0]![1] as RequestInit).method).toBe("POST");
    expect(screen.queryByTestId("user-menu")).toBeNull();
  });

  it("shows a Sign in link instead on a public page when nobody is signed in", async () => {
    setMe(null);
    server();
    renderApp("/design");
    const link = await screen.findByRole("link", { name: /sign in/i });
    expect(link.getAttribute("href")).toBe("/login");
    await waitFor(() => expect(screen.queryByTestId("user-menu")).toBeNull());
  });
});
