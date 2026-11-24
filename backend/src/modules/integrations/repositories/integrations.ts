import type { TenantDb } from "../../../db/tenant.js";

export interface WebhookSettingsRow {
  url_enc: string | null; secret_enc: string | null; enabled: number; events_json: string; enabled_since: string | null; secret_created_at: string | null; updated_at: string;
}
export interface DeliveryRow {
  id: string; event_id: string | null; event_type: string; status: string; attempts: number; next_attempt_at: string | null; last_attempt_at: string | null;
  response_code: number | null; error: string | null; payload_json: string; is_test: number; created_at: string; delivered_at: string | null;
}
export interface EndpointRow {
  id: string; name: string; kind: string; config_json: string; token_hash: string; token_prefix: string; created_by_membership_id: string; created_at: string; last_used_at: string | null; call_count: number;
}
export interface EventRow { id: string; event_type: string; entity_type: string; entity_id: string; payload_json: string; occurred_at: string }

const DELIVERY_COLS = "id, event_id, event_type, status, attempts, next_attempt_at, last_attempt_at, response_code, error, payload_json, is_test, created_at, delivered_at";
const ENDPOINT_COLS = "id, name, kind, config_json, token_hash, token_prefix, created_by_membership_id, created_at, last_used_at, call_count";

/** The outgoing webhook, its delivery log and the incoming endpoints of ONE organization. */
export class IntegrationsRepository {
  constructor(private readonly tdb: TenantDb) {}

  // ----- settings -----
  settings(): WebhookSettingsRow | undefined {
    return this.tdb.get<WebhookSettingsRow>("SELECT url_enc, secret_enc, enabled, events_json, enabled_since, secret_created_at, updated_at FROM webhook_settings WHERE organization_id = @organization_id");
  }
  saveSettings(s: { urlEnc: string | null; secretEnc: string | null; enabled: boolean; eventsJson: string; enabledSince: string | null; secretCreatedAt: string | null; by: string; now: string }): void {
    this.tdb.run(
      "INSERT INTO webhook_settings (organization_id, url_enc, secret_enc, enabled, events_json, enabled_since, secret_created_at, updated_by_membership_id, updated_at) VALUES (@organization_id, @urlEnc, @secretEnc, @enabled, @eventsJson, @enabledSince, @secretCreatedAt, @by, @now) ON CONFLICT (organization_id) DO UPDATE SET url_enc = @urlEnc, secret_enc = @secretEnc, enabled = @enabled, events_json = @eventsJson, enabled_since = @enabledSince, secret_created_at = @secretCreatedAt, updated_by_membership_id = @by, updated_at = @now",
      { urlEnc: s.urlEnc, secretEnc: s.secretEnc, enabled: s.enabled ? 1 : 0, eventsJson: s.eventsJson, enabledSince: s.enabledSince, secretCreatedAt: s.secretCreatedAt, by: s.by, now: s.now },
    );
  }

  // ----- events to turn into deliveries -----
  /** Business events since a moment that have no delivery yet, oldest first. */
  eventsWithoutDelivery(since: string, types: string[], limit: number): EventRow[] {
    if (types.length === 0) return [];
    const params: Record<string, string | number> = { since, limit };
    const names = types.map((t, i) => { params[`t${i}`] = t; return `@t${i}`; });
    return this.tdb.all<EventRow>(
      `SELECT e.id, e.event_type, e.entity_type, e.entity_id, e.payload_json, e.occurred_at FROM automation_events e WHERE e.organization_id = @organization_id AND e.occurred_at >= @since AND e.event_type IN (${names.join(", ")}) AND NOT EXISTS (SELECT 1 FROM webhook_deliveries d WHERE d.organization_id = @organization_id AND d.event_id = e.id) ORDER BY e.occurred_at, e.id LIMIT @limit`,
      params,
    );
  }

