import type Database from "better-sqlite3";

export interface SessionRow {
  id: string;
  user_id: string;
  active_organization_id: string | null;
  last_seen_at: string;
  expires_at: string;
  absolute_expires_at: string;
  revoked_at: string | null;
}

/** Global table. The row id is the SHA-256 of the random session id carried in the cookie's JWT. */
export class SessionsRepository {
  constructor(private readonly db: Database.Database) {}

  insert(s: { id: string; userId: string; organizationId: string | null; now: string; expiresAt: string; absoluteExpiresAt: string }): void {
    this.db
      .prepare(
        "INSERT INTO sessions (id, user_id, active_organization_id, created_at, last_seen_at, expires_at, absolute_expires_at) VALUES (@id, @userId, @organizationId, @now, @now, @expiresAt, @absoluteExpiresAt)",
      )
      .run(s);
  }

  find(id: string): SessionRow | undefined {
    return this.db
      .prepare("SELECT id, user_id, active_organization_id, last_seen_at, expires_at, absolute_expires_at, revoked_at FROM sessions WHERE id = @id")
      .get({ id }) as SessionRow | undefined;
  }

  slide(id: string, now: string, expiresAt: string): void {
    this.db.prepare("UPDATE sessions SET last_seen_at = @now, expires_at = @expiresAt WHERE id = @id AND revoked_at IS NULL").run({ id, now, expiresAt });
  }

  setOrganization(id: string, organizationId: string): void {
    this.db.prepare("UPDATE sessions SET active_organization_id = @organizationId WHERE id = @id AND revoked_at IS NULL").run({ id, organizationId });
  }

  revoke(id: string, now: string): void {
    this.db.prepare("UPDATE sessions SET revoked_at = @now WHERE id = @id AND revoked_at IS NULL").run({ id, now });
  }

  revokeAllForUser(userId: string, now: string): void {
    this.db.prepare("UPDATE sessions SET revoked_at = @now WHERE user_id = @userId AND revoked_at IS NULL").run({ userId, now });
  }

  /** The person was removed from an organization: their sessions stop pointing at it (their next request says "no organization"). */
  detachOrganization(userId: string, organizationId: string): void {
    this.db.prepare("UPDATE sessions SET active_organization_id = NULL WHERE user_id = @userId AND active_organization_id = @organizationId").run({ userId, organizationId });
  }

  /** Every session of the user except the one they are using now (after a password change). */
  revokeOthersForUser(userId: string, keepId: string, now: string): void {
    this.db.prepare("UPDATE sessions SET revoked_at = @now WHERE user_id = @userId AND id <> @keepId AND revoked_at IS NULL").run({ userId, keepId, now });
  }

  /** Housekeeping: rows past their absolute expiry (and long-revoked ones) are of no use. */
  purgeExpired(before: string): number {
    return this.db.prepare("DELETE FROM sessions WHERE absolute_expires_at < @before").run({ before }).changes;
  }
}
