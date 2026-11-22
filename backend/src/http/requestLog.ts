import type { NextFunction, Request, Response } from "express";
import type { Logger } from "../lib/logger.js";

/**
 * One terse line per request: method, route PATTERN (not the real path, so ids and tokens in URLs never reach
 * the log), status, duration, request id. Bodies, query strings, headers and cookies are never logged.
 */
export function requestLog(log: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const ms = Number((process.hrtime.bigint() - start) / 1_000_000n);
      const route = typeof req.route?.path === "string" ? `${req.baseUrl}${req.route.path}` : "unmatched";
      // Quiet (debug) unless it failed: polled routes, and anything outside /api that matched no route (static files,
      // the app shell, probes). That is most of the traffic and would crowd Embarko's small recent-log window.
      // Unknown /api paths stay at info: they are the useful "client called something that does not exist" lines.
      const outsideApi = route === "unmatched" && !req.originalUrl.startsWith("/api/") && req.originalUrl !== "/api";
      const quiet = route === "/healthz" || route === "/api/cron/tick" || outsideApi;
      (quiet && res.statusCode < 400 ? log.debug : log.info).call(log, "request", {
        requestId: res.locals.requestId,
        method: req.method,
        route,
        status: res.statusCode,
        ms,
      });
    });
    next();
  };
}
