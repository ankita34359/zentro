import crypto from "node:crypto";
import type { TenantCtx, TenantDb } from "../../db/tenant.js";
import { decryptField, deriveKey, encryptField } from "../../lib/crypto.js";
import { HttpError } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { RateLimiter } from "../../lib/rateLimit.js";
import type { AuditService } from "../audit/service.js";
import type { AuthStore } from "../auth/repositories/store.js";
import type { AuthContext, AuthService } from "../auth/service.js";
import type { Capabilities } from "../permissions/service.js";
import type { DeliveryRow } from "./repositories/integrations.js";
import { SendError, validateWebhookUrl, type WebhookSender } from "./sender.js";

/** The events an organization can switch on. Every one is already written to the business-event log; the payload is what that log holds: ids, names and numbers. */
export const WEBHOOK_EVENTS: { type: string; description: string }[] = [
  { type: "task.created", description: "A task was created." },
  { type: "task.assigned", description: "A task was assigned to someone." },
  { type: "task.completed", description: "A task was completed." },
  { type: "task.overdue", description: "An open task passed its due date." },
  { type: "task.reviewed", description: "A reviewer rated a finished task." },
  { type: "objective.at_risk", description: "An objective moved to at risk or delayed." },
  { type: "kpi.threshold", description: "A KPI crossed a warning or critical threshold." },
  { type: "kpi.measurement_missed", description: "A KPI period ended with no value." },
  { type: "kpi.measurement_recorded", description: "A KPI value was recorded or corrected." },
  { type: "evidence.verified", description: "Evidence was verified, rejected or sent back for more information." },
  { type: "review.submitted", description: "A performance review was submitted." },
];
const EVENT_TYPES = new Set(WEBHOOK_EVENTS.map((e) => e.type));

export const WEBHOOK_LIMITS = { timeoutMs: 8_000, maxPayloadBytes: 16_384, maxAttempts: 6, perTick: 40 } as const;
/** Minutes to wait before attempt 2, 3, 4, 5 and 6. */
export const BACKOFF_MINUTES = [1, 5, 30, 120, 360] as const;

export interface WebhookView {
  configured: boolean; enabled: boolean; host: string | null; secretSet: boolean; secretCreatedAt: string | null;
  events: { type: string; description: string; enabled: boolean }[];
  limits: { timeoutSeconds: number; maxPayloadBytes: number; maxAttempts: number; retryMinutes: readonly number[] };
  signing: { header: string; algorithm: string; how: string };
  /** Present only in the answer to the call that created or replaced the secret. */
  signingSecret?: string;
}
export interface DeliveryView { id: string; at: string; eventType: string; status: string; attempts: number; responseCode: number | null; error: string | null; isTest: boolean; nextAttemptAt: string | null }

