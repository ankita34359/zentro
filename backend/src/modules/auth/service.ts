import type { Config } from "../../config/env.js";
import type { TenantCtx, TenantDb } from "../../db/tenant.js";
import { HttpError, unauthenticated } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import type { Logger } from "../../lib/logger.js";
import { decoyHash, hashPassword, safeEqual, verifyPassword } from "../../lib/passwords.js";
import { RateLimiter } from "../../lib/rateLimit.js";
import type { OrganizationRow, RoleRef } from "./repositories/organizations.js";
import type { PermissionService } from "../permissions/service.js";
import type { AuditService } from "../audit/service.js";
import { BASELINE_RIGHTS } from "../permissions/catalog.js";
import { CREATOR_ROLE_KEY } from "../permissions/roleTemplates.js";
import type { SessionRow } from "./repositories/sessions.js";
import type { AuthStore } from "./repositories/store.js";
import type { UserRow } from "./repositories/users.js";
import { newSessionSecret, SESSION_ABSOLUTE_MS, SESSION_SLIDING_MS, sessionRowId } from "./tokens.js";

/** What the guard attaches to the request after a valid cookie: who, which session, and the organization the SESSION names. */
export interface AuthContext {
  userId: string;
  sessionId: string; // the row id (hash)
  organizationId: string | null;
  membershipId: string | null;
}

export interface MeData {
  user: { id: string; email: string; name: string };
  organization: { id: string; name: string; slug: string; timezone: string } | null;
  membership: { id: string; displayName: string } | null;
  /** The roles the person holds (names are data the organization edits; nothing decides access from them). */
  roles: RoleRef[];
  /** What the person may do: `{ permissionKey: [scope modes] }`, from the permission engine. The browser only uses it to choose screens; the server decides. */
  capabilities: Record<string, string[]>;
  /** Rights everyone has whatever their roles (docs/permission-model.md section 2.1). */
  baseline: string[];
  needsOnboarding: boolean;
}

const GENERIC_REGISTRATION = "Registration is not available with those details. Check the registration code and try again.";
const GENERIC_LOGIN = "Invalid email or password";

export interface AuthServiceOptions {
  store: AuthStore;
  permissions: PermissionService;
  audit: AuditService;
  config: Config;
  log: Logger;
  now?: () => number;
}

export class AuthService {
  private readonly users: AuthStore["users"];
  private readonly sessions: AuthStore["sessions"];
  private readonly orgs: AuthStore["orgs"];
  readonly now: () => number;
  /** Failed logins per account (email) and per address. */
  readonly loginByAccount: RateLimiter;
  readonly loginByIp: RateLimiter;
  /** Registration: every attempt per address, wrong codes per address, and wrong codes across everyone. */
  readonly registerByIp: RateLimiter;
  readonly codeFailByIp: RateLimiter;
  readonly codeFailGlobal: RateLimiter;

  constructor(private readonly o: AuthServiceOptions) {
    this.users = o.store.users;
    this.sessions = o.store.sessions;
    this.orgs = o.store.orgs;
    this.now = o.now ?? Date.now;
    const clock = this.now;
    const min = 60_000;
    this.loginByAccount = new RateLimiter({ max: 8, windowMs: 15 * min, blockMs: 5 * min, maxBlockMs: 60 * min }, clock);
    this.loginByIp = new RateLimiter({ max: 30, windowMs: 15 * min, blockMs: 5 * min, maxBlockMs: 60 * min }, clock);
    this.registerByIp = new RateLimiter({ max: 20, windowMs: 60 * min, blockMs: 10 * min, maxBlockMs: 240 * min }, clock);
    this.codeFailByIp = new RateLimiter({ max: 5, windowMs: 15 * min, blockMs: 15 * min, maxBlockMs: 240 * min }, clock);
    this.codeFailGlobal = new RateLimiter({ max: 40, windowMs: 60 * min, blockMs: 15 * min, maxBlockMs: 120 * min }, clock);
  }

  readonly iso = (t = this.now()): string => new Date(t).toISOString();

  tooMany(ms: number): HttpError {
    const seconds = Math.max(1, Math.ceil(ms / 1000));
    return new HttpError(429, "rate_limited", "Too many attempts. Wait a little and try again.", { retryAfterSeconds: seconds });
  }

  // ---------- registration ----------