  // ----- deliveries -----
  insertDelivery(d: { id: string; eventId: string | null; eventType: string; payloadJson: string; isTest: boolean; status: string; nextAttemptAt: string | null; now: string }): void {
    this.tdb.run(
      "INSERT OR IGNORE INTO webhook_deliveries (id, organization_id, event_id, event_type, status, attempts, next_attempt_at, payload_json, is_test, created_at) VALUES (@id, @organization_id, @eventId, @eventType, @status, 0, @nextAttemptAt, @payloadJson, @isTest, @now)",
      { id: d.id, eventId: d.eventId, eventType: d.eventType, status: d.status, nextAttemptAt: d.nextAttemptAt, payloadJson: d.payloadJson, isTest: d.isTest ? 1 : 0, now: d.now },
    );
  }
  due(now: string, limit: number): DeliveryRow[] {
    return this.tdb.all<DeliveryRow>(`SELECT ${DELIVERY_COLS} FROM webhook_deliveries WHERE organization_id = @organization_id AND status IN ('pending', 'retrying') AND next_attempt_at <= @now ORDER BY next_attempt_at, id LIMIT @limit`, { now, limit });
  }
  delivery(id: string): DeliveryRow | undefined {
    return this.tdb.get<DeliveryRow>(`SELECT ${DELIVERY_COLS} FROM webhook_deliveries WHERE organization_id = @organization_id AND id = @id`, { id });
  }
  recordAttempt(id: string, r: { status: string; attempts: number; nextAttemptAt: string | null; responseCode: number | null; error: string | null; now: string; delivered: boolean }): void {
    this.tdb.run(
      "UPDATE webhook_deliveries SET status = @status, attempts = @attempts, next_attempt_at = @nextAttemptAt, response_code = @responseCode, error = @error, last_attempt_at = @now, delivered_at = CASE WHEN @delivered = 1 THEN @now ELSE delivered_at END WHERE organization_id = @organization_id AND id = @id",
      { id, status: r.status, attempts: r.attempts, nextAttemptAt: r.nextAttemptAt, responseCode: r.responseCode, error: r.error, now: r.now, delivered: r.delivered ? 1 : 0 },
    );
  }
  recent(limit: number): DeliveryRow[] {
    return this.tdb.all<DeliveryRow>(`SELECT ${DELIVERY_COLS} FROM webhook_deliveries WHERE organization_id = @organization_id ORDER BY created_at DESC, rowid DESC LIMIT @limit`, { limit });
  }
  prune(before: string): number {
    return this.tdb.run("DELETE FROM webhook_deliveries WHERE organization_id = @organization_id AND created_at < @before AND status IN ('delivered', 'dead')", { before }).changes;
  }

  // ----- incoming endpoints -----
  endpoints(): EndpointRow[] {
    return this.tdb.all<EndpointRow>(`SELECT ${ENDPOINT_COLS} FROM inbound_endpoints WHERE organization_id = @organization_id ORDER BY created_at, id`);
  }
  endpoint(id: string): EndpointRow | undefined {
    return this.tdb.get<EndpointRow>(`SELECT ${ENDPOINT_COLS} FROM inbound_endpoints WHERE organization_id = @organization_id AND id = @id`, { id });
  }
  insertEndpoint(e: { id: string; name: string; kind: string; configJson: string; tokenHash: string; tokenPrefix: string; by: string; now: string }): void {
    this.tdb.run("INSERT INTO inbound_endpoints (id, organization_id, name, kind, config_json, token_hash, token_prefix, created_by_membership_id, created_at) VALUES (@id, @organization_id, @name, @kind, @configJson, @tokenHash, @tokenPrefix, @by, @now)", e);
  }
  deleteEndpoint(id: string): boolean {
    return this.tdb.run("DELETE FROM inbound_endpoints WHERE organization_id = @organization_id AND id = @id", { id }).changes === 1;
  }
  touchEndpoint(id: string, now: string): void {
    this.tdb.run("UPDATE inbound_endpoints SET last_used_at = @now, call_count = call_count + 1 WHERE organization_id = @organization_id AND id = @id", { id, now });
  }
}
