// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { OfflineBanner } from "@/components/common/OfflineBanner";
import { ApiError } from "@/services/api";
import { HEALTH_OK, json, renderApp, stubFetch, stubMatchMedia } from "./helpers";

beforeEach(() => stubMatchMedia(false));
const Boom = ({ error }: { error: unknown }): never => { throw error; };

describe("friendly errors (batch K)", () => {
  it("a page that crashes shows 'Something went wrong' with a reference, and never a stack trace or the error's own words", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<ErrorBoundary><Boom error={new Error("Cannot read properties of undefined (reading 'secretField')")} /></ErrorBoundary>);
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeTruthy();
    expect(screen.getByText(/browser-[a-z0-9]+/)).toBeTruthy();
    expect(screen.getByText(/not in the server's log/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/secretField|Cannot read|at Object|\.tsx/);
    expect(screen.getByRole("button", { name: "Reload the page" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Overview" }).getAttribute("href")).toBe("/overview");
    spy.mockRestore();
  });

  it("when the problem came from the server, the reference is the request id that is in the server's log", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<ErrorBoundary><Boom error={new ApiError("api", 500, "internal_error", "Something went wrong", "req_abc123")} /></ErrorBoundary>);
    expect(screen.getByText("req_abc123")).toBeTruthy();
    expect(screen.getByText(/same number is in the server's log/)).toBeTruthy();
    spy.mockRestore();
  });

  it("a missing page shows the 404 page, signed in or not, with a way back", async () => {
    stubFetch(() => json(HEALTH_OK));
    renderApp("/this-page-does-not-exist");
    expect(await screen.findByText("Page not found")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Overview" })).toBeTruthy();
  });

  it("an offline banner appears when the server does not answer, offers Retry, and disappears when it is back", async () => {
    let down = true;
    stubFetch(() => (down ? new Response("<html>502 Bad Gateway</html>", { status: 502 }) : json(HEALTH_OK)));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><OfflineBanner /></MemoryRouter></QueryClientProvider>);
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toMatch(/cannot reach the server/i);
    expect(banner.textContent).not.toMatch(/502|Bad Gateway|<html/);
    down = false;
    await userEvent.setup().click(screen.getByRole("button", { name: /Retry/ }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
