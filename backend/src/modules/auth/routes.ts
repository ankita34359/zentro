import type { Request, Response } from "express";
import { z } from "zod";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { clearSessionCookie, cookieShouldBeSecure, serializeSessionCookie } from "../../lib/cookies.js";
import { unauthenticated } from "../../lib/errors.js";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../../lib/passwords.js";
import { authOf, sessionFromRequest } from "./guards.js";
import type { AuthService } from "./service.js";
import { COOKIE_NAME, signSessionJwt } from "./tokens.js";

const email = z.string().trim().toLowerCase().max(254).email("Enter a valid email address");
const password = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(MAX_PASSWORD_LENGTH, `Use at most ${MAX_PASSWORD_LENGTH} characters`);

const registerBody = z
  .object({
    email,
    name: z.string().trim().min(1, "Enter your name").max(100),
    password,
    // Optional here on purpose: a missing code is refused by the service with the same generic message as a wrong one.
    registrationCode: z.string().max(200).optional().default(""),
  })
  .strict();

const loginBody = z.object({ email, password: z.string().min(1).max(MAX_PASSWORD_LENGTH) }).strict();

const validTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
// .strict(): an organization id (or any unknown field) in the body is rejected, never read. Tenancy comes from the session.
const createOrgBody = z
  .object({
    name: z.string().trim().min(2, "Use at least 2 characters").max(80),
    timezone: z.string().max(64).refine(validTimezone, "Unknown time zone").optional().default("UTC"),
  })
  .strict();

const noStore = (res: Response) => res.setHeader("Cache-Control", "no-store");

export function registerAuthRoutes(registry: RouteRegistry, service: AuthService, opts: { sessionSecret: string; nodeEnv: string }): void {
  const secure = (req: Request) => cookieShouldBeSecure(req, opts.nodeEnv);
  const me = (res: Response) => {
    const auth = authOf(res);
    if (!auth) throw unauthenticated();
    return service.me(auth);
  };

  registry.add({
    method: "post",
    path: "/api/auth/register",
    access: { kind: "public", why: "creating an account needs no sign-in; it is gated by the registration code and rate limits" },
    summary: "Create a login (needs the registration code). Same answer whether or not the email exists.",
    schema: { body: registerBody },
    handler: async (req, res, v) => {
      const b = v.body as z.infer<typeof registerBody>;
      noStore(res);
      await service.register({ email: b.email, name: b.name, password: b.password, registrationCode: b.registrationCode }, req.ip ?? "unknown");
      sendData(res, { registered: true, message: "Registration received. Sign in with your email and password." }, 202);
    },
  });

  registry.add({
    method: "post",
    path: "/api/auth/login",
    access: { kind: "public", why: "signing in needs no existing session; rate-limited per address and per account" },
    summary: "Sign in; sets the session cookie and returns the same data as /api/auth/me",
    schema: { body: loginBody },
    handler: async (req, res, v) => {
      const b = v.body as z.infer<typeof loginBody>;
      noStore(res);
      const r = await service.login(b.email, b.password, req.ip ?? "unknown");
      const lifetime = Math.max(60, Math.floor((r.absoluteExpiresAt - Date.now()) / 1000));
      res.append("Set-Cookie", serializeSessionCookie(COOKIE_NAME, signSessionJwt(opts.sessionSecret, r.user.id, r.sessionSecret, lifetime), { maxAgeSeconds: lifetime, secure: secure(req) }));
      const auth = service.authenticate(r.user.id, r.sessionSecret);
      if (!auth) throw unauthenticated();
      sendData(res, service.me(auth));
    },
  });

  registry.add({
    method: "post",
    path: "/api/auth/logout",
    access: { kind: "public", why: "must always clear the cookie, even when the session already expired; it only ever revokes the caller's own session" },
    summary: "Revoke the current session and clear the cookie (always succeeds)",
    handler: (req, res) => {
      noStore(res);
      const auth = sessionFromRequest(service, opts.sessionSecret, req);
      if (auth) service.logout(auth);
      res.append("Set-Cookie", clearSessionCookie(COOKIE_NAME, secure(req)));
      sendData(res, { loggedOut: true });
    },
  });

  registry.add({
    method: "get",
    path: "/api/auth/me",
    access: { kind: "baseline" },
    summary: "Who is signed in: user, organization (or null before onboarding), roles, capabilities",
    handler: (_req, res) => {
      noStore(res);
      sendData(res, me(res));
    },
  });

  registry.add({
    method: "post",
    path: "/api/organizations",
    access: { kind: "baseline" },
    summary: "Create an organization (onboarding). The caller becomes its Owner. The organization id is never taken from the request.",
    schema: { body: createOrgBody },
    handler: (_req, res, v) => {
      const b = v.body as z.infer<typeof createOrgBody>;
      const auth = authOf(res);
      if (!auth) throw unauthenticated();
      noStore(res);
      sendData(res, service.me(service.createOrganization(auth, { name: b.name, timezone: b.timezone })), 201);
    },
  });

  registry.add({
    method: "get",
    path: "/api/organization",
    access: { kind: "baseline" },
    summary: "The signed-in person's current organization (from the session) with the member count",
    handler: (_req, res) => {
      const auth = authOf(res);
      if (!auth) throw unauthenticated();
      noStore(res);
      const ctx = service.tenantCtx(auth, String(res.locals.requestId ?? ""));
      const o = service.organizationFor(auth);
      sendData(res, { id: o.id, name: o.name, slug: o.slug, timezone: o.timezone, memberCount: service.memberCount(ctx) });
    },
  });
}
