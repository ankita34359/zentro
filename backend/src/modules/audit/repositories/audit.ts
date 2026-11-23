import type { TenantDb } from "../../../db/tenant.js";

export interface AuditRow {
  id: string;
  actor_membership_id: string | null;
  actor_name: string | null;
  actor_type: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  before_json: string | null;
  after_json: string | null;
  request_id: string | null;
  created_at: string;
}

export interface AuditFilter {
  actorId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  from?: string;
  to?: string;
  /** Keyset cursor: rows strictly older than (createdAt, id). */
  before?: { createdAt: string; id: string };
  limit: number;
}

/**
 * The audit log is APPEND-ONLY: this class has an insert and reads, and nothing that updates or deletes a row (a test
 * greps the sources for it; the one deletion, an organization leaving with its last member, lives in erasure.ts).
 */
export class AuditRepository {
  constructor(private readonly tdb: TenantDb) {}

  insert(r: { id: string; actorType?: "user" | "system"; actorUserId: string | null; actorMembershipId: string | null; action: string; entityType: string; entityId: string | null; summary: string; beforeJson: string | null; afterJson: string | null; requestId: string | null; now: string }): void {
    this.tdb.run(
      "INSERT INTO audit_logs (id, organization_id, actor_user_id, actor_membership_id, actor_type, action, entity_type, entity_id, summary, before_json, after_json, request_id, created_at) VALUES (@id, @organization_id, @actorUserId, @actorMembershipId, @actorType, @action, @entityType, @entityId, @summary, @beforeJson, @afterJson, @requestId, @now)",
      { ...r, actorType: r.actorType ?? "user" },
    );
  }

  list(f: AuditFilter): AuditRow[] {
    return this.tdb.all<AuditRow>(
      "SELECT a.id AS id, a.actor_membership_id AS actor_membership_id, m.display_name AS actor_name, a.actor_type AS actor_type, a.action AS action, a.entity_type AS entity_type, a.entity_id AS entity_id, a.summary AS summary, a.before_json AS before_json, a.after_json AS after_json, a.request_id AS request_id, a.created_at AS created_at FROM audit_logs a LEFT JOIN organization_memberships m ON m.id = a.actor_membership_id AND m.organization_id = @organization_id WHERE a.organization_id = @organization_id AND (@actorId IS NULL OR a.actor_membership_id = @actorId) AND (@entityType IS NULL OR a.entity_type = @entityType) AND (@entityId IS NULL OR a.entity_id = @entityId) AND (@action IS NULL OR a.action = @action) AND (@sinceAt IS NULL OR a.created_at >= @sinceAt) AND (@untilAt IS NULL OR a.created_at <= @untilAt) AND (@beforeAt IS NULL OR a.created_at < @beforeAt OR (a.created_at = @beforeAt AND a.id < @beforeId)) ORDER BY a.created_at DESC, a.id DESC LIMIT @limit",
      {
        actorId: f.actorId ?? null,
        entityType: f.entityType ?? null,
        entityId: f.entityId ?? null,
        action: f.action ?? null,
        sinceAt: f.from ?? null,
        untilAt: f.to ?? null,
        beforeAt: f.before?.createdAt ?? null,
        beforeId: f.before?.id ?? "",
        limit: f.limit,
      },
    );
  }
}
