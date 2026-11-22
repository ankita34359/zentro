import { HttpError, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import type { Logger } from "../../lib/logger.js";
import { hashPassword, verifyPassword } from "../../lib/passwords.js";
import { RateLimiter } from "../../lib/rateLimit.js";
import type { LinkDelivery } from "./delivery.js";
import type { AuthStore } from "./repositories/store.js";
import type { AuthContext, AuthService } from "./service.js";
import type { Capabilities, PermissionService } from "../permissions/service.js";
import type { AuditService } from "../audit/service.js";
import { scopeContainsMember } from "../permissions/resolver.js";
import { hashesEqual, hashSecret, isResetTokenShape, newSecret } from "./secrets.js";

/** A reset link is valid for 1 hour and works once. */
export const RESET_TTL_MS = 60 * 60 * 1000;

export interface AccountServiceOptions {
  store: AuthStore;
  auth: AuthService;
  permissions: PermissionService;
  audit: AuditService;
  log: Logger;
  delivery: LinkDelivery;
}

/** Password reset (administrator-generated link), "forgot password" and change password. */
export class AccountService {
  private readonly store: AuthStore;
  private readonly auth: AuthService;
  /** "Forgot password" calls per address (every call counts; it always answers the same). */
  private readonly forgotByIp: RateLimiter;
  private readonly forgotByEmail: RateLimiter;
  /** Wrong or malformed reset tokens per address. */
  private readonly resetFailByIp: RateLimiter;
  private readonly resetCallsByIp: RateLimiter;
  /** Wrong current passwords per signed-in person. */
  private readonly changeFailByUser: RateLimiter;
  /** Wrong passwords on "Delete my account", per signed-in person. */
  private readonly deleteFailByUser: RateLimiter;

  constructor(private readonly o: AccountServiceOptions) {
    this.store = o.store;
    this.auth = o.auth;
    const min = 60_000;
    const clock = o.auth.now;
    this.forgotByIp = new RateLimiter({ max: 10, windowMs: 60 * min, blockMs: 15 * min, maxBlockMs: 240 * min }, clock);
    this.forgotByEmail = new RateLimiter({ max: 5, windowMs: 60 * min, blockMs: 15 * min, maxBlockMs: 240 * min }, clock);
    this.resetFailByIp = new RateLimiter({ max: 10, windowMs: 15 * min, blockMs: 15 * min, maxBlockMs: 240 * min }, clock);
    this.resetCallsByIp = new RateLimiter({ max: 30, windowMs: 15 * min, blockMs: 10 * min, maxBlockMs: 120 * min }, clock);
    this.changeFailByUser = new RateLimiter({ max: 5, windowMs: 15 * min, blockMs: 10 * min, maxBlockMs: 120 * min }, clock);
    this.deleteFailByUser = new RateLimiter({ max: 5, windowMs: 15 * min, blockMs: 10 * min, maxBlockMs: 120 * min }, clock);
  }

  // ---------- forgot password (public) ----------

  /**
   * Same answer, same work, whether or not the address has an account. Nothing can be emailed yet, so this only tells
   * the person to ask their administrator; the hook below is where the email will plug in (stage 8).
   */
  forgot(email: string, ip: string): void {
    const wait = Math.max(this.forgotByIp.retryAfterMs(ip), this.forgotByEmail.retryAfterMs(email));
    if (wait > 0) throw this.auth.tooMany(wait);
    this.forgotByIp.fail(ip);
    this.forgotByEmail.fail(email);
    this.o.delivery.passwordResetRequested({ email });
  }

  // ---------- administrator-generated reset link ----------

  /** The route's permission key (`people.manage`) is checked by the guard; here the person must also be inside the caller's scope set and organization. */
  createResetLink(auth: AuthContext, requestId: string, caps: Capabilities, membershipId: string): { token: string; expiresAt: string; displayName: string } {
    const ctx = this.auth.tenantCtx(auth, requestId);
    const membership = this.store.memberships(this.store.tenant(ctx)).findById(membershipId); // only this organization's people
    if (!membership || !scopeContainsMember(caps.scope("people.manage"), membership.id)) throw notFound(); // missing, another organization's, or outside the caller's scope: all look the same
    if (!membership.user_id) throw new HttpError(409, "no_login", "This person has not joined yet. Send them an invitation instead.");
    if (membership.user_id === auth.userId) throw new HttpError(409, "use_change_password", "Use Change password for your own account.");
    const user = this.store.users.findById(membership.user_id);
    // A login that also belongs elsewhere is not this organization's to reset: it looks like "not found".
    if (!user || user.status !== "active" || user.default_organization_id !== ctx.organizationId) throw notFound();

    const nowMs = this.auth.now();
    const now = this.auth.iso(nowMs);
    const token = newSecret();
    const expiresAt = this.auth.iso(nowMs + RESET_TTL_MS);
    this.store.transaction(() => {
      this.store.tokens.revokeOpenForUser(user.id, "password_reset", now); // a new link replaces every older unused one
      this.store.tokens.insert({ id: newId(), userId: user.id, purpose: "password_reset", tokenHash: hashSecret(token), expiresAt, createdByUserId: auth.userId, now });
      this.o.audit.record(this.store.tenant(ctx), ctx, { action: "password_reset_link.create", entityType: "membership", entityId: membership.id, summary: `Generated a password reset link for ${membership.display_name}` }); // the link itself is never recorded
    });
    this.o.delivery.passwordResetIssued({ userId: user.id, token, expiresAt });
    this.o.log.info("reset link created", { requestId });
    return { token, expiresAt, displayName: membership.display_name };
  }

  // ---------- reset with the link (public: the token is the credential) ----------

  async reset(token: string, newPassword: string, ip: string): Promise<void> {
    const wait = Math.max(this.resetFailByIp.retryAfterMs(ip), this.resetCallsByIp.retryAfterMs(ip));
    if (wait > 0) throw this.auth.tooMany(wait);
    this.resetCallsByIp.fail(ip);

    const invalid = () => {
      this.resetFailByIp.fail(ip);
      return new HttpError(404, "reset_link_invalid", "This reset link is not valid");
    };
    if (!isResetTokenShape(token)) throw invalid();
    const hash = hashSecret(token);
    const row = this.store.tokens.findByHash(hash, "password_reset");
    if (!row || !hashesEqual(row.token_hash, hash)) throw invalid();
    if (row.used_at) throw new HttpError(410, "reset_link_used", "This reset link was already used");
    if (row.revoked_at) throw new HttpError(410, "reset_link_revoked", "This reset link was replaced by a newer one. Ask for the latest link.");
    if (Date.parse(row.expires_at) <= this.auth.now()) throw new HttpError(410, "reset_link_expired", "This reset link has expired. Ask your administrator for a new one.");
    const user = this.store.users.findById(row.user_id);
    if (!user || user.status !== "active") throw invalid();

    const passwordHash = await hashPassword(newPassword);
    const now = this.auth.iso();
    this.store.transaction(() => {
      if (!this.store.tokens.markUsed(row.id, now)) throw new HttpError(410, "reset_link_used", "This reset link was already used"); // single use, even under a race
      this.store.users.setPassword(user.id, passwordHash, now);
      this.store.sessions.revokeAllForUser(user.id, now); // everyone signed in as this person is signed out
      this.store.tokens.revokeOpenForUser(user.id, "password_reset", now);
    });
    this.auth.loginByAccount.reset(user.email.toLowerCase()); // a lockout from the forgotten password does not outlive the reset
    this.o.log.info("password reset completed");
  }

  // ---------- change password (signed in) ----------

  async change(auth: AuthContext, currentPassword: string, newPassword: string): Promise<void> {
    const key = auth.userId;
    const wait = this.changeFailByUser.retryAfterMs(key);
    if (wait > 0) throw this.auth.tooMany(wait);
    const user = this.store.users.findById(auth.userId);
    if (!user) throw new HttpError(401, "unauthenticated", "Sign in required");
    if (!(await verifyPassword(currentPassword, user.password_hash))) {
      this.changeFailByUser.fail(key);
      throw new HttpError(403, "current_password_incorrect", "The current password is not right");
    }
    if (currentPassword === newPassword) {
      throw new HttpError(400, "validation_failed", "Request did not pass validation", [{ path: "newPassword", message: "Choose a password different from the current one" }]);
    }
    const passwordHash = await hashPassword(newPassword);
    const now = this.auth.iso();
    this.store.transaction(() => {
      this.store.users.setPassword(user.id, passwordHash, now);
      this.store.sessions.revokeOthersForUser(user.id, auth.sessionId, now); // other devices are signed out, this one stays
      this.store.tokens.revokeOpenForUser(user.id, "password_reset", now);
    });
    this.changeFailByUser.reset(key);
    this.o.log.info("password changed");
  }

  // ---------- members, for the Users screen ----------

  /** The people inside the caller's `people.manage` scope (and always themselves). Replaced by the people API in stage 2.6. */
  members(auth: AuthContext, requestId: string, caps: Capabilities): Array<{ id: string; displayName: string; email: string | null; status: string; hasLogin: boolean; roles: { key: string; name: string }[]; assignments: { id: string; roleId: string; roleName: string; validTo: string | null }[]; isYou: boolean }> {
    const tdb = this.store.tenant(this.auth.tenantCtx(auth, requestId));
    const roles = this.store.roles(tdb).byMembership(this.auth.iso());
    const nowIso = this.auth.iso();
    const assignments = this.store.grants(tdb).assignmentsFor(null, nowIso).filter((a) => a.revoked_at === null && a.valid_from <= nowIso && (a.valid_to === null || a.valid_to >= nowIso));
    const scope = caps.scope("people.manage");
    return this.store
      .memberships(tdb)
      .listPeople()
      .filter((m) => m.id === auth.membershipId || scopeContainsMember(scope, m.id))
      .map((m) => ({
        id: m.id,
        displayName: m.display_name,
        email: m.login_email ?? m.work_email,
        status: m.status,
        hasLogin: m.user_id !== null,
        roles: roles.get(m.id) ?? [],
        assignments: assignments.filter((a) => a.membership_id === m.id).map((a) => ({ id: a.id, roleId: a.role_id, roleName: a.role_name, validTo: a.valid_to })),
        isYou: m.id === auth.membershipId,
      }));
  }

  // ---------- delete my account ----------

  /**
   * What "Delete my account" would do for this person, so the screen can warn clearly BEFORE anything happens.
   *   account_only           the login is erased; the organization continues without them
   *   account_and_organization  they are the only member and nothing is pending: the whole organization goes with them
   *   blocked                they cannot delete yet (`reason` says why)
   */
  deletionPreview(auth: AuthContext, requestId: string): DeletionPreview {
    if (!auth.organizationId || !auth.membershipId) return { mode: "account_only", organizationName: null, others: 0, pendingInvitations: 0, reason: null };
    const ctx = this.auth.tenantCtx(auth, requestId);
    const tdb = this.store.tenant(ctx);
    const org = this.auth.organizationFor(auth);
    const counts = this.store.erasure.counts(tdb, auth.membershipId, this.auth.iso());
    if (counts.others === 0 && counts.pendingInvitations === 0) {
      return { mode: "account_and_organization", organizationName: org.name, ...counts, reason: null };
    }
    if (counts.others === 0) return { mode: "blocked", organizationName: org.name, ...counts, reason: "pending_invitations" };
    const admins = this.o.permissions.administratorIdsFor(ctx);
    if (admins.includes(auth.membershipId) && admins.length === 1) return { mode: "blocked", organizationName: org.name, ...counts, reason: "last_admin" };
    return { mode: "account_only", organizationName: org.name, ...counts, reason: null };
  }

  async deleteAccount(
    auth: AuthContext,
    requestId: string,
    input: { password: string; confirmEmail: string; confirmOrganizationName?: string },
  ): Promise<{ organizationDeleted: boolean }> {
    const wait = this.deleteFailByUser.retryAfterMs(auth.userId);
    if (wait > 0) throw this.auth.tooMany(wait);
    const user = this.store.users.findById(auth.userId);
    if (!user) throw new HttpError(401, "unauthenticated", "Sign in required");
    if (!(await verifyPassword(input.password, user.password_hash))) {
      this.deleteFailByUser.fail(auth.userId);
      throw new HttpError(403, "current_password_incorrect", "The password is not right");
    }
    if (input.confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
      throw new HttpError(400, "confirmation_mismatch", "Type your email address exactly to confirm");
    }
    const plan = this.deletionPreview(auth, requestId);
    if (plan.mode === "blocked") {
      throw plan.reason === "pending_invitations"
        ? new HttpError(409, "pending_invitations", "You are the only member, but invitations are still pending. Revoke them first, then delete your account.")
        : new HttpError(409, "last_admin", "You are the last administrator of an organization that still has other people. Make someone else an administrator first.");
    }
    if (plan.mode === "account_and_organization" && input.confirmOrganizationName !== plan.organizationName) {
      throw new HttpError(400, "organization_confirmation_required", `This also deletes the organization "${plan.organizationName}" and everything in it. Type its name exactly to confirm.`, { organizationName: plan.organizationName });
    }

    const now = this.auth.iso();
    const er = this.store.erasure;
    this.store.transaction(() => {
      if (auth.organizationId && auth.membershipId) {
        const tdb = this.store.tenant(this.auth.tenantCtx(auth, requestId));
        if (plan.mode === "account_and_organization") {
          er.deleteLoginTraces(user.id);
          er.deleteOrganizationRows(tdb);
          er.deleteOrganization(auth.organizationId);
        } else {
          const ctx = this.auth.tenantCtx(auth, requestId);
          this.o.audit.record(tdb, ctx, { action: "person.leave", entityType: "membership", entityId: auth.membershipId, summary: "A member deleted their own account and left the organization" });
          er.retireMembership(tdb, auth.membershipId, now);
        }
      }
      er.deleteLoginTraces(user.id);
      if (er.createdOrganizations(user.id) > 0) er.tombstoneUser(user.id, now);
      else er.deleteUser(user.id);
    });
    this.deleteFailByUser.reset(auth.userId);
    this.o.log.info("account deleted", { requestId, organizationDeleted: plan.mode === "account_and_organization" });
    return { organizationDeleted: plan.mode === "account_and_organization" };
  }
}

export interface DeletionPreview {
  mode: "account_only" | "account_and_organization" | "blocked";
  organizationName: string | null;
  others: number;
  pendingInvitations: number;
  reason: "last_admin" | "pending_invitations" | null;
}
