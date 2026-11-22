import type { TenantDb } from "../../db/tenant.js";
import { HttpError, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import type { Logger } from "../../lib/logger.js";
import { hashPassword } from "../../lib/passwords.js";
import { RateLimiter } from "../../lib/rateLimit.js";
import type { LinkDelivery } from "./delivery.js";
import type { InvitationListRow, InvitationRow } from "./repositories/invitations.js";
import type { AuthStore } from "./repositories/store.js";
import type { AuthContext, AuthService, MeData } from "./service.js";
import type { Capabilities, PermissionService } from "../permissions/service.js";
import { permissionDenied } from "../../lib/errors.js";
import { hashesEqual, hashSecret, makeInvitationCode, parseInvitationCode } from "./secrets.js";

/** An invitation link is valid for 7 days. */
export const INVITATION_TTL_MS = 7 * 24 * 3600 * 1000;

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export interface InvitationView {
  id: string;
  membershipId: string;
  email: string;
  displayName: string;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  invitedBy: string | null;
  roleName: string | null;
}

export interface InvitationServiceOptions {
  store: AuthStore;
  auth: AuthService;
  permissions: PermissionService;
  log: Logger;
  delivery: LinkDelivery;
}

const statusOf = (i: Pick<InvitationRow, "accepted_at" | "revoked_at" | "expires_at">, now: number): InvitationStatus =>
  i.accepted_at ? "accepted" : i.revoked_at ? "revoked" : Date.parse(i.expires_at) <= now ? "expired" : "pending";

export class InvitationService {
  private readonly store: AuthStore;
  private readonly auth: AuthService;
  /** Wrong or malformed codes per address (the code is 256 bits, so this only blunts blind guessing and noise). */
  private readonly codeFailByIp: RateLimiter;
  /** Every public call per address (preview and accept). */
  private readonly callsByIp: RateLimiter;

  constructor(private readonly o: InvitationServiceOptions) {
    this.store = o.store;
    this.auth = o.auth;
    const min = 60_000;
    this.codeFailByIp = new RateLimiter({ max: 10, windowMs: 15 * min, blockMs: 15 * min, maxBlockMs: 240 * min }, o.auth.now);
    this.callsByIp = new RateLimiter({ max: 60, windowMs: 15 * min, blockMs: 10 * min, maxBlockMs: 120 * min }, o.auth.now);
  }

  private tdbFor(auth: AuthContext, requestId: string): TenantDb {
    return this.store.tenant(this.auth.tenantCtx(auth, requestId));
  }

  private view(i: InvitationListRow, now: number): InvitationView {
    return {
      id: i.id,
      membershipId: i.membership_id,
      email: i.email,
      displayName: i.display_name,
      status: statusOf(i, now),
      expiresAt: i.expires_at,
      createdAt: i.created_at,
      acceptedAt: i.accepted_at,
      invitedBy: i.invited_by_name,
      roleName: i.role_name,
    };
  }

  // ---------- administration (organization from the session only) ----------

  /** Invitations have no subject until someone accepts, so they are organization-wide: a holder whose assignment is limited to a department or team cannot manage them yet. */
  private requireOrganizationWide(caps: Capabilities): void {
    if (!caps.scope("invitations.manage").all) throw permissionDenied();
  }

  list(auth: AuthContext, requestId: string, caps: Capabilities): InvitationView[] {
    this.requireOrganizationWide(caps);
    const now = this.auth.now();
    return this.store.invitations(this.tdbFor(auth, requestId)).list().map((i) => this.view(i, now));
  }

  /** Creates the membership ("invited") and its invitation. The code is returned here and never again. */
  create(auth: AuthContext, requestId: string, caps: Capabilities, input: { email: string; name?: string; roleId?: string }): { invitation: InvitationView; code: string; expiresAt: string } {
    this.requireOrganizationWide(caps);
    const tdb = this.tdbFor(auth, requestId);
    const ctx = this.auth.tenantCtx(auth, requestId);
    const email = input.email;
    const nowMs = this.auth.now();
    const now = this.auth.iso(nowMs);
    const invitations = this.store.invitations(tdb);
    const memberships = this.store.memberships(tdb);

    // The role they will hold on joining (optional). "You cannot grant what you do not hold": the inviter must hold every
    // permission of that role. A role of another organization looks like a missing one (404).
    let initialRoleId: string | null = null;
    if (input.roleId) {
      const grants = this.o.permissions.roleGrantsFor(ctx, input.roleId);
      if (!caps.covers(grants)) throw new HttpError(403, "cannot_grant_role", "You can only invite people into a role whose permissions you hold yourself");
      initialRoleId = input.roleId;
    }
    const code = makeInvitationCode(ctx.organizationId);
    const id = newId();
    this.store.transaction(() => {
      // A person who already belongs (active, by login or work address) cannot be invited again.
      const people = memberships.listPeople();
      if (people.some((p) => p.status === "active" && [p.work_email, p.login_email].some((e) => e?.toLowerCase() === email))) {
        throw new HttpError(409, "already_exists", "Someone with this email is already in the organization");
      }
      const open = invitations.findOpenByEmail(email);
      if (open) {
        if (statusOf(open, nowMs) === "pending") throw new HttpError(409, "already_exists", "There is already an open invitation for this email. Regenerate its link instead.");
        invitations.markRevoked(open.id, now); // expired: replaced by this one
        memberships.retireInvited(open.membership_id, now);
      }
      const membershipId = newId();
      memberships.insertInvited({ id: membershipId, displayName: (input.name ?? "").trim() || email.split("@")[0]!, workEmail: email, now });
      invitations.insert({ id, membershipId, email, codeHash: hashSecret(code), invitedByMembershipId: ctx.membershipId, initialRoleId, expiresAt: this.auth.iso(nowMs + INVITATION_TTL_MS), now });
    });
    const row = invitations.list().find((i) => i.id === id)!;
    this.o.delivery.invitationIssued({ organizationId: ctx.organizationId, invitationId: id, email, code, expiresAt: row.expires_at });
    this.o.log.info("invitation created", { requestId });
    return { invitation: this.view(row, nowMs), code, expiresAt: row.expires_at };
  }

  /** Ends an open invitation: the link stops working and the person who never joined leaves the list. */
  revoke(auth: AuthContext, requestId: string, caps: Capabilities, id: string): InvitationView {
    this.requireOrganizationWide(caps);
    const tdb = this.tdbFor(auth, requestId);
    const invitations = this.store.invitations(tdb);
    const inv = invitations.findById(id);
    if (!inv) throw notFound(); // also what another organization's id looks like
    const now = this.auth.iso();
    this.store.transaction(() => {
      if (!invitations.markRevoked(id, now)) throw new HttpError(409, "conflict", "This invitation is no longer open");
      this.store.memberships(tdb).retireInvited(inv.membership_id, now);
    });
    this.o.log.info("invitation revoked", { requestId });
    return this.view(invitations.list().find((i) => i.id === id)!, this.auth.now());
  }

  /** A fresh link for the same person: the old one stops working. Allowed for pending, expired and revoked invitations. */
  regenerate(auth: AuthContext, requestId: string, caps: Capabilities, id: string): { invitation: InvitationView; code: string; expiresAt: string } {
    this.requireOrganizationWide(caps);
    const tdb = this.tdbFor(auth, requestId);
    const ctx = this.auth.tenantCtx(auth, requestId);
    const invitations = this.store.invitations(tdb);
    const memberships = this.store.memberships(tdb);
    const old = invitations.findById(id);
    if (!old) throw notFound();
    if (old.accepted_at) throw new HttpError(409, "conflict", "This invitation was already accepted");
    const nowMs = this.auth.now();
    const now = this.auth.iso(nowMs);
    const code = makeInvitationCode(ctx.organizationId);
    const newInvitationId = newId();
    this.store.transaction(() => {
      if (!old.revoked_at) invitations.markRevoked(id, now);
      const open = invitations.findOpenByEmail(old.email);
      if (open) throw new HttpError(409, "already_exists", "There is already an open invitation for this email");
      memberships.reinvite(old.membership_id, now);
      invitations.insert({
        id: newInvitationId,
        membershipId: old.membership_id,
        email: old.email,
        codeHash: hashSecret(code),
        invitedByMembershipId: ctx.membershipId,
        initialRoleId: old.initial_role_id,
        expiresAt: this.auth.iso(nowMs + INVITATION_TTL_MS),
        now,
      });
    });
    const row = invitations.list().find((i) => i.id === newInvitationId)!;
    this.o.delivery.invitationIssued({ organizationId: ctx.organizationId, invitationId: newInvitationId, email: old.email, code, expiresAt: row.expires_at });
    this.o.log.info("invitation regenerated", { requestId });
    return { invitation: this.view(row, nowMs), code, expiresAt: row.expires_at };
  }

  /** The role chosen when inviting becomes the person's assignment (organization-wide) at the moment they join. A role archived since then is skipped. */
  private assignInitialRole(tdb: TenantDb, inv: InvitationRow, now: string): void {
    if (!inv.initial_role_id) return;
    const grants = this.store.grants(tdb);
    if (!grants.findRole(inv.initial_role_id)) return;
    grants.assign({ id: newId(), membershipId: inv.membership_id, roleId: inv.initial_role_id, grantedByMembershipId: inv.invited_by_membership_id, now });
  }

  // ---------- the invitee (public: the code is the credential) ----------

  private guardIp(ip: string): void {
    const wait = Math.max(this.callsByIp.retryAfterMs(ip), this.codeFailByIp.retryAfterMs(ip));
    if (wait > 0) throw this.auth.tooMany(wait);
    this.callsByIp.fail(ip);
  }

  /** Finds the invitation for a code and checks it is still usable. The right error for each way it can be unusable. */
  private resolve(code: string, ip: string): { tdb: TenantDb; inv: InvitationRow; organizationName: string; organizationId: string } {
    const parsed = parseInvitationCode(code);
    const org = parsed ? this.store.orgs.findById(parsed.organizationId) : undefined;
    const notValid = () => {
      this.codeFailByIp.fail(ip);
      return new HttpError(404, "invitation_not_found", "This invitation link is not valid");
    };
    if (!parsed || !org) throw notValid();
    const tdb = this.store.tenant({ userId: "", membershipId: "", organizationId: org.id, sessionId: "", requestId: "" });
    const hash = hashSecret(code);
    const inv = this.store.invitations(tdb).findByCodeHash(hash);
    if (!inv || !hashesEqual(inv.code_hash, hash)) throw notValid();
    const status = statusOf(inv, this.auth.now());
    if (status === "accepted") throw new HttpError(410, "invitation_used", "This invitation was already used");
    if (status === "revoked") throw new HttpError(410, "invitation_revoked", "This invitation was cancelled. Ask for a new one.");
    if (status === "expired") throw new HttpError(410, "invitation_expired", "This invitation has expired. Ask for a new one.");
    return { tdb, inv, organizationName: org.name, organizationId: org.id };
  }

  /** What the accept page shows before anyone commits: the organization and the invited address. */
  preview(code: string, ip: string): { organizationName: string; email: string; displayName: string; expiresAt: string } {
    this.guardIp(ip);
    const { tdb, inv, organizationName } = this.resolve(code, ip);
    const member = this.store.memberships(tdb).findById(inv.membership_id);
    return { organizationName, email: inv.email, displayName: member?.display_name ?? "", expiresAt: inv.expires_at };
  }

  /**
   * Binds the invited membership to a login. Signed in: the login's email must be the invited one. Not signed in:
   * the person creates their login here (no registration code needed: the invitation is the permission), with the
   * invited email only. Either way the invitation can be used exactly once.
   */
  async accept(
    input: { code: string; name?: string; email?: string; password?: string },
    signedIn: AuthContext | null,
    ip: string,
  ): Promise<{ me: MeData; session?: { sessionSecret: string; absoluteExpiresAt: number; userId: string } }> {
    this.guardIp(ip);
    const { tdb, inv, organizationId } = this.resolve(input.code, ip);
    const memberships = this.store.memberships(tdb);
    const invitations = this.store.invitations(tdb);
    const now = this.auth.iso();
    const mismatch = () => new HttpError(403, "invitation_email_mismatch", "This invitation was sent to a different email address.");
    const alreadyIn = () => new HttpError(409, "already_in_organization", "You already belong to an organization");

    if (signedIn) {
      const user = this.store.users.findById(signedIn.userId);
      if (!user) throw new HttpError(401, "unauthenticated", "Sign in required");
      if (user.email.toLowerCase() !== inv.email.toLowerCase()) throw mismatch();
      if (signedIn.organizationId || user.default_organization_id) throw alreadyIn();
      this.store.transaction(() => {
        if (!invitations.markAccepted(inv.id, now)) throw new HttpError(410, "invitation_used", "This invitation was already used");
        if (!memberships.bindUser(inv.membership_id, user.id, (input.name ?? "").trim() || user.name, now)) throw new HttpError(409, "conflict", "This invitation can no longer be used");
        this.store.users.setDefaultOrganization(user.id, organizationId, now);
        this.store.sessions.setOrganization(signedIn.sessionId, organizationId);
        this.assignInitialRole(tdb, inv, now);
      });
      this.o.log.info("invitation accepted");
      const refreshed = this.auth.authenticateRow(signedIn.sessionId, user.id);
      return { me: this.auth.me(refreshed) };
    }

    if (!input.email || !input.password || !(input.name ?? "").trim()) {
      throw new HttpError(400, "validation_failed", "Request did not pass validation", [
        { path: "name", message: "Enter your name" },
        { path: "email", message: "Enter the email the invitation was sent to" },
        { path: "password", message: "Choose a password" },
      ]);
    }
    if (input.email.toLowerCase() !== inv.email.toLowerCase()) throw mismatch();
    // The invitation proves permission, and the address matches: an existing login must sign in instead.
    if (this.store.users.findByEmail(inv.email)) {
      throw new HttpError(409, "account_exists", "An account with this email already exists. Sign in, then open this invitation link again.");
    }
    const passwordHash = await hashPassword(input.password);
    const userId = newId();
    const name = (input.name ?? "").trim();
    this.store.transaction(() => {
      if (!this.store.users.insert({ id: userId, email: inv.email, passwordHash, name, now })) throw new HttpError(409, "account_exists", "An account with this email already exists. Sign in, then open this invitation link again.");
      if (!invitations.markAccepted(inv.id, now)) throw new HttpError(410, "invitation_used", "This invitation was already used");
      if (!memberships.bindUser(inv.membership_id, userId, name, now)) throw new HttpError(409, "conflict", "This invitation can no longer be used");
      this.store.users.setDefaultOrganization(userId, organizationId, now);
      this.assignInitialRole(tdb, inv, now);
    });
    const opened = this.auth.openSession(userId, organizationId);
    this.o.log.info("invitation accepted");
    const ctx = this.auth.authenticate(userId, opened.sessionSecret);
    if (!ctx) throw new HttpError(500, "internal_error", "Something went wrong");
    return { me: this.auth.me(ctx), session: { ...opened, userId } };
  }
}