  /**
   * Creates a login, but only when the registration setting allows it. Every refusal reads the same ("generic"),
   * a wrong code is compared in constant time and counted, and an email that already exists gets the SAME answer as a
   * new one (the caller cannot tell). Nobody is signed in by registering; they log in next.
   */
  async register(input: { email: string; name: string; password: string; registrationCode: string }, ip: string): Promise<void> {
    const reg = this.o.config.registration;
    const wait = Math.max(this.registerByIp.retryAfterMs(ip), this.codeFailByIp.retryAfterMs(ip), this.codeFailGlobal.retryAfterMs("all"));
    if (wait > 0) throw this.tooMany(wait);
    this.registerByIp.fail(ip); // every attempt counts toward the per-address cap

    if (reg.mode === "closed") {
      await decoyHash(); // same cost as a real attempt
      throw new HttpError(403, "registration_unavailable", GENERIC_REGISTRATION);
    }
    if (reg.mode === "code") {
      const ok = input.registrationCode.length > 0 && safeEqual(input.registrationCode, reg.code);
      if (!ok) {
        this.codeFailByIp.fail(ip);
        this.codeFailGlobal.fail("all");
        await decoyHash();
        this.o.log.warn("registration refused", { reason: "code" });
        throw new HttpError(403, "registration_unavailable", GENERIC_REGISTRATION);
      }
    }
    const passwordHash = await hashPassword(input.password); // always paid, so a taken email costs the same
    const created = this.users.insert({ id: newId(), email: input.email, passwordHash, name: input.name, now: this.iso() });
    if (!created) this.o.log.info("registration for an existing account ignored"); // never says which account
  }

  // ---------- login / logout ----------

  async login(email: string, password: string, ip: string): Promise<{ user: UserRow; sessionSecret: string; absoluteExpiresAt: number }> {
    const accountKey = email.toLowerCase();
    const wait = Math.max(this.loginByAccount.retryAfterMs(accountKey), this.loginByIp.retryAfterMs(ip));
    if (wait > 0) throw this.tooMany(wait);

    const user = this.users.findByEmail(email);
    const hash = user && user.status === "active" ? user.password_hash : await decoyHash();
    const ok = await verifyPassword(password, hash);
    if (!user || user.status !== "active" || !ok) {
      this.loginByAccount.fail(accountKey);
      this.loginByIp.fail(ip);
      this.o.log.info("login failed"); // no email, no reason: nothing to learn from the log either
      throw new HttpError(401, "invalid_credentials", GENERIC_LOGIN);
    }
    this.loginByAccount.reset(accountKey);

    // The session opens in the organization the person last used, but only if they are still an active member there.
    let organizationId: string | null = null;
    if (user.default_organization_id) {
      const tdb = this.tenantFor(user.default_organization_id, user.id, "login");
      if (this.o.store.memberships(tdb).findActiveForUser(user.id)) organizationId = user.default_organization_id;
    }
    const opened = this.openSession(user.id, organizationId);
    this.users.touchLogin(user.id, this.iso());
    return { user, ...opened };
  }

  /** Creates the session row for a login (sign-in, or accepting an invitation) and returns the secret for the cookie. */
  openSession(userId: string, organizationId: string | null): { sessionSecret: string; absoluteExpiresAt: number } {
    const t = this.now();
    const secret = newSessionSecret();
    const absolute = t + SESSION_ABSOLUTE_MS;
    this.sessions.insert({
      id: sessionRowId(secret),
      userId,
      organizationId,
      now: this.iso(t),
      expiresAt: this.iso(Math.min(t + SESSION_SLIDING_MS, absolute)),
      absoluteExpiresAt: this.iso(absolute),
    });
    return { sessionSecret: secret, absoluteExpiresAt: absolute };
  }

  logout(auth: AuthContext): void {
    this.sessions.revoke(auth.sessionId, this.iso());
  }

  revokeAllSessions(userId: string): void {
    this.sessions.revokeAllForUser(userId, this.iso());
  }

  // ---------- session check (every request) ----------

  /** Returns the context for a valid, unrevoked, unexpired session of an active user; otherwise null. */
  authenticate(userId: string, sessionSecret: string): AuthContext | null {
    const id = sessionRowId(sessionSecret);
    const s: SessionRow | undefined = this.sessions.find(id);
    if (!s || s.user_id !== userId || s.revoked_at) return null;
    const t = this.now();
    if (Date.parse(s.expires_at) <= t || Date.parse(s.absolute_expires_at) <= t) return null;
    const user = this.users.findById(userId);
    if (!user || user.status !== "active") return null;

    // Slide the 7-day window, but write at most about once every 5 minutes.
    if (t - Date.parse(s.last_seen_at) > 5 * 60_000) {
      this.sessions.slide(id, this.iso(t), this.iso(Math.min(t + SESSION_SLIDING_MS, Date.parse(s.absolute_expires_at))));
    }

    // The organization comes from the SESSION ROW and the membership must still be active there (removing someone
    // ends their access on the very next request).
    let membershipId: string | null = null;
    let organizationId: string | null = s.active_organization_id;
    if (organizationId) {
      const m = this.o.store.memberships(this.tenantFor(organizationId, userId, id)).findActiveForUser(userId);
      if (m) membershipId = m.id;
      else organizationId = null;
    }
    return { userId, sessionId: id, organizationId, membershipId };
  }

  tenantFor(organizationId: string, userId: string, sessionId: string): TenantDb {
    const ctx: TenantCtx = { userId, membershipId: "", organizationId, sessionId, requestId: "" };
    return this.o.store.tenant(ctx);
  }

