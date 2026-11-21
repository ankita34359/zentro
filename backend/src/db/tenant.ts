import type Database from "better-sqlite3";
import { TenantViolationError } from "../lib/errors.js";
import { GLOBAL_TABLES, lintTenantSql } from "./sqlLint.js";

/** Who is asking. Built from the signed-in session row; the ONLY source of the organization id. */
export interface TenantCtx {
  userId: string;
  membershipId: string;
  organizationId: string;
  sessionId: string;
  requestId: string;
}

export interface TenantDbOptions {
  /** Lint every statement and check every returned row. On in tests (NODE_ENV=test) or with ZENTRO_STRICT_TENANT=1. */
  strict?: boolean;
  globalTables?: ReadonlySet<string>;
}

export const strictByDefault = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.ZENTRO_STRICT_TENANT === "1" || env.NODE_ENV === "test";

type Params = Record<string, string | number | bigint | Buffer | null>;

export interface TenantDb {
  readonly organizationId: string;
  all<T = Record<string, unknown>>(sql: string, params?: Params): T[];
  get<T = Record<string, unknown>>(sql: string, params?: Params): T | undefined;
  run(sql: string, params?: Params): { changes: number };
  /** One transaction around fn; the same tenant-scoped handle is passed in. */
  transaction<T>(fn: (tx: TenantDb) => T): T;
}

/**
 * The tenant-scoped data-access handle used by repositories. Rules it enforces:
 *  1. The organization id comes from ctx and is bound as @organization_id; a caller cannot pass its own.
 *  2. (strict) every statement on an organization-owned table must filter or insert by @organization_id.
 *  3. (strict) every returned row that has an organization_id column must belong to ctx.organizationId.
 */
export function createTenantDb(db: Database.Database, ctx: TenantCtx, opts: TenantDbOptions = {}): TenantDb {
  if (!ctx.organizationId) throw new TenantViolationError("A tenant-scoped handle needs an organization id");
  const strict = opts.strict ?? strictByDefault();
  const globals = opts.globalTables ?? GLOBAL_TABLES;
  const linted = new Set<string>();

  const bind = (sql: string, params: Params = {}): Params => {
    if ("organization_id" in params) {
      throw new TenantViolationError("organization_id is bound from the session; do not pass it");
    }
    if (strict && !linted.has(sql)) {
      const problems = lintTenantSql(sql, globals);
      if (problems.length > 0) throw new TenantViolationError(`Tenant lint failed: ${problems.join("; ")}`);
      linted.add(sql);
    }
    return { ...params, organization_id: ctx.organizationId };
  };

  const checkRow = (row: unknown): void => {
    if (!strict || row === null || typeof row !== "object") return;
    const org = (row as Record<string, unknown>).organization_id;
    if (org !== undefined && org !== null && org !== ctx.organizationId) {
      throw new TenantViolationError("A row from another organization was returned");
    }
  };

  // Only keep the bound parameters the statement actually mentions (better-sqlite3 rejects extra named ones).
  const used = (sql: string, p: Params): Params => {
    const out: Params = {};
    for (const k of Object.keys(p)) if (new RegExp(`[@:$]${k}\\b`).test(sql)) out[k] = p[k]!;
    return out;
  };

  const handle: TenantDb = {
    organizationId: ctx.organizationId,
    all<T>(sql: string, params?: Params): T[] {
      const rows = db.prepare(sql).all(used(sql, bind(sql, params))) as T[];
      rows.forEach(checkRow);
      return rows;
    },
    get<T>(sql: string, params?: Params): T | undefined {
      const row = db.prepare(sql).get(used(sql, bind(sql, params))) as T | undefined;
      checkRow(row);
      return row;
    },
    run(sql: string, params?: Params) {
      return { changes: db.prepare(sql).run(used(sql, bind(sql, params))).changes };
    },
    transaction<T>(fn: (tx: TenantDb) => T): T {
      return db.transaction(() => fn(handle))();
    },
  };
  return handle;
}
