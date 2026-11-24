import crypto from "node:crypto";
import { z } from "zod";
import type { InboundLookup } from "../../db/inbound.js";
import type { TenantCtx } from "../../db/tenant.js";
import { HttpError } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { RateLimiter } from "../../lib/rateLimit.js";
import type { AuditService } from "../audit/service.js";
import type { AuthStore } from "../auth/repositories/store.js";
import type { AuthContext, AuthService } from "../auth/service.js";
import type { KpiService } from "../kpi/service.js";
import type { MeasurementService } from "../kpi/measurements.js";
import type { PermissionService } from "../permissions/service.js";
import type { Capabilities } from "../permissions/service.js";
import type { TaskService } from "../tasks/service.js";
import type { EndpointRow } from "./repositories/integrations.js";

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const ENDPOINT_KINDS = ["task", "kpi_value"] as const;

const TASK_BODY = z.object({
  title: z.string().min(1).max(160), description: z.string().max(4000).optional(), priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  dueAt: day.nullable().optional(), assigneeId: uuid.optional(),
}).strict();
const KPI_BODY = z.object({ value: z.number().min(-1e12).max(1e12), periodStart: day, valueStatus: z.enum(["recorded", "estimated", "disputed"]).optional(), note: z.string().max(1000).optional() }).strict();
const SUBJECT = z.object({ type: z.enum(["person", "team", "department", "organization"]), id: uuid.optional() }).strict();

export interface EndpointView { id: string; name: string; kind: string; path: string; tokenPrefix: string; createdAt: string; lastUsedAt: string | null; calls: number; kpiId: string | null }

const hash = (token: string): string => crypto.createHash("sha256").update(token).digest("hex");
const same = (a: string, b: string): boolean => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const DECOY = hash("decoy-token-for-unknown-endpoints");

/** Incoming endpoints: a named address plus a secret token that lets viaSocket create a task or record a KPI value in ONE organization. */
export class InboundService {
  /** Wrong or missing tokens per address: a guesser is slowed down. */
  private readonly badByIp = new RateLimiter({ max: 20, windowMs: 15 * 60_000, blockMs: 15 * 60_000, maxBlockMs: 240 * 60_000 });
  /** Every call per endpoint: 60 a minute. */
  private readonly callsByEndpoint = new RateLimiter({ max: 60, windowMs: 60_000, blockMs: 60_000, maxBlockMs: 10 * 60_000 });
  constructor(private readonly o: { lookup: (id: string) => InboundLookup | undefined; store: AuthStore; auth: AuthService; audit: AuditService; permissions: PermissionService; tasks: TaskService; measurements: MeasurementService; kpis: KpiService }) {}
  private iso = (): string => new Date(this.o.auth.now()).toISOString();
  private ctx(auth: AuthContext, requestId: string): TenantCtx { return this.o.auth.tenantCtx(auth, requestId); }

  private toView(e: EndpointRow): EndpointView {
    const cfg = JSON.parse(e.config_json) as { kpiId?: string };
    return { id: e.id, name: e.name, kind: e.kind, path: `/api/inbound/${e.id}`, tokenPrefix: e.token_prefix, createdAt: e.created_at, lastUsedAt: e.last_used_at, calls: e.call_count, kpiId: cfg.kpiId ?? null };
  }

  list(auth: AuthContext, requestId: string): EndpointView[] {
    return this.o.store.integrations(this.o.store.tenant(this.ctx(auth, requestId))).endpoints().map((e) => this.toView(e));
  }

