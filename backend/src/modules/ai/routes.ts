import type { Response } from "express";
import { z } from "zod";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { unauthenticated } from "../../lib/errors.js";
import { authOf } from "../auth/guards.js";
import type { PermissionService } from "../permissions/service.js";
import type { AiService } from "./service.js";

/** AI Intelligence, the AI layer (stage 7.1 and the first part of 7.2): status, the organization switch, and Ask AI. */
export function registerAiRoutes(registry: RouteRegistry, deps: { permissions: PermissionService; ai: AiService }): void {
  const { permissions, ai } = deps;
  const me = (res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const a = authOf(res);
    if (!a) throw unauthenticated();
    return { a, r: String(res.locals.requestId ?? ""), c: permissions.capsOf(res, a) };
  };
  registry.add({
    method: "get",
    path: "/api/ai/status",
    access: { kind: "baseline" },
    summary: "Whether AI is connected for the caller's organization: whether the server has a key (yes or no only, never the value), whether an administrator switched AI on, the daily limits, and how many questions the caller and the organization used today. Everything AI stays disabled until both are true",
    handler: (_req, res) => { const { a, r, c } = me(res); sendData(res, ai.status(a, r, c)); },
  });
  registry.add({
    method: "put",
    path: "/api/ai/settings",
    access: { kind: "permission", key: "ai.configure" },
    summary: "Switch AI on or off for the organization: `{enabled}`. Off by default. Audited",
    schema: { body: z.object({ enabled: z.boolean() }).strict() },
    handler: (_req, res, v) => { const { a, r, c } = me(res); sendData(res, ai.setEnabled(a, r, c, (v.body as { enabled: boolean }).enabled)); },
  });
  registry.add({
    method: "post",
    path: "/api/ai/ask",
    access: { kind: "permission", key: "ai.use" },
    summary: "Ask a question about the organization's performance: `{question}` (at most 400 characters). The records sent to the AI come only from the same permission-checked queries the pages use, run as the caller. The answer says it is AI-generated, lists the records it cites as links, shows exactly what was sent, and flags figures that are not in the records. 409 ai_not_connected, 429 daily limits, 504 timeout. Every request is audited (its shape, never the text)",
    schema: { body: z.object({ question: z.string().max(2000) }).strict() },
    handler: async (_req, res, v) => { const { a, r, c } = me(res); sendData(res, await ai.ask(a, r, c, (v.body as { question: string }).question)); },
  });
}
