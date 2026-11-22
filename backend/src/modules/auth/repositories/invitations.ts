import type { TenantDb } from "../../../db/tenant.js";

export interface InvitationRow {
  id: string;
  membership_id: string;
  email: string;
  code_hash: string;
  invited_by_membership_id: string;
  initial_role_id: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface InvitationListRow extends InvitationRow {
  display_name: string;
  invited_by_name: string | null;
  role_name: string | null;
}

const COLS = "id, membership_id, email, code_hash, invited_by_membership_id, initial_role_id, expires_at, accepted_at, revoked_at, created_at";

/** Organization-owned: every statement filters or inserts by the organization the tenant handle carries. */
export class InvitationsRepository {
  constructor(private readonly tdb: TenantDb) {}

  insert(i: { id: string; membershipId: string; email: string; codeHash: string; invitedByMembershipId: string; initialRoleId?: string | null; expiresAt: string; now: string }): void {
    this.tdb.run(
      "INSERT INTO invitations (id, organization_id, membership_id, email, code_hash, invited_by_membership_id, initial_role_id, expires_at, created_at, updated_at) VALUES (@id, @organization_id, @membershipId, @email, @codeHash, @invitedByMembershipId, @initialRoleId, @expiresAt, @now, @now)",
      { ...i, initialRoleId: i.initialRoleId ?? null },
    );
  }

  findById(id: string): InvitationRow | undefined {
    return this.tdb.get<InvitationRow>(`SELECT ${COLS} FROM invitations WHERE organization_id = @organization_id AND id = @id`, { id });
  }

  findByCodeHash(codeHash: string): InvitationRow | undefined {
    return this.tdb.get<InvitationRow>(`SELECT ${COLS} FROM invitations WHERE organization_id = @organization_id AND code_hash = @codeHash`, { codeHash });
  }

  /** The open (not accepted, not revoked) invitation for an address, if any. It may already be past its expiry. */
  findOpenByEmail(email: string): InvitationRow | undefined {
    return this.tdb.get<InvitationRow>(
      `SELECT ${COLS} FROM invitations WHERE organization_id = @organization_id AND email = @email AND accepted_at IS NULL AND revoked_at IS NULL`,
      { email },
    );
  }

  list(): InvitationListRow[] {
    return this.tdb.all<InvitationListRow>(
      "SELECT i.id, i.membership_id, i.email, i.code_hash, i.invited_by_membership_id, i.initial_role_id, i.expires_at, i.accepted_at, i.revoked_at, i.created_at, m.display_name AS display_name, b.display_name AS invited_by_name, r.name AS role_name FROM invitations i JOIN organization_memberships m ON m.id = i.membership_id AND m.organization_id = @organization_id LEFT JOIN organization_memberships b ON b.id = i.invited_by_membership_id AND b.organization_id = @organization_id LEFT JOIN roles r ON r.id = i.initial_role_id AND r.organization_id = @organization_id WHERE i.organization_id = @organization_id ORDER BY i.created_at DESC",
    );
  }

  /** Single-use: only an open invitation can be accepted, and only once. Returns false when someone else got there first. */
  markAccepted(id: string, now: string): boolean {
    return (
      this.tdb.run("UPDATE invitations SET accepted_at = @now, updated_at = @now WHERE organization_id = @organization_id AND id = @id AND accepted_at IS NULL AND revoked_at IS NULL", { id, now }).changes === 1
    );
  }

  markRevoked(id: string, now: string): boolean {
    return (
      this.tdb.run("UPDATE invitations SET revoked_at = @now, updated_at = @now WHERE organization_id = @organization_id AND id = @id AND accepted_at IS NULL AND revoked_at IS NULL", { id, now }).changes === 1
    );
  }
}
