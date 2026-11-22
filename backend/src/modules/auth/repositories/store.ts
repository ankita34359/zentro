import type Database from "better-sqlite3";
import { createTenantDb, type TenantCtx, type TenantDb } from "../../../db/tenant.js";
import { MembershipsRepository, OrganizationsRepository, RolesRepository } from "./organizations.js";
import { SessionsRepository } from "./sessions.js";
import { UsersRepository } from "./users.js";

/** The one place the auth module touches the database handle: it builds the repositories and the transaction wrapper. */
export interface AuthStore {
  users: UsersRepository;
  sessions: SessionsRepository;
  orgs: OrganizationsRepository;
  tenant(ctx: TenantCtx): TenantDb;
  memberships(tdb: TenantDb): MembershipsRepository;
  roles(tdb: TenantDb): RolesRepository;
  transaction<T>(fn: () => T): T;
}

export function createAuthStore(db: Database.Database): AuthStore {
  return {
    users: new UsersRepository(db),
    sessions: new SessionsRepository(db),
    orgs: new OrganizationsRepository(db),
    tenant: (ctx) => createTenantDb(db, ctx),
    memberships: (tdb) => new MembershipsRepository(tdb),
    roles: (tdb) => new RolesRepository(tdb),
    transaction: (fn) => db.transaction(fn)(),
  };
}
