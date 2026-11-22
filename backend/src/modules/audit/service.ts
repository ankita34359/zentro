import type { TenantCtx, TenantDb } from "../../db/tenant.js";
import { newId } from "../../lib/ids.js";
import type { AuthStore } from "../auth/repositories/store.js";
import type { AuditFilter, AuditRow } from "./repositories/audit.js";

export interface AuditEvent {
  action: string;
  entityType: string;
  entityId?: string | null;
  /** One plain sentence. Never a secret, a link, a code, a token or a password. */
  summary: string;
  /** Changed fields only. */
  before?: unknown;
  after?: unknown;
}

export interface AuditEntry {
  id: string;
  createdAt: string;
  actor: { membershipId: string | null; name: string | null; type: string };
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  before: unknown;
  after: unknown;
  requestId: string | null;
}

const parse = (s: string | null): unknown => {
  if (s === null) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

export class AuditService {
  constructor(
    private readonly store: AuthStore,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Writes one row INSIDE the caller's transaction (call it from the same `store.transaction` as the change itself). */
  record(tdb: TenantDb, ctx: TenantCtx, e: AuditEvent): void {
    this.store.audit(tdb).insert({
      id: newId(),
      actorUserId: ctx.userId || null,
      actorMembershipId: ctx.membershipId || null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      summary: e.summary,
      beforeJson: e.before === undefined ? null : JSON.stringify(e.before),
      afterJson: e.after === undefined ? null : JSON.stringify(e.after),
      requestId: ctx.requestId || null,
      now: new Date(this.clock()).toISOString(),
    });
  }

  /** Newest first, with a keyset cursor (`<createdAt>|<id>`), so paging stays correct while new rows arrive. */
  list(ctx: TenantCtx, f: Omit<AuditFilter, "before" | "limit"> & { cursor?: string; limit?: number }): { entries: AuditEntry[]; nextCursor: string | null } {
    const limit = Math.min(Math.max(f.limit ?? 50, 1), 100);
    let before: AuditFilter["before"];
    if (f.cursor) {
      const [createdAt, id] = Buffer.from(f.cursor, "base64url").toString("utf8").split("|");
      if (createdAt && id) before = { createdAt, id };
    }
    const rows: AuditRow[] = this.store.audit(this.store.tenant(ctx)).list({ ...f, before, limit: limit + 1 });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      entries: page.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        actor: { membershipId: r.actor_membership_id, name: r.actor_name, type: r.actor_type },
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        summary: r.summary,
        before: parse(r.before_json),
        after: parse(r.after_json),
        requestId: r.request_id,
      })),
      nextCursor: rows.length > limit && last ? Buffer.from(`${last.created_at}|${last.id}`).toString("base64url") : null,
    };
  }
}
