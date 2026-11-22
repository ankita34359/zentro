import type Database from "better-sqlite3";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  name: string;
  status: "active" | "disabled";
  default_organization_id: string | null;
}

/** Global table (a login belongs to no single organization), so these queries carry no organization filter. */
export class UsersRepository {
  constructor(private readonly db: Database.Database) {}

  findByEmail(email: string): UserRow | undefined {
    return this.db
      .prepare("SELECT id, email, password_hash, name, status, default_organization_id FROM users WHERE email = @email")
      .get({ email }) as UserRow | undefined;
  }

  findById(id: string): UserRow | undefined {
    return this.db
      .prepare("SELECT id, email, password_hash, name, status, default_organization_id FROM users WHERE id = @id")
      .get({ id }) as UserRow | undefined;
  }

  /** Returns false when the email is already taken (unique, case-insensitive). */
  insert(u: { id: string; email: string; passwordHash: string; name: string; now: string }): boolean {
    const r = this.db
      .prepare(
        "INSERT OR IGNORE INTO users (id, email, password_hash, name, created_at, updated_at) VALUES (@id, @email, @passwordHash, @name, @now, @now)",
      )
      .run(u);
    return r.changes === 1;
  }

  setDefaultOrganization(userId: string, organizationId: string, now: string): void {
    this.db
      .prepare("UPDATE users SET default_organization_id = @organizationId, updated_at = @now WHERE id = @userId")
      .run({ userId, organizationId, now });
  }

  /** The user's default organization is forgotten (they were removed from it). */
  clearDefaultOrganization(userId: string, organizationId: string, now: string): void {
    this.db.prepare("UPDATE users SET default_organization_id = NULL, updated_at = @now WHERE id = @userId AND default_organization_id = @organizationId").run({ userId, organizationId, now });
  }

  /** Replaces the password hash (reset or change). */
  setPassword(userId: string, passwordHash: string, now: string): void {
    this.db.prepare("UPDATE users SET password_hash = @passwordHash, updated_at = @now WHERE id = @userId").run({ userId, passwordHash, now });
  }

  touchLogin(userId: string, now: string): void {
    this.db.prepare("UPDATE users SET last_login_at = @now WHERE id = @userId").run({ userId, now });
  }
}