  /** Creates an endpoint and returns its token ONCE. Only the token's SHA-256 is kept. */
  create(auth: AuthContext, requestId: string, caps: Capabilities, input: { name: string; kind: string; kpiId?: string; subject?: { type: string; id?: string } }): EndpointView & { token: string } {
    if (!caps.has("integrations.manage")) throw new HttpError(403, "permission_denied", "Only an administrator can change the automation settings.");
    const ctx = this.ctx(auth, requestId);
    const tdb = this.o.store.tenant(ctx);
    const repo = this.o.store.integrations(tdb);
    const name = input.name.replace(/\s+/g, " ").trim();
    if (name.length < 1 || name.length > 80) throw new HttpError(400, "invalid_name", "Give the endpoint a name of 1 to 80 characters.");
    if (!(ENDPOINT_KINDS as readonly string[]).includes(input.kind)) throw new HttpError(400, "invalid_value", "An endpoint creates a task or records a KPI value.");
    if (repo.endpoints().length >= 20) throw new HttpError(409, "limit_reached", "An organization can have at most 20 incoming endpoints.");
    if (repo.endpoints().some((e) => e.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, "name_taken", "An endpoint with that name already exists.");
    let config: Record<string, unknown> = {};
    if (input.kind === "kpi_value") {
      if (!input.kpiId) throw new HttpError(400, "kpi_required", "Choose the KPI this endpoint records values for.");
      const subject = SUBJECT.safeParse(input.subject ?? { type: "organization" });
      if (!subject.success) throw new HttpError(400, "invalid_value", "The subject of the values is a person, a team, a department or the organization.");
      this.o.kpis.detail(auth, requestId, caps, input.kpiId); // 404 unless the KPI exists in this organization and the administrator may see it
      config = { kpiId: input.kpiId, subject: subject.data };
    }
    const token = `zin_${crypto.randomBytes(32).toString("base64url")}`;
    const id = newId();
    const now = this.iso();
    this.o.store.transaction(() => {
      repo.insertEndpoint({ id, name, kind: input.kind, configJson: JSON.stringify(config), tokenHash: hash(token), tokenPrefix: token.slice(0, 8), by: ctx.membershipId, now });
      this.o.audit.record(tdb, ctx, { action: "integration.endpoint.create", entityType: "inbound_endpoint", entityId: id, summary: `Created the incoming endpoint "${name}" (${input.kind === "task" ? "creates tasks" : "records KPI values"})` });
    });
    return { ...this.toView(repo.endpoint(id)!), token };
  }

  remove(auth: AuthContext, requestId: string, caps: Capabilities, id: string): void {
    if (!caps.has("integrations.manage")) throw new HttpError(403, "permission_denied", "Only an administrator can change the automation settings.");
    const ctx = this.ctx(auth, requestId);
    const tdb = this.o.store.tenant(ctx);
    const repo = this.o.store.integrations(tdb);
    const e = repo.endpoint(id);
    if (!e) throw new HttpError(404, "not_found", "Not found");
    this.o.store.transaction(() => {
      repo.deleteEndpoint(id);
      this.o.audit.record(tdb, ctx, { action: "integration.endpoint.delete", entityType: "inbound_endpoint", entityId: id, summary: `Deleted the incoming endpoint "${e.name}"; its token stops working` });
    });
  }

  /** The public call. Authenticated ONLY by the endpoint's token; the organization comes from the endpoint's own row. */
  async call(endpointId: string, token: string | undefined, ip: string, requestId: string, body: unknown): Promise<{ id: string; kind: string }> {
    const wait = this.badByIp.retryAfterMs(ip);
    if (wait > 0) throw this.o.auth.tooMany(wait);
    const ep = z.string().uuid().safeParse(endpointId).success ? this.o.lookup(endpointId) : undefined;
    const given = hash(token ?? "");
    const ok = same(given, ep?.token_hash ?? DECOY) && ep !== undefined && token !== undefined && token.length > 0;
    if (!ok || !ep) {
      this.badByIp.fail(ip);
      throw new HttpError(401, "unauthenticated", "The token is missing, wrong, or has been deleted.");
    }
    const limited = this.callsByEndpoint.retryAfterMs(ep.id);
    if (limited > 0) throw this.o.auth.tooMany(limited);
    this.callsByEndpoint.fail(ep.id);
    const org = ep.organization_id;
    const membershipId = ep.created_by_membership_id;
    if (!ep.user_id || ep.creator_status !== "active") throw new HttpError(403, "endpoint_owner_not_allowed", "The person who made this endpoint can no longer act. Make a new endpoint.");
    const auth: AuthContext = { userId: ep.user_id, sessionId: `inbound:${ep.id}`, organizationId: org, membershipId };
    const caps = this.o.permissions.capabilities(auth);
    if (!caps.has("integrations.manage")) throw new HttpError(403, "endpoint_owner_not_allowed", "The person who made this endpoint is no longer allowed to manage integrations. Make a new endpoint.");
    const ctx: TenantCtx = { userId: ep.user_id, membershipId, organizationId: org, sessionId: auth.sessionId, requestId };
    const tdb = this.o.store.tenant(ctx);
    const repo = this.o.store.integrations(tdb);
    const row = repo.endpoint(ep.id)!;
    const record = (summary: string, ok: boolean, code?: string): void => {
      this.o.store.transaction(() => {
        this.o.audit.record(tdb, ctx, { action: "integration.inbound", entityType: "inbound_endpoint", entityId: ep.id, summary, after: { endpoint: row.name, kind: ep.kind, ok, ...(code ? { code } : {}) } });
        if (ok) repo.touchEndpoint(ep.id, this.iso());
      });
    };
    try {
      if (ep.kind === "task") {
        const parsed = TASK_BODY.safeParse(body);
        if (!parsed.success) throw new HttpError(400, "validation_failed", "The request body is not valid: " + parsed.error.issues.map((i) => `${i.path.join(".") || "body"} ${i.message}`).slice(0, 3).join("; "));
        const b = parsed.data;
        const t = this.o.tasks.create(auth, requestId, caps, { title: b.title, description: b.description, priority: b.priority, dueAt: b.dueAt ?? null, assigneeIds: b.assigneeId ? [b.assigneeId] : undefined });
        record(`Incoming endpoint "${row.name}" created a task`, true);
        return { id: t.id, kind: "task" };
      }
      const cfg = JSON.parse(ep.config_json) as { kpiId: string; subject: { type: "person" | "team" | "department" | "organization"; id?: string } };
      const parsed = KPI_BODY.safeParse(body);
      if (!parsed.success) throw new HttpError(400, "validation_failed", "The request body is not valid: " + parsed.error.issues.map((i) => `${i.path.join(".") || "body"} ${i.message}`).slice(0, 3).join("; "));
      this.o.measurements.record(auth, requestId, caps, cfg.kpiId, { subject: cfg.subject, periodStart: parsed.data.periodStart, value: parsed.data.value, valueStatus: parsed.data.valueStatus, note: parsed.data.note });
      record(`Incoming endpoint "${row.name}" recorded a KPI value`, true);
      return { id: cfg.kpiId, kind: "kpi_value" };
    } catch (e) {
      const code = e instanceof HttpError ? e.code : "internal_error";
      try { record(`Incoming endpoint "${row.name}" was refused (${code})`, false, code); } catch { /* the audit entry is best effort on a refusal */ }
      throw e;
    }
  }
}
