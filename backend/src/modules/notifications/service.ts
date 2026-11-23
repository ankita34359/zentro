import type { TenantCtx, TenantDb } from "../../db/tenant.js";
import { HttpError, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import type { AuthStore } from "../auth/repositories/store.js";
import type { NotificationsRepository } from "./repositories/notifications.js";
import type { AuthContext, AuthService } from "../auth/service.js";

/** Every kind of notification and what it is called on the preferences screen. A person can switch each one off. */
export const NOTIFICATION_TYPES: Readonly<Record<string, { label: string; description: string }>> = {
  "task.assigned": { label: "A task is assigned to me", description: "When someone gives you a task." },
  "task.blocked": { label: "A task I created is blocked", description: "When the person doing it reports a blocker." },
  "task.completed": { label: "A task I created is completed", description: "When the person doing it finishes it." },
  "task.comment": { label: "Comments on my tasks", description: "When someone comments on a task you created or work on." },
  "task.due_soon": { label: "A task is due soon", description: "A reminder the day before a task is due." },
  "task.overdue": { label: "A task is overdue", description: "When a task you work on or created is past its due date." },
  "task.reviewed": { label: "My finished work is reviewed", description: "When a reviewer rates the outcome of a task you completed." },
};

export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string | null;
  severity: string;
  entityType: string | null;
  entityId: string | null;
  read: boolean;
  createdAt: string;
}

export interface NewNotification {
  recipients: string[];
  type: string;
  title: string;
  body?: string | null;
  severity?: "info" | "warning" | "critical";
  entityType?: string | null;
  entityId?: string | null;
  /** The same key for the same person is delivered once. */
  dedupeKey?: string | null;
}

/** Delivers one notification to each recipient who has not switched the type off, skipping any they already have with the same dedupe key. Returns how many were created. */
export function deliverNotification(repo: NotificationsRepository, n: NewNotification, now: string): number {
  const unique = [...new Set(n.recipients)];
  const muted = repo.mutedAmong(n.type, unique);
  let created = 0;
  for (const recipientId of unique) {
    if (muted.has(recipientId)) continue;
    if (repo.insert({ id: newId(), recipientId, type: n.type, title: n.title, body: n.body ?? null, severity: n.severity ?? "info", entityType: n.entityType ?? null, entityId: n.entityId ?? null, dataJson: null, dedupeKey: n.dedupeKey ?? null, now })) created += 1;
  }
  return created;
}

/** In-app notifications (stage 4.5). Writing happens INSIDE the transaction of the change that caused it. */
export class NotificationService {
  constructor(
    private readonly store: AuthStore,
    private readonly auth: AuthService,
    private readonly clock: () => number = Date.now,
  ) {}

  private iso = (): string => new Date(this.clock()).toISOString();

  /** Delivers to each recipient who has not switched the type off. Returns how many were created. */
  notify(tdb: TenantDb, n: NewNotification): number {
    return deliverNotification(this.store.notifications(tdb), n, this.iso());
  }

  private ctx(auth: AuthContext, requestId: string): TenantCtx {
    return this.auth.tenantCtx(auth, requestId);
  }
  private me(auth: AuthContext): string {
    if (!auth.membershipId) throw new HttpError(403, "no_organization", "Join or create an organization first.");
    return auth.membershipId;
  }

  inbox(auth: AuthContext, requestId: string, q: { unreadOnly?: boolean; limit?: number; cursor?: string }): { notifications: NotificationView[]; unreadCount: number; nextCursor: string | null } {
    const me = this.me(auth);
    const repo = this.store.notifications(this.store.tenant(this.ctx(auth, requestId)));
    const limit = Math.min(Math.max(q.limit ?? 30, 1), 100);
    let before: { createdAt: string; seq: number } | undefined;
    if (q.cursor) {
      const [createdAt, seq] = Buffer.from(q.cursor, "base64url").toString("utf8").split("|");
      if (createdAt && Number.isInteger(Number(seq))) before = { createdAt, seq: Number(seq) };
    }
    const rows = repo.inbox(me, { unreadOnly: q.unreadOnly === true, limit: limit + 1, before });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      notifications: page.map((r) => ({ id: r.id, type: r.type, title: r.title, body: r.body, severity: r.severity, entityType: r.entity_type, entityId: r.entity_id, read: r.read_at !== null, createdAt: r.created_at })),
      unreadCount: repo.unreadCount(me),
      nextCursor: rows.length > limit && last ? Buffer.from(`${last.created_at}|${last.seq}`).toString("base64url") : null,
    };
  }

  markRead(auth: AuthContext, requestId: string, id: string): { unreadCount: number } {
    const me = this.me(auth);
    const repo = this.store.notifications(this.store.tenant(this.ctx(auth, requestId)));
    const n = repo.find(id);
    if (!n || n.recipient_membership_id !== me) throw notFound(); // someone else's notification looks exactly like a missing one
    repo.markRead(id, this.iso());
    return { unreadCount: repo.unreadCount(me) };
  }

  markAllRead(auth: AuthContext, requestId: string): { marked: number; unreadCount: number } {
    const me = this.me(auth);
    const repo = this.store.notifications(this.store.tenant(this.ctx(auth, requestId)));
    const marked = repo.markAllRead(me, this.iso());
    return { marked, unreadCount: repo.unreadCount(me) };
  }

  preferences(auth: AuthContext, requestId: string): { types: { type: string; label: string; description: string; inApp: boolean }[] } {
    const me = this.me(auth);
    const set = new Map(this.store.notifications(this.store.tenant(this.ctx(auth, requestId))).preferences(me).map((p) => [p.type, p.in_app === 1]));
    return { types: Object.entries(NOTIFICATION_TYPES).map(([type, t]) => ({ type, label: t.label, description: t.description, inApp: set.get(type) ?? true })) };
  }

  setPreferences(auth: AuthContext, requestId: string, input: { types: { type: string; inApp: boolean }[] }): { types: { type: string; label: string; description: string; inApp: boolean }[] } {
    const me = this.me(auth);
    const unknown = input.types.find((t) => !(t.type in NOTIFICATION_TYPES));
    if (unknown) throw new HttpError(400, "unknown_type", "That kind of notification does not exist.");
    const tdb = this.store.tenant(this.ctx(auth, requestId));
    const now = this.iso();
    this.store.transaction(() => {
      for (const t of input.types) this.store.notifications(tdb).setPreference(me, t.type, t.inApp, now);
    });
    return this.preferences(auth, requestId);
  }
}
