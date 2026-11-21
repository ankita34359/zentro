/**
 * The one place the browser talks to the server. Reads the API envelope
 * ({ data, meta.requestId } or { error: { code, message, details }, meta.requestId }) and turns every failure into
 * an ApiError that pages can show without guessing: a real server error, an unexpected (non-JSON) answer such as a
 * proxy error page, or a network failure.
 */
export type ApiErrorKind = "api" | "bad_response" | "network";

export class ApiError extends Error {
  constructor(
    public readonly kind: ApiErrorKind,
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId: string | null = null,
    public readonly details: unknown = undefined,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const NOT_CONFIGURED_CODES = new Set(["server_missing_settings", "ai_not_configured", "viasocket_not_configured"]);

/** 503 "not configured" answers: pages show an empty state that names the missing settings. */
export function notConfigured(err: unknown): { code: string; missing: string[] } | null {
  if (!(err instanceof ApiError) || err.status !== 503 || !NOT_CONFIGURED_CODES.has(err.code)) return null;
  const missing = (err.details as { missing?: unknown } | undefined)?.missing;
  return { code: err.code, missing: Array.isArray(missing) ? missing.filter((m): m is string => typeof m === "string") : [] };
}

let onUnauthenticated: (() => void) | null = null;
/** Stage 2.1 registers the "clear the session and go to /login" handler here. */
export function setUnauthenticatedHandler(fn: (() => void) | null): void {
  onUnauthenticated = fn;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

async function send(path: string, opts: RequestOptions): Promise<{ res: Response; json: unknown }> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json", ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError("network", 0, "network_error", "Could not reach the server. Check your connection and try again.");
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, json };
}

function fail(res: Response, json: unknown): never {
  const headerId = res.headers.get("x-request-id");
  const env = json as { error?: { code?: string; message?: string; details?: unknown }; meta?: { requestId?: string } } | null;
  if (env && typeof env === "object" && env.error && typeof env.error.code === "string") {
    const err = new ApiError("api", res.status, env.error.code, env.error.message ?? "The request failed", env.meta?.requestId ?? headerId, env.error.details);
    if (res.status === 401 && (err.code === "unauthenticated" || err.code === "session_expired")) onUnauthenticated?.();
    throw err;
  }
  throw new ApiError("bad_response", res.status, "bad_response", `The server answered with an unexpected response (HTTP ${res.status}).`, headerId);
}

/** Calls an /api route and returns its `data`. */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { res, json } = await send(path, opts);
  if (!res.ok) fail(res, json);
  if (res.status === 204) return undefined as T;
  const env = json as { data?: T } | null;
  if (!env || typeof env !== "object" || !("data" in env)) {
    throw new ApiError("bad_response", res.status, "bad_response", "The server answered with an unexpected response.", res.headers.get("x-request-id"));
  }
  return env.data as T;
}

/** For the few plain-JSON routes outside the envelope, such as /healthz. */
export async function apiPlain<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { res, json } = await send(path, opts);
  if (!res.ok) fail(res, json);
  if (json === null) throw new ApiError("bad_response", res.status, "bad_response", "The server answered with an unexpected response.", res.headers.get("x-request-id"));
  return json as T;
}