  /** The tenant-scoped handle for a signed-in person who has an organization. Throws 403 if they have none yet. */
  tenantCtx(auth: AuthContext, requestId: string): TenantCtx {
    if (!auth.organizationId || !auth.membershipId) {
      throw new HttpError(403, "no_organization", "Create or join an organization first");
    }
    return { userId: auth.userId, membershipId: auth.membershipId, organizationId: auth.organizationId, sessionId: auth.sessionId, requestId };
  }

  tenantDb(ctx: TenantCtx): TenantDb {
    return this.o.store.tenant(ctx);
  }

  /** The context for a session row we just changed (the secret is not needed: the caller already authenticated it this request). */
  authenticateRow(sessionRowIdValue: string, userId: string): AuthContext {
    const s = this.sessions.find(sessionRowIdValue);
    let organizationId = s?.active_organization_id ?? null;
    let membershipId: string | null = null;
    if (organizationId) {
      const m = this.o.store.memberships(this.tenantFor(organizationId, userId, sessionRowIdValue)).findActiveForUser(userId);
      if (m) membershipId = m.id;
      else organizationId = null;
    }
    return { userId, sessionId: sessionRowIdValue, organizationId, membershipId };
  }

  // ---------- me ----------

  me(auth: AuthContext): MeData {
    const user = this.users.findById(auth.userId);
    if (!user) throw unauthenticated();
    let organization: OrganizationRow | null = null;
    let membership: MeData["membership"] = null;
    let roles: RoleRef[] = [];
    let capabilities: Record<string, string[]> = {};
    if (auth.organizationId && auth.membershipId) {
      organization = this.orgs.findById(auth.organizationId) ?? null;
      if (organization) {
        const tdb = this.tenantFor(auth.organizationId, auth.userId, auth.sessionId);
        const m = this.o.store.memberships(tdb).findActiveForUser(auth.userId);
        if (m) membership = { id: m.id, displayName: m.display_name };
        roles = this.o.store.roles(tdb).forMembership(auth.membershipId, this.iso());
        capabilities = this.o.permissions.capabilities(auth).toMap();
      }
    }
    return {
      user: { id: user.id, email: user.email, name: user.name },
      organization: organization ? { id: organization.id, name: organization.name, slug: organization.slug, timezone: organization.timezone } : null,
      membership,
      roles,
      capabilities,
      baseline: BASELINE_RIGHTS.map((b) => b.key),
      needsOnboarding: !organization,
    };
  }

  // ---------- create organization ----------

  /**
   * One transaction: the organization, the creator's membership, the minimal Owner role and its assignment
   * (Owner @ organization). The creator's session and default organization then point at it.
   */
  createOrganization(auth: AuthContext, input: { name: string; timezone: string }): AuthContext {
    const user = this.users.findById(auth.userId);
    if (!user) throw unauthenticated();
    if (auth.organizationId) throw new HttpError(409, "already_in_organization", "You already belong to an organization");
    const organizationId = newId();
    const now = this.iso();
    const slug = this.uniqueSlug(input.name);
    const membershipId = newId();
    this.o.store.transaction(() => {
      this.orgs.insert({ id: organizationId, name: input.name, slug, timezone: input.timezone, createdByUserId: user.id, now });
      const tdb = this.o.store.tenant({ userId: user.id, membershipId: "", organizationId, sessionId: auth.sessionId, requestId: "" });
      this.o.store.memberships(tdb).insert({ id: membershipId, userId: user.id, displayName: user.name, workEmail: user.email, now });
      // The nine role templates (with their grants) are seeded, and the creator gets the creator template organization-wide.
      const roleIds = this.o.permissions.seedTemplates(tdb, now);
      const creatorRoleId = roleIds.get(CREATOR_ROLE_KEY)!;
      this.o.store.grants(tdb).assign({ id: newId(), membershipId, roleId: creatorRoleId, grantedByMembershipId: membershipId, now });
      this.o.audit.record(tdb, { userId: user.id, membershipId, organizationId, sessionId: auth.sessionId, requestId: "" }, { action: "organization.create", entityType: "organization", entityId: organizationId, summary: `Created the organization "${input.name}"` });
      this.users.setDefaultOrganization(user.id, organizationId, now);
      this.sessions.setOrganization(auth.sessionId, organizationId);
    });
    return { ...auth, organizationId, membershipId };
  }

  private uniqueSlug(name: string): string {
    const base =
      name
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "organization";
    let slug = base;
    for (let i = 0; this.orgs.slugTaken(slug); i++) slug = `${base}-${newId().slice(0, 4 + Math.min(i, 4))}`;
    return slug;
  }

  organizationFor(auth: AuthContext): OrganizationRow {
    if (!auth.organizationId) throw new HttpError(403, "no_organization", "Create or join an organization first");
    const o = this.orgs.findById(auth.organizationId);
    if (!o) throw new HttpError(403, "no_organization", "Create or join an organization first");
    return o;
  }

  memberCount(ctx: TenantCtx): number {
    return this.o.store.memberships(this.tenantDb(ctx)).count();
  }
}
