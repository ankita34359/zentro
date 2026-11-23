import type { TenantDb } from "../../../db/tenant.js";

/** The business-event log, for ONE organization. A producer writes it in the same transaction as the change. */
export class AutomationEventsRepository {
  constructor(private readonly tdb: TenantDb) {}

  /** Inserts unless this dedupe key was used already (a producer cannot enqueue the same event twice). Returns whether it was created. */
  insert(e: { id: string; eventType: string; entityType: string; entityId: string; actorId: string | null; payloadJson: string; dedupeKey: string; now: string }): boolean {
    return (
      this.tdb.run(
        "INSERT OR IGNORE INTO automation_events (id, organization_id, event_type, entity_type, entity_id, actor_membership_id, payload_json, dedupe_key, occurred_at) VALUES (@id, @organization_id, @eventType, @entityType, @entityId, @actorId, @payloadJson, @dedupeKey, @now)",
        e,
      ).changes === 1
    );
  }
  count(eventType?: string): number {
    return eventType
      ? (this.tdb.get<{ n: number }>("SELECT COUNT(*) AS n FROM automation_events WHERE organization_id = @organization_id AND event_type = @eventType", { eventType })?.n ?? 0)
      : (this.tdb.get<{ n: number }>("SELECT COUNT(*) AS n FROM automation_events WHERE organization_id = @organization_id")?.n ?? 0);
  }
}
