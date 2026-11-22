import { HttpError, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import type { Logger } from "../../lib/logger.js";
import { hashPassword, verifyPassword } from "../../lib/passwords.js";
import { RateLimiter } from "../../lib/rateLimit.js";
import type { LinkDelivery } from "./delivery.js";
import type { AuthStore } from "./repositories/store.js";
import type { AuthContext, AuthService } from "./service.js";
import { hashesEqual, hashSecret, isResetTokenShape, newSecret } from "./secrets.js";

/** A reset link is valid for 1 hour and works once. */
export const RESET_TTL_MS = 60 * 60 * 1000;

export interface AccountServiceOptions {
  store: AuthStore;
  auth: AuthService;
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

  /** TEMPORARY gate (Owners only) is applied by the route's permission key; here the person must be in the caller's own organization. */
  createResetLink(auth: AuthContext, requestId: string, membershipId: string): { token: string; expiresAt: string; displayName: string } {
    const ctx = this.auth.tenantCtx(auth, requestId);
    const membership = this.store.memberships(this.store.tenant(ctx)).findById(membershipId); // only this organization's people
    if (!membership) throw notFound();
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

  members(auth: AuthContext, requestId: string): Array<{ id: string; displayName: string; email: string | null; status: string; hasLogin: boolean; roles: string[]; isYou: boolean }> {
    const tdb = this.store.tenant(this.auth.tenantCtx(auth, requestId));
    const roles = this.store.roles(tdb).keysByMembership(this.auth.iso());
    return this.store.memberships(tdb).listPeople().map((m) => ({
      id: m.id,
      displayName: m.display_name,
      email: m.login_email ?? m.work_email,
      status: m.status,
      hasLogin: m.user_id !== null,
      roles: roles.get(m.id) ?? [],
      isYou: m.id === auth.membershipId,
    }));
  }
}
