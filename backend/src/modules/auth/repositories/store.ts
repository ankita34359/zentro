import type Database from "better-sqlite3";
import { createTenantDb, type TenantCtx, type TenantDb } from "../../../db/tenant.js";
import { MembershipsRepository, OrganizationsRepository, RolesRepository } from "./organizations.js";
import { AuthTokensRepository } from "./authTokens.js";
import { InvitationsRepository } from "./invitations.js";
import { SessionsRepository } from "./sessions.js";
import { UsersRepository } from "./users.js";

/** The one place the auth module touches the database handle: it builds the repositories and the transaction wrapper. */
export interface AuthStore {
  users: UsersRepository;
  sessions: SessionsRepository;
  orgs: OrganizationsRepository;
  tokens: AuthTokensRepository;
  tenant(ctx: TenantCtx): TenantDb;
  memberships(tdb: TenantDb): MembershipsRepository;
  roles(tdb: TenantDb): RolesRepository;
  invitations(tdb: TenantDb): InvitationsRepository;
  transaction<T>(fn: () => T): T;
}

export function createAuthStore(db: Database.Database): AuthStore {
  return {
    users: new UsersRepository(db),
    sessions: new SessionsRepository(db),
    orgs: new OrganizationsRepository(db),
    tokens: new AuthTokensRepository(db),
    tenant: (ctx) => createTenantDb(db, ctx),
    memberships: (tdb) => new MembershipsRepository(tdb),
    roles: (tdb) => new RolesRepository(tdb),
    invitations: (tdb) => new InvitationsRepository(tdb),
    transaction: (fn) => db.transaction(fn)(),
  };
}
