import type { Request, Response } from "express";
import { z } from "zod";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { unauthenticated } from "../../lib/errors.js";
import { authOf } from "../auth/guards.js";
import type { PermissionService } from "../permissions/service.js";
import type { InboundService } from "./inbound.js";
import type { WebhookService } from "./webhooks.js";

const uuid = z.string().uuid();
const idParams = z.object({ id: uuid }).strict();

/** viaSocket automations: the outgoing webhook, its log, the incoming endpoints (administrators), and the public incoming call (a token). */
export function registerIntegrationRoutes(registry: RouteRegistry, deps: { permissions: PermissionService; webhooks: WebhookService; inbound: InboundService }): void {
  const { permissions, webhooks, inbound } = deps;
  const me = (res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const a = authOf(res);
    if (!a) throw unauthenticated();
    return { a, r: String(res.locals.requestId ?? ""), c: permissions.capsOf(res, a) };
  };
  registry.add({
    method: "get", path: "/api/integrations/webhooks", access: { kind: "permission", key: "integrations.view" },
    summary: "The outgoing webhook: whether an address is saved (only its host is shown), whether it is on, the per-event switches, the limits and how the signature works. Never the address's path or the signing secret",
    handler: (_req, res) => { const { a, r } = me(res); sendData(res, webhooks.get(a, r)); },
  });
  registry.add({
    method: "put", path: "/api/integrations/webhooks", access: { kind: "permission", key: "integrations.manage" },
    summary: "Save the outgoing webhook: `{url?: https address or null, enabled?, events?: {type: bool}}`. A public https address only. The first time an address is saved a signing secret is made and returned ONCE in `signingSecret`; it is never shown again. Only events after switching on are sent. Audited without the address or the secret",
    schema: { body: z.object({ url: z.string().max(2000).nullable().optional(), enabled: z.boolean().optional(), events: z.record(z.string().max(60), z.boolean()).refine((o) => Object.keys(o).length <= 40, "Too many events").optional() }).strict() },
    handler: (_req, res, v) => { const { a, r, c } = me(res); sendData(res, webhooks.save(a, r, c, v.body as { url?: string | null; enabled?: boolean; events?: Record<string, boolean> })); },
  });
  registry.add({
    method: "post", path: "/api/integrations/webhooks/rotate-secret", access: { kind: "permission", key: "integrations.manage" },
    summary: "Replace the signing secret. The new one is returned ONCE; the old one stops working. Audited",
    handler: (_req, res) => { const { a, r, c } = me(res); sendData(res, webhooks.rotateSecret(a, r, c)); },
  });
  registry.add({
    method: "post", path: "/api/integrations/webhooks/test", access: { kind: "permission", key: "integrations.manage" },
    summary: "Send a test event now (one attempt, no retries) and return the delivery. 10 in 10 minutes at most. Audited",
    handler: async (_req, res) => { const { a, r, c } = me(res); sendData(res, await webhooks.test(a, r, c)); },
  });
  registry.add({
    method: "get", path: "/api/integrations/deliveries", access: { kind: "permission", key: "integrations.view" },
    summary: "The delivery log, newest first (`?limit` up to 200): time, event, result, attempts, response code and a short error word. Never the address, the secret or what was sent",
    schema: { query: z.object({ limit: z.string().max(3).regex(/^\d{1,3}$/).optional() }).strict() },
    handler: (_req, res, v) => { const { a, r } = me(res); sendData(res, webhooks.deliveries(a, r, Number((v.query as { limit?: string }).limit ?? 50))); },
  });
  registry.add({
    method: "get", path: "/api/integrations/endpoints", access: { kind: "permission", key: "integrations.view" },
    summary: "The incoming endpoints: name, what it does, its path, the first characters of its token, when it was last used. Never the token",
    handler: (_req, res) => { const { a, r } = me(res); sendData(res, inbound.list(a, r)); },
  });
  registry.add({
    method: "post", path: "/api/integrations/endpoints", access: { kind: "permission", key: "integrations.manage" },
    summary: "Create an incoming endpoint: `{name, kind: task|kpi_value, kpiId?, subject?: {type, id?}}`. The token is returned ONCE (only its hash is kept). At most 20 endpoints. Audited",
    schema: { body: z.object({ name: z.string().min(1).max(80), kind: z.enum(["task", "kpi_value"]), kpiId: uuid.optional(), subject: z.object({ type: z.enum(["person", "team", "department", "organization"]), id: uuid.optional() }).strict().optional() }).strict() },
    handler: (_req, res, v) => { const { a, r, c } = me(res); sendData(res, inbound.create(a, r, c, v.body as { name: string; kind: string; kpiId?: string; subject?: { type: string; id?: string } }), 201); },
  });
  registry.add({
    method: "delete", path: "/api/integrations/endpoints/:id", access: { kind: "permission", key: "integrations.manage" }, takesEntityId: true,
    summary: "Delete an incoming endpoint; its token stops working at once. Audited",
    schema: { params: idParams },
    handler: (_req, res, v) => { const { a, r, c } = me(res); inbound.remove(a, r, c, (v.params as { id: string }).id); sendData(res, { deleted: true }); },
  });
  registry.add({
    method: "post", path: "/api/inbound/:id",
    access: { kind: "public", why: "called by viaSocket with the endpoint's secret token (Authorization: Bearer <token> or X-Zentro-Token); the token, not a session, authenticates it, and the endpoint's own row decides the organization" },
    summary: "Incoming call from viaSocket. A `task` endpoint takes `{title, description?, priority?, dueAt?, assigneeId?}` and creates a task; a `kpi_value` endpoint takes `{value, periodStart, valueStatus?, note?}` and records a value for the KPI and subject it was made for. 401 for a wrong or deleted token, 429 beyond 60 a minute, 400 for an invalid body. Every call is audited",
    schema: { params: idParams, body: z.record(z.string().max(60), z.union([z.string().max(4000), z.number().min(-1e12).max(1e12), z.boolean(), z.null()])).refine((o) => Object.keys(o).length <= 20, "Too many fields") },
    handler: async (req: Request, res: Response, v) => {
      res.setHeader("Cache-Control", "no-store");
      const header = req.headers.authorization;
      const token = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : (typeof req.headers["x-zentro-token"] === "string" ? req.headers["x-zentro-token"] : undefined);
      const out = await inbound.call((v.params as { id: string }).id, token, req.ip ?? "unknown", String(res.locals.requestId ?? ""), v.body);
      sendData(res, out, 201);
    },
  });
}
