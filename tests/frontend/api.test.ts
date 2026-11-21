// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { api, ApiError, apiPlain, notConfigured, setUnauthenticatedHandler } from "@/services/api";
import { json, stubFetch } from "./helpers";

describe("api client", () => {
  it("returns data from the success envelope and calls with same-origin credentials", async () => {
    const f = stubFetch(() => json({ data: { n: 1 }, meta: { requestId: "req_1" } }));
    expect(await api<{ n: number }>("/api/x")).toEqual({ n: 1 });
    const init = f.mock.calls[0]![1] as RequestInit;
    expect(init.credentials).toBe("same-origin");
    expect(init.method).toBe("GET");
  });

  it("sends JSON bodies with a content type", async () => {
    const f = stubFetch(() => json({ data: {} }));
    await api("/api/x", { method: "POST", body: { a: 1 } });
    const init = f.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBe('{"a":1}');
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("turns an error envelope into an ApiError with code, message, details and request id", async () => {
    stubFetch(() =>
      json({ error: { code: "validation_failed", message: "Bad input", details: [{ path: "name", message: "Required" }] }, meta: { requestId: "req_abc" } }, 400),
    );
    const err = await api("/api/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind: "api", status: 400, code: "validation_failed", message: "Bad input", requestId: "req_abc" });
    expect((err as ApiError).details).toEqual([{ path: "name", message: "Required" }]);
  });

  it("handles a non-JSON error page (proxy 502) without throwing a parse error", async () => {
    stubFetch(() => new Response("<html>Bad gateway</html>", { status: 502, headers: { "X-Request-Id": "req_hdr" } }));
    const err = (await api("/api/x").catch((e: unknown) => e)) as ApiError;
    expect(err).toMatchObject({ kind: "bad_response", status: 502, code: "bad_response", requestId: "req_hdr" });
    expect(err.message).toContain("HTTP 502");
    expect(err.message).not.toContain("<html>");
  });

  it("handles a 200 that is not the envelope", async () => {
    stubFetch(() => new Response("<html>hello</html>", { status: 200 }));
    expect(await api("/api/x").catch((e: unknown) => e)).toMatchObject({ kind: "bad_response" });
  });

  it("reports a network failure in plain words", async () => {
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const err = (await api("/api/x").catch((e: unknown) => e)) as ApiError;
    expect(err).toMatchObject({ kind: "network", status: 0, code: "network_error" });
    expect(err.message).toMatch(/Could not reach the server/);
  });

  it("calls the unauthenticated handler on 401 unauthenticated, and not for other errors", async () => {
    const handler = vi.fn();
    setUnauthenticatedHandler(handler);
    stubFetch(() => json({ error: { code: "unauthenticated", message: "Sign in required" } }, 401));
    await api("/api/x").catch(() => undefined);
    expect(handler).toHaveBeenCalledTimes(1);
    stubFetch(() => json({ error: { code: "permission_denied", message: "No" } }, 403));
    await api("/api/x").catch(() => undefined);
    expect(handler).toHaveBeenCalledTimes(1);
    setUnauthenticatedHandler(null);
  });

  it("recognises 'not configured' answers and the names of the missing settings", async () => {
    stubFetch(() => json({ error: { code: "server_missing_settings", message: "Server is missing: SESSION_SECRET", details: { missing: ["SESSION_SECRET"] } } }, 503));
    const err = await api("/api/x").catch((e: unknown) => e);
    expect(notConfigured(err)).toEqual({ code: "server_missing_settings", missing: ["SESSION_SECRET"] });
    expect(notConfigured(new Error("x"))).toBeNull();
    expect(notConfigured(new ApiError("api", 500, "internal_error", "x"))).toBeNull();
  });

  it("apiPlain reads routes outside the envelope", async () => {
    stubFetch(() => json({ ok: true }));
    expect(await apiPlain("/healthz")).toEqual({ ok: true });
  });
});
