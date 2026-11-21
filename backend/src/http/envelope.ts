import type { Response } from "express";

export const requestIdOf = (res: Response): string => String(res.locals.requestId ?? "unknown");

export interface PageMeta {
  limit: number;
  nextCursor: string | null;
}

/** Success envelope: { data, meta: { requestId, page? } } (docs/api-documentation.md section 1). */
export function sendData(res: Response, data: unknown, status = 200, page?: PageMeta): void {
  res.status(status).json({ data, meta: { requestId: requestIdOf(res), ...(page ? { page } : {}) } });
}

/** Error envelope: { error: { code, message, details? }, meta: { requestId } }. */
export function sendError(res: Response, status: number, code: string, message: string, details?: unknown): void {
  res.status(status).json({
    error: { code, message, ...(details !== undefined ? { details } : {}) },
    meta: { requestId: requestIdOf(res) },
  });
}
