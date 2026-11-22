import type Database from "better-sqlite3";

export interface AuthTokenRow {
  id: string;
  user_id: string;
  purpose: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

/** Global table (a token belongs to a login). Only the SHA-256 of a token is stored. */
export class AuthTokensRepository {
  constructor(private readonly db: Database.Database) {}

  insert(t: { id: string; userId: string; purpose: "password_reset"; tokenHash: string; expiresAt: string; createdByUserId: string; now: string }): void {
    this.db
      .prepare(
        "INSERT INTO auth_tokens (id, user_id, purpose, token_hash, expires_at, created_by_user_id, created_at) VALUES (@id, @userId, @purpose, @tokenHash, @expiresAt, @createdByUserId, @now)",
      )
      .run(t);
  }

  findByHash(tokenHash: string, purpose: string): AuthTokenRow | undefined {
    return this.db
      .prepare("SELECT id, user_id, purpose, token_hash, expires_at, used_at, revoked_at FROM auth_tokens WHERE token_hash = @tokenHash AND purpose = @purpose")
      .get({ tokenHash, purpose }) as AuthTokenRow | undefined;
  }

  /** Single use: true only for the one caller that actually flips used_at (an unused, unrevoked token). */
  markUsed(id: string, now: string): boolean {
    return this.db.prepare("UPDATE auth_tokens SET used_at = @now WHERE id = @id AND used_at IS NULL AND revoked_at IS NULL").run({ id, now }).changes === 1;
  }

  /** A newer link replaces every older unused one for the same login. */
  revokeOpenForUser(userId: string, purpose: string, now: string): void {
    this.db
      .prepare("UPDATE auth_tokens SET revoked_at = @now WHERE user_id = @userId AND purpose = @purpose AND used_at IS NULL AND revoked_at IS NULL")
      .run({ userId, purpose, now });
  }

  purgeExpired(before: string): number {
    return this.db.prepare("DELETE FROM auth_tokens WHERE expires_at < @before").run({ before }).changes;
  }
}
