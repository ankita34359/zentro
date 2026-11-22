import type { Request, Response } from "express";
import type { Guards } from "../../http/registry.js";
import { clearSessionCookie, cookieShouldBeSecure, readCookie } from "../../lib/cookies.js";
import { unauthenticated } from "../../lib/errors.js";
import type { PermissionService } from "../permissions/service.js";
import type { AuthService, AuthContext } from "./service.js";
import { COOKIE_NAME, verifySessionJwt } from "./tokens.js";

export const authOf = (res: Response): AuthContext | undefined => res.locals.auth as AuthContext | undefined;

/** Reads the cookie and returns the session's context, or null (never throws). Used by guards and by logout. */
export function sessionFromRequest(service: AuthService, sessionSecret: string, req: Request): AuthContext | null {
  const raw = readCookie(req, COOKIE_NAME);
  if (!raw) return null;
  const token = verifySessionJwt(sessionSecret, raw);
  if (!token) return null;
  return service.authenticate(token.userId, token.sessionSecret);
}

/**
 * Real sign-in guards (they replace the fail-closed defaults of stage 1.2). A missing, tampered, expired or revoked
 * session is a 401 and the stale cookie is cleared. `authorize` is the permission engine (stage 2.3).
 */
export function createAuthGuards(service: AuthService, permissions: PermissionService, sessionSecret: string, nodeEnv: string, cronSecret: string | undefined): Guards {
  return {
    authenticate: (req, res) => {
      const auth = sessionFromRequest(service, sessionSecret, req);
      if (!auth) {
        if (readCookie(req, COOKIE_NAME)) res.append("Set-Cookie", clearSessionCookie(COOKIE_NAME, cookieShouldBeSecure(req, nodeEnv)));
        throw unauthenticated();
      }
      res.locals.auth = auth;
    },
    // The permission engine (stage 2.3): the caller must hold `key` with a non-empty scope set.
    authorize: (req, res, key) => permissions.authorize(req, res, key),
    cronSecret,
  };
}
