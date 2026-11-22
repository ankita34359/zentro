import type { Request, Response } from "express";
import { z } from "zod";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { clearSessionCookie, cookieShouldBeSecure, serializeSessionCookie } from "../../lib/cookies.js";
import { unauthenticated } from "../../lib/errors.js";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../../lib/passwords.js";
import type { AccountService } from "./accounts.js";
import { authOf, sessionFromRequest } from "./guards.js";
import type { InvitationService } from "./invitations.js";
import type { AuthService } from "./service.js";
import type { PermissionService } from "../permissions/service.js";
import { COOKIE_NAME, signSessionJwt } from "./tokens.js";

const email = z.string().trim().toLowerCase().max(254).email("Enter a valid email address");
const newPassword = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(MAX_PASSWORD_LENGTH, `Use at most ${MAX_PASSWORD_LENGTH} characters`);
const code = z.string().min(20).max(200);
const uuid = z.string().uuid();

const noStore = (res: Response) => res.setHeader("Cache-Control", "no-store");

export function registerAccountRoutes(
  registry: RouteRegistry,
  deps: { auth: AuthService; permissions: PermissionService; accounts: AccountService; invitations: InvitationService; sessionSecret: string; nodeEnv: string },
): void {
  const { auth: authService, permissions, accounts, invitations } = deps;
  const caps = (res: Response) => permissions.capsOf(res, me(res));
  const me = (res: Response) => {
    const a = authOf(res);
    if (!a) throw unauthenticated();
    return a;
  };
  const rid = (res: Response) => String(res.locals.requestId ?? "");
  const ip = (req: Request) => req.ip ?? "unknown";

  // ---------- public: forgot / reset ----------

  registry.add({
    method: "post",
    path: "/api/auth/forgot-password",
    access: { kind: "public", why: "someone who cannot sign in has no session; always answers the same and is rate-limited per address and per email" },
    summary: "Forgot password: always 202. Nothing is emailed yet: the person asks their administrator for a reset link",
    schema: { body: z.object({ email }).strict() },
    handler: (req, res, v) => {
      noStore(res);
      accounts.forgot((v.body as { email: string }).email, ip(req));
      sendData(
        res,
        { accepted: true, message: "If that email has an account, ask your administrator for a password reset link. Nothing is sent automatically yet." },
        202,
      );
    },
  });

  registry.add({
    method: "post",
    path: "/api/auth/reset-password",
    access: { kind: "public", why: "the single-use reset token in the body is the credential; rate-limited per address" },
    summary: "Set a new password with an administrator-generated reset link (valid 1 hour, single use); signs the person out everywhere",
    schema: { body: z.object({ token: z.string().min(20).max(200), password: newPassword }).strict() },
    handler: async (req, res, v) => {
      const b = v.body as { token: string; password: string };
      noStore(res);
      await accounts.reset(b.token, b.password, ip(req));
      sendData(res, { reset: true });
    },
  });

  // ---------- signed in: change password ----------

  registry.add({
    method: "post",
    path: "/api/auth/change-password",
    access: { kind: "baseline" },
    summary: "Change the signed-in person's own password; their other sessions are signed out",
    schema: { body: z.object({ currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH), newPassword }).strict() },
    handler: async (_req, res, v) => {
      const b = v.body as { currentPassword: string; newPassword: string };
      noStore(res);
      await accounts.change(me(res), b.currentPassword, b.newPassword);
      sendData(res, { changed: true });
    },
  });

  // ---------- signed in: delete my account ----------

  registry.add({
    method: "get",
    path: "/api/auth/delete-account/preview",
    access: { kind: "baseline" },
    summary: "What Delete my account would do for the caller (account only / account and organization / blocked and why), so the screen can warn before anything happens",
    handler: (_req, res) => {
      noStore(res);
      sendData(res, accounts.deletionPreview(me(res), rid(res)));
    },
  });

  registry.add({
    method: "post",
    path: "/api/auth/delete-account",
    access: { kind: "baseline" },
    summary:
      "Delete my account. Needs the password and the email typed again. If the caller is the only member and nothing is pending, the organization is deleted too and its name must be typed. Always signs the caller out",
    schema: { body: z.object({ password: z.string().min(1).max(MAX_PASSWORD_LENGTH), confirmEmail: z.string().min(1).max(254), confirmOrganizationName: z.string().max(200).optional() }).strict() },
    handler: async (req, res, v) => {
      const b = v.body as { password: string; confirmEmail: string; confirmOrganizationName?: string };
      noStore(res);
      const r = await accounts.deleteAccount(me(res), rid(res), b);
      res.append("Set-Cookie", clearSessionCookie(COOKIE_NAME, cookieShouldBeSecure(req, deps.nodeEnv)));
      sendData(res, { deleted: true, organizationDeleted: r.organizationDeleted });
    },
  });

  // ---------- public: the invitee ----------

  registry.add({
    method: "post",
    path: "/api/auth/invitation-preview",
    access: { kind: "public", why: "the invitation code in the body is the credential; shows only the organization name and the invited address; rate-limited per address" },
    summary: "What an invitation is for (organization, invited email), before anyone accepts. 404/410 for a bad, used, revoked or expired code",
    schema: { body: z.object({ code }).strict() },
    handler: (req, res, v) => {
      noStore(res);
      sendData(res, invitations.preview((v.body as { code: string }).code, ip(req)));
    },
  });

  registry.add({
    method: "post",
    path: "/api/auth/accept-invitation",
    access: { kind: "public", why: "the invitation code is the credential: it replaces the registration code; signed in or not; rate-limited per address" },
    summary:
      "Accept an invitation. Signed in: binds the membership to the caller (their email must be the invited one). Not signed in: creates the login (invited email only) and signs in",
    schema: { body: z.object({ code, name: z.string().trim().min(1).max(100).optional(), email: email.optional(), password: newPassword.optional() }).strict() },
    handler: async (req, res, v) => {
      const b = v.body as { code: string; name?: string; email?: string; password?: string };
      noStore(res);
      const signedIn = sessionFromRequest(authService, deps.sessionSecret, req);
      const r = await invitations.accept(b, signedIn, ip(req));
      if (r.session) {
        const lifetime = Math.max(60, Math.floor((r.session.absoluteExpiresAt - Date.now()) / 1000));
        res.append(
          "Set-Cookie",
          serializeSessionCookie(COOKIE_NAME, signSessionJwt(deps.sessionSecret, r.session.userId, r.session.sessionSecret, lifetime), {
            maxAgeSeconds: lifetime,
            secure: cookieShouldBeSecure(req, deps.nodeEnv),
          }),
        );
      }
      sendData(res, r.me);
    },
  });

  // ---------- administration (the permission engine decides; stage 2.3) ----------

  registry.add({
    method: "get",
    path: "/api/invitations",
    access: { kind: "permission", key: "invitations.manage" },
    summary: "The organization's invitations with their state (pending, accepted, revoked, expired). Never contains a code",
    handler: (_req, res) => {
      noStore(res);
      sendData(res, invitations.list(me(res), rid(res), caps(res)));
    },
  });

  registry.add({
    method: "post",
    path: "/api/invitations",
    access: { kind: "permission", key: "invitations.manage" },
    summary: "Invite a person by email: creates their (invited) membership and an invitation. The code is returned ONCE; only its hash is stored",
    schema: { body: z.object({ email, name: z.string().trim().max(100).optional(), roleId: z.string().uuid().optional() }).strict() },
    handler: (_req, res, v) => {
      noStore(res);
      sendData(res, invitations.create(me(res), rid(res), caps(res), v.body as { email: string; name?: string; roleId?: string }), 201);
    },
  });

  registry.add({
    method: "post",
    path: "/api/invitations/:id/revoke",
    access: { kind: "permission", key: "invitations.manage" },
    takesEntityId: true,
    summary: "Cancel an open invitation: its link stops working",
    schema: { params: z.object({ id: uuid }) },
    handler: (_req, res, v) => {
      noStore(res);
      sendData(res, invitations.revoke(me(res), rid(res), caps(res), (v.params as { id: string }).id));
    },
  });

  registry.add({
    method: "post",
    path: "/api/invitations/:id/regenerate",
    access: { kind: "permission", key: "invitations.manage" },
    takesEntityId: true,
    summary: "A fresh link for the same person (the old link stops working). The code is returned ONCE",
    schema: { params: z.object({ id: uuid }) },
    handler: (_req, res, v) => {
      noStore(res);
      sendData(res, invitations.regenerate(me(res), rid(res), caps(res), (v.params as { id: string }).id));
    },
  });

  registry.add({
    method: "get",
    path: "/api/organization/members",
    access: { kind: "permission", key: "people.manage" },
    summary: "The organization's people (name, email, state, role keys) for the Users screen. Replaced by the people API in stage 2.6",
    handler: (_req, res) => {
      noStore(res);
      sendData(res, accounts.members(me(res), rid(res), caps(res)));
    },
  });

  registry.add({
    method: "post",
    path: "/api/people/:membershipId/reset-link",
    access: { kind: "permission", key: "people.manage" },
    takesEntityId: true,
    summary: "Generate a password-reset link for a person in the caller's organization (valid 1 hour, single use, shown once). Replaces any older unused link",
    schema: { params: z.object({ membershipId: uuid }) },
    handler: (_req, res, v) => {
      noStore(res);
      sendData(res, accounts.createResetLink(me(res), rid(res), caps(res), (v.params as { membershipId: string }).membershipId), 201);
    },
  });
}
