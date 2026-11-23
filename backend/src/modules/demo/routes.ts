import type { Response } from "express";
import { z } from "zod";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { clearSessionCookie, cookieShouldBeSecure, readCookie, serializeSessionCookie } from "../../lib/cookies.js";
import { HttpError, unauthenticated } from "../../lib/errors.js";
import { authOf } from "../auth/guards.js";
import type { AuthService } from "../auth/service.js";
import { COOKIE_NAME, signSessionJwt, verifySessionJwt } from "../auth/tokens.js";
import type { PermissionService } from "../permissions/service.js";
import type { DemoService } from "./service.js";

/** The administrator's own cookie, kept aside while they view as a demo person, so "Stop viewing" can give it back. */
const ADMIN_COOKIE = "zentro_admin_session";

/** Demo data and "View as" (stage 2.8). */
export function registerDemoRoutes(registry: RouteRegistry, deps: { auth: AuthService; permissions: PermissionService; demo: DemoService; sessionSecret: string; nodeEnv: string }): void {
  const { auth: authService, permissions, demo } = deps;
  const me = (res: Response) => {
    const a = authOf(res);
    if (!a) throw unauthenticated();
    res.setHeader("Cache-Control", "no-store");
    return a;
  };
  const rid = (res: Response) => String(res.locals.requestId ?? "");

  registry.add({
    method: "get",
    path: "/api/demo/status",
    access: { kind: "permission", key: "demo.manage" },
    summary: "Whether demo data is loaded, when, how much of each kind, and how many real people stay untouched",
    handler: (_req, res) => {
      const a = me(res);
      sendData(res, demo.status(a, rid(res), permissions.capsOf(res, a)));
    },
  });
  registry.add({
    method: "post",
    path: "/api/demo/load",
    access: { kind: "permission", key: "demo.manage" },
    summary: "Load the fictional company (about 60 people, six departments, tasks) as real rows flagged `is_demo`, in one transaction. 409 demo_loaded if it already is. Audited",
    handler: (_req, res) => {
      const a = me(res);
      sendData(res, demo.load(a, rid(res), permissions.capsOf(res, a)), 201);
    },
  });
  registry.add({
    method: "post",
    path: "/api/demo/remove",
    access: { kind: "permission", key: "demo.manage" },
    summary: "Remove exactly the demo rows. Refused with 409 demo_blocked and a list (`details.blockers`) when real data still points at demo data, and nothing changes. 409 demo_not_loaded. Audited",
    handler: (_req, res) => {
      const a = me(res);
      sendData(res, demo.remove(a, rid(res), permissions.capsOf(res, a)));
    },
  });
  registry.add({
    method: "get",
    path: "/api/demo/personas",
    access: { kind: "permission", key: "demo.manage" },
    summary: "The demo people an administrator can view as: name, designation, department, roles",
    handler: (_req, res) => {
      const a = me(res);
      sendData(res, demo.personas(a, rid(res), permissions.capsOf(res, a)));
    },
  });
  registry.add({
    method: "post",
    path: "/api/demo/stop-viewing",
    access: { kind: "baseline" },
    summary: "End a read-only session as a demo person and give the administrator's own session back. 409 not_viewing for anyone else",
    handler: (req, res) => {
      const a = me(res);
      const { adminUserId } = demo.stopViewing(a, rid(res));
      const secure = cookieShouldBeSecure(req, deps.nodeEnv);
      const raw = readCookie(req, ADMIN_COOKIE);
      const token = raw ? verifySessionJwt(deps.sessionSecret, raw) : null;
      const back = token && token.userId === adminUserId ? authService.authenticate(token.userId, token.sessionSecret) : null;
      res.append("Set-Cookie", clearSessionCookie(ADMIN_COOKIE, secure));
      if (back && raw) {
        const maxAge = 7 * 24 * 3600; // the session row decides how long it really lasts
        res.append("Set-Cookie", serializeSessionCookie(COOKIE_NAME, raw, { maxAgeSeconds: maxAge, secure }));
        sendData(res, authService.me(back));
        return;
      }
      // the administrator's own session is gone (it expired meanwhile): they simply sign in again
      res.append("Set-Cookie", clearSessionCookie(COOKIE_NAME, secure));
      sendData(res, { signedOut: true });
    },
  });
  registry.add({
    method: "post",
    path: "/api/demo/view-as/:membershipId",
    access: { kind: "permission", key: "demo.manage" },
    takesEntityId: true,
    summary: "View the app as a demo person: a read-only session for one hour (every write answers 403 read_only_session), the administrator's own cookie is kept aside, and a banner shows who. Real people and other organizations' people are 404. Audited",
    schema: { params: z.object({ membershipId: z.string().uuid() }) },
    handler: (req, res, v) => {
      const a = me(res);
      const { session, personName } = demo.viewAs(a, rid(res), permissions.capsOf(res, a), (v.params as { membershipId: string }).membershipId);
      const secure = cookieShouldBeSecure(req, deps.nodeEnv);
      const current = readCookie(req, COOKIE_NAME);
      if (!current) throw new HttpError(401, "unauthenticated", "Sign in required");
      const lifetime = Math.max(60, Math.floor((session.absoluteExpiresAt - Date.now()) / 1000));
      // keep the administrator's cookie aside for the length of the demo session, then switch to the demo person's
      res.append("Set-Cookie", serializeSessionCookie(ADMIN_COOKIE, current, { maxAgeSeconds: 3600, secure }));
      const demoUserId = authService.sessionUserId(session.sessionRowId);
      res.append("Set-Cookie", serializeSessionCookie(COOKIE_NAME, signSessionJwt(deps.sessionSecret, demoUserId, session.sessionSecret, lifetime), { maxAgeSeconds: lifetime, secure }));
      const next = authService.authenticate(demoUserId, session.sessionSecret);
      if (!next) throw new HttpError(500, "internal_error", "Something went wrong");
      sendData(res, { viewingAs: personName, me: authService.me(next) });
    },
  });
}
