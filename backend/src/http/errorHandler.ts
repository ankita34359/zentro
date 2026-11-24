import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import { sendError } from "./envelope.js";

/** Unknown /api path: JSON 404 in the standard envelope. */
export function apiNotFound(_req: Request, res: Response): void {
  sendError(res, 404, "not_found", "Not found");
}

/**
 * The single place errors become answers. Known errors keep their code and message. Everything else becomes a
 * generic 500: the log gets the request id, method, route and the error MESSAGE only (no stack, no body, no
 * headers); the caller gets the request id so the line can be found.
 */
export function errorHandler(log: Logger) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (err instanceof HttpError) {
      // a refused attempt is worth a line in the log (the route pattern and the wait only: never an address, an account or a secret)
      if (err.code === "rate_limited") log.warn("rate limited", { requestId: res.locals.requestId, route: typeof req.route?.path === "string" ? `${req.baseUrl}${req.route.path}` : "unmatched", retryAfterSeconds: (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds });
      sendError(res, err.status, err.code, err.message, err.details);
      return;
    }
    const type = (err as { type?: string } | null)?.type;
    if (type === "entity.parse.failed") {
      sendError(res, 400, "invalid_json", "Request body is not valid JSON");
      return;
    }
    if (type === "entity.too.large") {
      sendError(res, 413, "payload_too_large", "Request body is too large");
      return;
    }
    log.error("unhandled error", {
      requestId: res.locals.requestId,
      method: req.method,
      route: typeof req.route?.path === "string" ? `${req.baseUrl}${req.route.path}` : "unmatched",
      error: err instanceof Error ? err.message : "non-error thrown",
    });
    sendError(res, 500, "internal_error", "Something went wrong");
  };
}
