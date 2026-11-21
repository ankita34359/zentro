import type { NextFunction, Request, Response } from "express";
import { requestIdFrom } from "../lib/ids.js";

/** Gives every request an id, echoes it as X-Request-Id and keeps it in res.locals for logs and envelopes. */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = requestIdFrom(req.header("x-request-id"));
  res.locals.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
}
