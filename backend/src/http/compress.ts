import compression from "compression";
import type { Request, RequestHandler, Response } from "express";

/**
 * Response compression (brotli when the browser accepts it, otherwise gzip; both come from Node's own zlib, so no
 * native dependency and nothing that needs more than Node 20). Applies to text responses over 1 KB only.
 *
 * Never applied to /api: those answers are small JSON, can carry session cookies and may hold secrets in later
 * stages, and compressing a response that mixes attacker-chosen text with a secret invites BREACH-style attacks.
 */
export function compressText(): RequestHandler {
  const base = compression({ threshold: 1024 });
  return (req: Request, res: Response, next) => {
    if (req.path.startsWith("/api/") || req.path === "/api") return next();
    return base(req, res, next);
  };
}
