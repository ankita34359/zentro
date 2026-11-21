// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { StatusPill } from "@/components/common/StatusPill";
import OverviewPage from "@/pages/OverviewPage";
import { ApiError } from "@/services/api";
import { HEALTH_OK, json, stubFetch } from "./helpers";

const withClient = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>
);

describe("ErrorState", () => {
  it("shows an API error's message and request id, and retries on click", async () => {
    const onRetry = vi.fn();
    render(<ErrorState error={new ApiError("api", 500, "internal_error", "Something went wrong", "req_42")} onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toContain("Something went wrong");
    expect(screen.getByText("req_42")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: /Try again/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("never prints the message of an unexpected (non-API) error", () => {
    render(<ErrorState error={new Error("SELECT * FROM secrets /home/user/app.js:1")} />);
    expect(screen.getByRole("alert").textContent).not.toMatch(/SELECT|secrets|\/home/);
    expect(screen.getByRole("alert").textContent).toContain("An unexpected error occurred.");
  });
});

describe("EmptyState and PageSkeleton", () => {
  it("shows the headline, guidance and a call to action", () => {
    render(<EmptyState title="Create the first thing" action={<button>Do it</button>}>Because nothing exists yet.</EmptyState>);
    expect(screen.getByRole("heading", { name: "Create the first thing" })).toBeTruthy();
    expect(screen.getByText("Because nothing exists yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Do it" })).toBeTruthy();
  });

  it("announces loading politely", () => {
    render(<PageSkeleton />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.textContent).toContain("Loading");
  });
});

describe("StatusPill (fed by /healthz)", () => {
  it("says Online with an icon when the server is ready", async () => {
    stubFetch(() => json(HEALTH_OK));
    render(withClient(<StatusPill />));
    expect(await screen.findByText("Online")).toBeTruthy();
  });

  it("says Setup incomplete when the server runs in holding mode", async () => {
    stubFetch(() => json({ ...HEALTH_OK, ready: false, migrations: null, lastTick: null, missing: ["SESSION_SECRET"] }));
    render(withClient(<StatusPill />));
    expect(await screen.findByText("Setup incomplete")).toBeTruthy();
  });

  it("says Offline when the server cannot be reached", async () => {
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    render(withClient(<StatusPill />));
    expect(await screen.findByText("Offline")).toBeTruthy();
  });
});

describe("Overview server status", () => {
  it("shows real health values, and 'None yet' before the first tick", async () => {
    stubFetch(() => json({ ...HEALTH_OK, lastTick: null }));
    render(withClient(<OverviewPage />));
    expect(await screen.findByText("2 of 2 applied")).toBeTruthy();
    expect(screen.getByText("None yet")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
  });

  it("shows an error state with retry when the server is unreachable, then recovers", async () => {
    let fail = true;
    stubFetch(() => (fail ? new Response("<html>502</html>", { status: 502 }) : json(HEALTH_OK)));
    render(withClient(<OverviewPage />));
    expect(await screen.findByText("Could not reach the server")).toBeTruthy();
    fail = false;
    await userEvent.setup().click(screen.getByRole("button", { name: /Try again/ }));
    expect(await screen.findByText("2 of 2 applied")).toBeTruthy();
  });

  it("shows a loading state first", () => {
    stubFetch(() => new Promise<Response>(() => undefined));
    render(withClient(<OverviewPage />));
    expect(screen.getByRole("status").textContent).toContain("Loading server status");
  });
});
