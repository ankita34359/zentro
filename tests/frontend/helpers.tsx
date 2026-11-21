import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import { AppProviders, AppRoutes } from "@/App";

export const HEALTH_OK = {
  ok: true,
  ready: true,
  version: "abc1234",
  node: "20.20.2",
  migrations: { applied: 2, total: 2 },
  lastTick: { startedAt: "2026-11-21T10:00:00.000Z", finishedAt: "2026-11-21T10:00:01.000Z", status: "ok" },
};

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

/** Replace window.matchMedia (jsdom has none). Returns a function that fires a "change" with the new answer. */
export function stubMatchMedia(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (q: string) => ({
    get matches() {
      return q.includes("dark") ? dark : false; // live, like a real MediaQueryList
    },
    media: q,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }));
  return (nextDark: boolean) => {
    dark = nextDark;
    listeners.forEach((l) => l());
  };
}

export function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  const fn = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(handler(String(input))));
  vi.stubGlobal("fetch", fn);
  return fn;
}

export function renderApp(path = "/overview") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AppProviders client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
}
