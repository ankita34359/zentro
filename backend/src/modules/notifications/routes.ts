import type { Response } from "express";
import { z } from "zod";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { unauthenticated } from "../../lib/errors.js";
import { authOf } from "../auth/guards.js";
import type { NotificationService } from "./service.js";

const flag = z.enum(["true", "false"]);

/** The bell and its preferences (stage 4.5). Everything here is the signed-in person's own, so there is no permission to hold. */
export function registerNotificationRoutes(registry: RouteRegistry, deps: { notifications: NotificationService }): void {
  const { notifications } = deps;
  const me = (res: Response) => {
    const a = authOf(res);
    if (!a) throw unauthenticated();
    res.setHeader("Cache-Control", "no-store");
    return a;
  };
  const rid = (res: Response) => String(res.locals.requestId ?? "");

  registry.add({
    method: "get",
    path: "/api/notifications",
    access: { kind: "baseline" },
    summary: "Your notifications, newest first, with `unreadCount`. Query: `unread=true`, `limit` (default 30, at most 100), `cursor` (from `nextCursor`)",
    schema: { query: z.object({ unread: flag.optional(), limit: z.coerce.number().int().min(1).max(100).optional(), cursor: z.string().max(300).optional() }).strict() },
    handler: (_req, res, v) => {
      const q = v.query as { unread?: string; limit?: number; cursor?: string };
      sendData(res, notifications.inbox(me(res), rid(res), { unreadOnly: q.unread === "true", limit: q.limit, cursor: q.cursor }));
    },
  });
  registry.add({
    method: "post",
    path: "/api/notifications/read-all",
    access: { kind: "baseline" },
    summary: "Mark all your notifications read",
    handler: (_req, res) => sendData(res, notifications.markAllRead(me(res), rid(res))),
  });
  registry.add({
    method: "post",
    path: "/api/notifications/:id/read",
    access: { kind: "baseline" },
    takesEntityId: true,
    summary: "Mark one of your notifications read. Someone else's, or another organization's, is 404",
    schema: { params: z.object({ id: z.string().uuid() }) },
    handler: (_req, res, v) => sendData(res, notifications.markRead(me(res), rid(res), (v.params as { id: string }).id)),
  });
  registry.add({
    method: "get",
    path: "/api/preferences",
    access: { kind: "baseline" },
    summary: "Which kinds of notification you receive in the app (all on by default)",
    handler: (_req, res) => sendData(res, notifications.preferences(me(res), rid(res))),
  });
  registry.add({
    method: "put",
    path: "/api/preferences",
    access: { kind: "baseline" },
    summary: "Switch kinds of notification on or off: `{types: [{type, inApp}]}`. 400 unknown_type",
    schema: { body: z.object({ types: z.array(z.object({ type: z.string().max(60), inApp: z.boolean() }).strict()).min(1).max(30) }).strict() },
    handler: (_req, res, v) => sendData(res, notifications.setPreferences(me(res), rid(res), v.body as { types: { type: string; inApp: boolean }[] })),
  });
}
