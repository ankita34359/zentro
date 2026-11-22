import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, vi } from "vitest";
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
export function stubMatchMedia(initialDark: boolean, reducedMotion = false) {
  let dark = initialDark;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (q: string) => ({
    get matches() {
      if (q.includes("reduced-motion")) return reducedMotion;
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

export const ME_READY = {
  user: { id: "u1", email: "ada@example.com", name: "Ada Lovelace" },
  organization: { id: "o1", name: "Acme Robotics", slug: "acme-robotics", timezone: "UTC" },
  membership: { id: "m1", displayName: "Ada Lovelace" },
  roles: ["owner"],
  capabilities: [],
  needsOnboarding: false,
};
export const ME_ONBOARDING = { ...ME_READY, organization: null, membership: null, roles: [], needsOnboarding: true };

/** Who the stubbed server says is signed in (null = nobody). Reset to "signed in with an organization" before every test. */
let signedInAs: unknown = ME_READY;
export const setMe = (me: unknown) => {
  signedInAs = me;
};
afterEach(() => {
  signedInAs = ME_READY;
});
export const envelope = (data: unknown, status = 200) => json({ data, meta: { requestId: "req_test" } }, status);
export const apiError = (status: number, code: string, message: string, details?: unknown) =>
  json({ error: { code, message, ...(details ? { details } : {}) }, meta: { requestId: "req_test" } }, status);

export function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    // Pages that are not about signing in get a signed-in person unless the test says otherwise.
    if (url === "/api/auth/me" && (init?.method ?? "GET") === "GET") {
      return Promise.resolve(signedInAs ? envelope(signedInAs) : apiError(401, "unauthenticated", "Sign in required"));
    }
    return Promise.resolve(handler(url, init));
  });
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