const newSecret = (): string => `whsec_${crypto.randomBytes(24).toString("base64url")}`;
/** `t=<unix seconds>,v1=<hex>`: HMAC-SHA256 of `<t>.<body>` with the signing secret. The receiver recomputes it and compares. */
export function signBody(secret: string, body: string, t: number): string {
  return `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

/** Outgoing signed webhooks to viaSocket (or any receiver): the setting, the test event, the dispatcher that turns business events into deliveries, retries, and the log. */
export class WebhookService {
  private readonly key: Buffer;
  /** Per organization: a test event at most 10 times in 10 minutes. */
  private readonly tests = new RateLimiter({ max: 10, windowMs: 10 * 60_000, blockMs: 5 * 60_000, maxBlockMs: 30 * 60_000 });
  constructor(private readonly o: { store: AuthStore; auth: AuthService; audit: AuditService; encryptionKey: string; sender: WebhookSender; allowPrivateHosts?: boolean; clock?: () => number }) {
    this.key = deriveKey(o.encryptionKey);
  }
  private now = (): number => (this.o.clock ?? Date.now)(); // Date.now is looked up at each call, so a test clock that is set later is honoured
  private iso = (): string => new Date(this.now()).toISOString();
  private ctx(auth: AuthContext, requestId: string): TenantCtx { return this.o.auth.tenantCtx(auth, requestId); }

  // ----- the setting -----
  private view(tdb: TenantDb, secret?: string): WebhookView {
    const s = this.o.store.integrations(tdb).settings();
    const switched = s ? (JSON.parse(s.events_json) as Record<string, string | boolean>) : {};
    let host: string | null = null;
    if (s?.url_enc) { try { host = new URL(decryptField(this.key, s.url_enc)).hostname; } catch { host = null; } }
    return {
      configured: Boolean(s?.url_enc), enabled: s?.enabled === 1 && Boolean(s?.url_enc), host, secretSet: Boolean(s?.secret_enc), secretCreatedAt: s?.secret_created_at ?? null,
      events: WEBHOOK_EVENTS.map((e) => ({ ...e, enabled: Boolean(switched[e.type]) })),
      limits: { timeoutSeconds: WEBHOOK_LIMITS.timeoutMs / 1000, maxPayloadBytes: WEBHOOK_LIMITS.maxPayloadBytes, maxAttempts: WEBHOOK_LIMITS.maxAttempts, retryMinutes: BACKOFF_MINUTES },
      signing: { header: "X-Zentro-Signature", algorithm: "HMAC-SHA256", how: "The header reads t=<unix seconds>,v1=<hex>. Compute HMAC-SHA256 of the text <t>.<raw request body> with your signing secret and compare it with v1; reject a t that is more than 5 minutes old." },
      ...(secret ? { signingSecret: secret } : {}),
    };
  }

  get(auth: AuthContext, requestId: string): WebhookView {
    const ctx = this.ctx(auth, requestId);
    return this.view(this.o.store.tenant(ctx));
  }

  /** Saves the address, the on/off switch and the per-event switches. The first time an address is saved a signing secret is made and returned ONCE. */
  save(auth: AuthContext, requestId: string, caps: Capabilities, input: { url?: string | null; enabled?: boolean; events?: Record<string, boolean> }): WebhookView {
    if (!caps.has("integrations.manage")) throw new HttpError(403, "permission_denied", "Only an administrator can change the automation settings.");
    const ctx = this.ctx(auth, requestId);
    const tdb = this.o.store.tenant(ctx);
    const repo = this.o.store.integrations(tdb);
    const cur = repo.settings();
    const now = this.iso();
    let urlEnc = cur?.url_enc ?? null;
    let secretEnc = cur?.secret_enc ?? null;
    let secretCreatedAt = cur?.secret_created_at ?? null;
    let newSecretValue: string | undefined;
    if (input.url !== undefined) {
      if (input.url === null || input.url.trim() === "") { urlEnc = null; }
      else {
        const v = validateWebhookUrl(input.url, this.o.allowPrivateHosts === true);
        if (!v.ok) throw new HttpError(400, "invalid_url", v.reason);
        urlEnc = encryptField(this.key, v.url.toString());
        if (!secretEnc) { newSecretValue = newSecret(); secretEnc = encryptField(this.key, newSecretValue); secretCreatedAt = now; }
      }
    }
    // a switch holds the moment it was turned on (or false): an event type switched on later never sends what happened while it was off
    const switches = cur ? (JSON.parse(cur.events_json) as Record<string, string | boolean>) : {};
    for (const [type, on] of Object.entries(input.events ?? {})) {
      if (!EVENT_TYPES.has(type)) throw new HttpError(400, "invalid_event", `"${type}" is not an event you can switch.`);
      switches[type] = on === true ? (typeof switches[type] === "string" ? switches[type]! : now) : false;
    }
    const enabled = input.enabled ?? (cur?.enabled === 1);
    if (enabled && !urlEnc) throw new HttpError(400, "url_required", "Save an address before switching the webhook on.");
    // only events that happen AFTER the webhook is switched on are sent: turning it on never floods the receiver with history
    const wasOn = cur?.enabled === 1 && Boolean(cur?.url_enc);
    const enabledSince = enabled ? (wasOn ? cur!.enabled_since : now) : null;
    this.o.store.transaction(() => {
      repo.saveSettings({ urlEnc, secretEnc, enabled, eventsJson: JSON.stringify(switches), enabledSince, secretCreatedAt, by: ctx.membershipId, now });
      this.o.audit.record(tdb, ctx, {
        action: "integration.webhook.save", entityType: "organization", entityId: ctx.organizationId,
        summary: `Changed the outgoing webhook (${enabled ? "on" : "off"}${input.url !== undefined ? ", address changed" : ""}${input.events ? ", event switches changed" : ""}${newSecretValue ? ", signing secret created" : ""})`,
        before: { enabled: wasOn }, after: { enabled, switchedOn: Object.entries(switches).filter(([, v]) => Boolean(v)).map(([k]) => k) }, // never the address or the secret
      });
    });
    return this.view(tdb, newSecretValue);
  }

  rotateSecret(auth: AuthContext, requestId: string, caps: Capabilities): WebhookView {
    if (!caps.has("integrations.manage")) throw new HttpError(403, "permission_denied", "Only an administrator can change the automation settings.");
    const ctx = this.ctx(auth, requestId);
    const tdb = this.o.store.tenant(ctx);
    const repo = this.o.store.integrations(tdb);
    const cur = repo.settings();
    if (!cur?.url_enc) throw new HttpError(409, "url_required", "Save an address first.");
    const secret = newSecret();
    const now = this.iso();
    this.o.store.transaction(() => {
      repo.saveSettings({ urlEnc: cur.url_enc, secretEnc: encryptField(this.key, secret), enabled: cur.enabled === 1, eventsJson: cur.events_json, enabledSince: cur.enabled_since, secretCreatedAt: now, by: ctx.membershipId, now });
      this.o.audit.record(tdb, ctx, { action: "integration.webhook.rotate", entityType: "organization", entityId: ctx.organizationId, summary: "Replaced the webhook signing secret" });
    });
    return this.view(tdb, secret);
  }

  // ----- sending -----
  private payload(deliveryId: string, orgId: string, type: string, occurredAt: string, entity: { type: string; id: string } | null, data: unknown): string {
    return JSON.stringify({ id: deliveryId, type, occurredAt, organizationId: orgId, entity, data });
  }

  /** One attempt. Records what happened on the delivery row (status, attempts, response code, a short error word) and returns the new row. */
  private async attempt(tdb: TenantDb, d: DeliveryRow, final: boolean): Promise<DeliveryRow> {
    const repo = this.o.store.integrations(tdb);
    const s = repo.settings();
    const now = this.iso();
    const fail = (error: string, code: number | null, retryable: boolean): DeliveryRow => {
      const attempts = d.attempts + 1;
      const dead = final || !retryable || attempts >= WEBHOOK_LIMITS.maxAttempts;
      const next = dead ? null : new Date(this.now() + BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)]! * 60_000).toISOString();
      repo.recordAttempt(d.id, { status: dead ? "dead" : "retrying", attempts, nextAttemptAt: next, responseCode: code, error, now, delivered: false });
      return repo.delivery(d.id)!;
    };
    if (!s?.url_enc || !s.secret_enc) return fail("not_configured", null, false);
    if (Buffer.byteLength(d.payload_json, "utf8") > WEBHOOK_LIMITS.maxPayloadBytes) return fail("payload_too_large", null, false);
    let url: string; let secret: string;
    try { url = decryptField(this.key, s.url_enc); secret = decryptField(this.key, s.secret_enc); } catch { return fail("not_configured", null, false); }
    const t = Math.floor(this.now() / 1000);
    try {
      const res = await this.o.sender.send({
        url, body: d.payload_json, timeoutMs: WEBHOOK_LIMITS.timeoutMs,
        headers: { "Content-Type": "application/json", "User-Agent": "Zentro-Webhook/1", "X-Zentro-Event": d.event_type, "X-Zentro-Delivery": d.id, "X-Zentro-Signature": signBody(secret, d.payload_json, t) },
      });
      if (res.status >= 200 && res.status < 300) {
        repo.recordAttempt(d.id, { status: "delivered", attempts: d.attempts + 1, nextAttemptAt: null, responseCode: res.status, error: null, now, delivered: true });
        return repo.delivery(d.id)!;
      }
      return fail(`http_${res.status}`, res.status, res.status === 408 || res.status === 429 || res.status >= 500);
    } catch (e) {
      return fail(e instanceof SendError ? e.code : "network", null, true);
    }
  }

  /** "Send test event": one immediate attempt, no retries, recorded in the log. */
  async test(auth: AuthContext, requestId: string, caps: Capabilities): Promise<DeliveryView> {
    if (!caps.has("integrations.manage")) throw new HttpError(403, "permission_denied", "Only an administrator can change the automation settings.");
    const ctx = this.ctx(auth, requestId);
    const tdb = this.o.store.tenant(ctx);
    const repo = this.o.store.integrations(tdb);
    if (!repo.settings()?.url_enc) throw new HttpError(409, "url_required", "Save an address first.");
    const wait = this.tests.retryAfterMs(ctx.organizationId);
    if (wait > 0) throw this.o.auth.tooMany(wait);
    this.tests.fail(ctx.organizationId);
    const id = newId();
    const now = this.iso();
    repo.insertDelivery({ id, eventId: null, eventType: "test.ping", payloadJson: this.payload(id, ctx.organizationId, "test.ping", now, null, { message: "This is a test event from Zentro." }), isTest: true, status: "pending", nextAttemptAt: now, now });
    const done = await this.attempt(tdb, repo.delivery(id)!, true);
    this.o.store.transaction(() => this.o.audit.record(tdb, ctx, { action: "integration.webhook.test", entityType: "organization", entityId: ctx.organizationId, summary: `Sent a test event to the webhook (${done.status}${done.response_code ? `, ${done.response_code}` : ""})` }));
    return toView(done);
  }

  deliveries(auth: AuthContext, requestId: string, limit = 50): DeliveryView[] {
    const ctx = this.ctx(auth, requestId);
    return this.o.store.integrations(this.o.store.tenant(ctx)).recent(Math.max(1, Math.min(200, limit))).map(toView);
  }

  // ----- the dispatcher (called by the tick for every organization) -----
  /** Turns new, switched-on business events into deliveries, then makes the attempts that are due. Safe to repeat: an event gets one delivery, ever. */
  async dispatchFor(tdb: TenantDb, orgId: string): Promise<{ queued: number; sent: number; failed: number }> {
    const repo = this.o.store.integrations(tdb);
    const s = repo.settings();
    const out = { queued: 0, sent: 0, failed: 0 };
    if (!s || s.enabled !== 1 || !s.url_enc || !s.secret_enc || !s.enabled_since) return out;
    const switched = (Object.entries(JSON.parse(s.events_json) as Record<string, string | boolean>).filter(([k, v]) => Boolean(v) && EVENT_TYPES.has(k)) as [string, string | true][]);
    const now = this.iso();
    const fresh = switched.flatMap(([type, on]) => repo.eventsWithoutDelivery(typeof on === "string" && on > s.enabled_since! ? on : s.enabled_since!, [type], WEBHOOK_LIMITS.perTick * 5));
    fresh.sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : 0));
    for (const e of fresh.slice(0, WEBHOOK_LIMITS.perTick * 5)) {
      let data: unknown = {};
      try { data = JSON.parse(e.payload_json); } catch { data = {}; }
      const id = newId();
      repo.insertDelivery({ id, eventId: e.id, eventType: e.event_type, payloadJson: this.payload(id, orgId, e.event_type, e.occurred_at, { type: e.entity_type, id: e.entity_id }, data), isTest: false, status: "pending", nextAttemptAt: now, now });
      out.queued += 1;
    }
    for (const d of repo.due(now, WEBHOOK_LIMITS.perTick)) {
      const r = await this.attempt(tdb, d, false);
      if (r.status === "delivered") out.sent += 1; else out.failed += 1;
    }
    repo.prune(new Date(this.now() - 30 * 86_400_000).toISOString());
    return out;
  }
}

const toView = (d: DeliveryRow): DeliveryView => ({ id: d.id, at: d.created_at, eventType: d.event_type, status: d.status, attempts: d.attempts, responseCode: d.response_code, error: d.error, isTest: d.is_test === 1, nextAttemptAt: d.next_attempt_at });
