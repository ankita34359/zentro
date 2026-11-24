import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../lib/errors.js";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

function hostOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Same-origin check for every state-changing /api request (CSRF defence, on top of SameSite=Lax cookies and JSON-only
 * bodies). The browser's Origin header (or, if absent, the Referer) must name this site: the address in APP_URL when
 * it is set, otherwise the host the request was addressed to (Host, or X-Forwarded-Host behind the proxy).
 * A request with neither header is refused: browsers always send Origin on a cross-site or JSON POST.
 */
export function sameOriginCheck(appUrl: string | undefined) {
  const configured = hostOf(appUrl);
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (SAFE.has(req.method) || !req.path.startsWith("/api/")) return next();
    // incoming calls from viaSocket come from a server, with no Origin, and are authenticated by a secret token in a header (never by a cookie, which this route ignores), so there is nothing for a cross-site page to ride on
    if (req.path.startsWith("/api/inbound/")) return next();
    const source = hostOf(req.headers.origin) ?? (req.headers.origin === undefined ? hostOf(req.headers.referer) : null);
    const allowed = new Set<string>();
    if (configured) allowed.add(configured);
    else {
      const host = req.headers.host?.toLowerCase();
      const fwd = String(req.headers["x-forwarded-host"] ?? "").split(",")[0]?.trim().toLowerCase();
      if (host) allowed.add(host);
      if (fwd) allowed.add(fwd);
    }
    if (!source || !allowed.has(source)) {
      next(new HttpError(403, "cross_origin", "This request did not come from this site"));
      return;
    }
    next();
  };
}
