import type { TenantDb } from "../../../db/tenant.js";

export interface NotificationRow {
  id: string;
  recipient_membership_id: string;
  type: string;
  title: string;
  body: string | null;
  severity: string;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
  /** The insertion order, a stable tie-breaker for notifications created in the same millisecond. */
  seq: number;
}
const COLS = "id, recipient_membership_id, type, title, body, severity, entity_type, entity_id, read_at, created_at, rowid AS seq";

/** In-app notifications and each person's preferences, for ONE organization. */
export class NotificationsRepository {
  constructor(private readonly tdb: TenantDb) {}

  /** One person's notifications, newest first, keyset-paged (`before` = the created_at/id of the last row seen). */
  inbox(membershipId: string, o: { unreadOnly: boolean; limit: number; before?: { createdAt: string; seq: number } }): NotificationRow[] {
    return this.tdb.all<NotificationRow>(
      `SELECT ${COLS} FROM notifications WHERE organization_id = @organization_id AND recipient_membership_id = @membershipId AND dismissed_at IS NULL AND (@unread = 0 OR read_at IS NULL) AND (@beforeAt = '' OR created_at < @beforeAt OR (created_at = @beforeAt AND rowid < @beforeSeq)) ORDER BY created_at DESC, rowid DESC LIMIT @limit`,
      { membershipId, unread: o.unreadOnly ? 1 : 0, beforeAt: o.before?.createdAt ?? "", beforeSeq: o.before?.seq ?? 0, limit: o.limit },
    );
  }
  unreadCount(membershipId: string): number {
    return this.tdb.get<{ n: number }>("SELECT COUNT(*) AS n FROM notifications WHERE organization_id = @organization_id AND recipient_membership_id = @membershipId AND dismissed_at IS NULL AND read_at IS NULL", { membershipId })?.n ?? 0;
  }
  find(id: string): NotificationRow | undefined {
    return this.tdb.get<NotificationRow>(`SELECT ${COLS} FROM notifications WHERE organization_id = @organization_id AND id = @id`, { id });
  }
  /** Inserts unless this person already has one with the same dedupe key. Returns whether it was created. */
  insert(n: { id: string; recipientId: string; type: string; title: string; body: string | null; severity: string; entityType: string | null; entityId: string | null; dataJson: string | null; dedupeKey: string | null; now: string }): boolean {
    return (
      this.tdb.run(
        "INSERT OR IGNORE INTO notifications (id, organization_id, recipient_membership_id, type, title, body, severity, entity_type, entity_id, data_json, dedupe_key, created_at) VALUES (@id, @organization_id, @recipientId, @type, @title, @body, @severity, @entityType, @entityId, @dataJson, @dedupeKey, @now)",
        n,
      ).changes === 1
    );
  }
  markRead(id: string, now: string): void {
    this.tdb.run("UPDATE notifications SET read_at = COALESCE(read_at, @now) WHERE organization_id = @organization_id AND id = @id", { id, now });
  }
  markAllRead(membershipId: string, now: string): number {
    return this.tdb.run("UPDATE notifications SET read_at = @now WHERE organization_id = @organization_id AND recipient_membership_id = @membershipId AND read_at IS NULL", { membershipId, now }).changes;
  }

  preferences(membershipId: string): { type: string; in_app: number }[] {
    return this.tdb.all<{ type: string; in_app: number }>("SELECT type, in_app FROM notification_preferences WHERE organization_id = @organization_id AND membership_id = @membershipId", { membershipId });
  }
  setPreference(membershipId: string, type: string, inApp: boolean, now: string): void {
    this.tdb.run(
      "INSERT INTO notification_preferences (organization_id, membership_id, type, in_app, updated_at) VALUES (@organization_id, @membershipId, @type, @inApp, @now) ON CONFLICT (organization_id, membership_id, type) DO UPDATE SET in_app = @inApp, updated_at = @now",
      { membershipId, type, inApp: inApp ? 1 : 0, now },
    );
  }
  /** Who has switched a type off, among these people. */
  mutedAmong(type: string, membershipIds: string[]): Set<string> {
    if (membershipIds.length === 0) return new Set();
    const rows = this.tdb.all<{ membership_id: string }>("SELECT membership_id FROM notification_preferences WHERE organization_id = @organization_id AND type = @type AND in_app = 0", { type });
    const muted = new Set(rows.map((r) => r.membership_id));
    return new Set(membershipIds.filter((m) => muted.has(m)));
  }
}
