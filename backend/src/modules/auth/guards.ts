import type { Request, Response } from "express";
import type { Guards } from "../../http/registry.js";
import { clearSessionCookie, cookieShouldBeSecure, readCookie } from "../../lib/cookies.js";
import { unauthenticated } from "../../lib/errors.js";
import { temporaryOwnerGate } from "./ownerGate.js";
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
 * session is a 401 and the stale cookie is cleared. `authorize` stays fail-closed: there is no permission catalogue
 * until the RBAC engine (stage 2.3), so a route that needs a permission key is refused for everyone until then.
 */
export function createAuthGuards(service: AuthService, sessionSecret: string, nodeEnv: string, cronSecret: string | undefined): Guards {
  const ownerGate = temporaryOwnerGate(service);
  return {
    authenticate: (req, res) => {
      const auth = sessionFromRequest(service, sessionSecret, req);
      if (!auth) {
        if (readCookie(req, COOKIE_NAME)) res.append("Set-Cookie", clearSessionCookie(COOKIE_NAME, cookieShouldBeSecure(req, nodeEnv)));
        throw unauthenticated();
      }
      res.locals.auth = auth;
    },
    // TEMPORARY (2.2): the two administration keys are allowed for Owners only; every other key stays refused.
    authorize: (req, res, key) => ownerGate(req, res, key),
    cronSecret,
  };
}
