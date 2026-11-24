import type { NextFunction, Request, Response } from "express";
import type { Logger } from "../lib/logger.js";
import { sendError } from "./envelope.js";

export const TOO_MANY_MESSAGE = "Too many attempts, try again in a minute.";

/**
 * A gentle limit on the whole API: at most `perMinute` calls from one address in a minute (a fixed window; a restart forgets it,
 * which only favours a real person). The strict limits on sign-in, password reset, invitations and uploads sit on top of this in
 * their own services. The cron tick and the health check are exempt. Counts are kept in memory and capped, so a flood of addresses
 * cannot grow it without bound.
 */
export function apiLimit(opts: { perMinute: number; now?: () => number; log?: Logger; maxKeys?: number }) {
  const now = opts.now ?? Date.now;
  const maxKeys = opts.maxKeys ?? 10_000;
  let windowStart = now();
  let counts = new Map<string, number>();
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.path === "/healthz" || req.path === "/cron/tick") return next();
    const t = now();
    if (t - windowStart >= 60_000) {
      windowStart = t;
      counts = new Map();
    }
    const key = req.ip ?? "unknown";
    const n = (counts.get(key) ?? 0) + 1;
    if (counts.size < maxKeys || counts.has(key)) counts.set(key, n);
    if (n <= opts.perMinute) return next();
    const retry = Math.max(1, Math.ceil((windowStart + 60_000 - t) / 1000));
    res.setHeader("Retry-After", String(retry));
    if (n === opts.perMinute + 1) opts.log?.warn("rate limited", { requestId: res.locals.requestId, limiter: "api_general", retryAfterSeconds: retry });
    sendError(res, 429, "rate_limited", TOO_MANY_MESSAGE, { retryAfterSeconds: retry });
  };
}
