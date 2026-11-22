import type { Request } from "express";

/** Reads one cookie from the Cookie header. Tiny on purpose; values are URL-decoded. */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export interface CookieOptions {
  maxAgeSeconds: number;
  secure: boolean;
}

/** HttpOnly (scripts cannot read it), SameSite=Lax (not sent on cross-site POSTs), Secure over HTTPS, path /. */
export function serializeSessionCookie(name: string, value: string, o: CookieOptions): string {
  return [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", ...(o.secure ? ["Secure"] : []), `Max-Age=${o.maxAgeSeconds}`].join("; ");
}

export function clearSessionCookie(name: string, secure: boolean): string {
  return [`${name}=`, "Path=/", "HttpOnly", "SameSite=Lax", ...(secure ? ["Secure"] : []), "Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT"].join("; ");
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Secure everywhere except plain http on the developer's own machine (a Secure cookie would never be stored there).
 * Behind Embarko's proxy the request is https (X-Forwarded-Proto, trusted through TRUST_PROXY), so it is Secure.
 */
export function cookieShouldBeSecure(req: Request, nodeEnv: string): boolean {
  if (nodeEnv === "production" || req.secure) return true;
  return !LOOPBACK.has(req.hostname);
}
