import type { Response } from "express";
import { z } from "zod";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { unauthenticated } from "../../lib/errors.js";
import { authOf } from "../auth/guards.js";
import type { PermissionService } from "../permissions/service.js";
import type { ReviewService } from "./service.js";

const uuid = z.string().uuid();
const body = { rating: z.number().int().nullable().optional(), sharedSummary: z.string().max(4000).optional(), developmentFocus: z.string().max(2000).optional(), privateNotes: z.string().max(4000).optional(), submit: z.boolean().optional() };

/** Performance reviews with private notes (stage 5.6). */
export function registerReviewRoutes(registry: RouteRegistry, deps: { permissions: PermissionService; reviews: ReviewService }): void {
  const { permissions, reviews } = deps;
  const call = <T>(res: Response, fn: (a: NonNullable<ReturnType<typeof authOf>>, r: string, c: ReturnType<typeof permissions.capsOf>) => T): T => {
    res.setHeader("Cache-Control", "no-store");
    const a = authOf(res);
    if (!a) throw unauthenticated();
    return fn(a, String(res.locals.requestId ?? ""), permissions.capsOf(res, a));
  };
  registry.add({
    method: "get",
    path: "/api/performance/reviews",
    access: { kind: "baseline" },
    takesEntityId: true,
    summary: "Reviews for a period (`?periodId` required, `&subjectId`) the caller may read. The person reviewed reads the shared summary and development focus of their own SUBMITTED reviews (a baseline right) and never receives `privateNotes`; the author reads everything of their own, drafts included; people with `reviews.read_shared` over the person read submitted reviews' shared parts, and `privateNotes` appear only with `reviews.read_private` over the person",
    schema: { query: z.object({ periodId: uuid, subjectId: uuid.optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => reviews.list(a, r, c, v.query as { periodId: string; subjectId?: string }))),
  });
  registry.add({
    method: "post",
    path: "/api/performance/reviews",
    access: { kind: "permission", key: "reviews.write" },
    takesEntityId: true,
    summary: "Start a review: `{periodId, subjectId, rating? (1 to 5), sharedSummary?, developmentFocus?, privateNotes?, submit?}`. The person must be inside the caller's `reviews.write` scope (403 outside_scope); never yourself (400 self_review); one per reviewer, person and period (409 exists). Audited without the text",
    schema: { body: z.object({ periodId: uuid, subjectId: uuid, ...body }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => reviews.create(a, r, c, v.body as Parameters<ReviewService["create"]>[3])), 201),
  });
  registry.add({
    method: "patch",
    path: "/api/performance/reviews/:id",
    access: { kind: "permission", key: "reviews.write" },
    takesEntityId: true,
    summary: "Change your own review or submit it (`submit: true`, needs a shared summary). Only the author (404 for anyone else); not once the person has acknowledged it (409 acknowledged). Audited without the text",
    schema: { params: z.object({ id: uuid }), body: z.object(body).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => reviews.update(a, r, c, (v.params as { id: string }).id, v.body as Parameters<ReviewService["update"]>[4]))),
  });
  registry.add({
    method: "post",
    path: "/api/performance/reviews/:id/acknowledge",
    access: { kind: "baseline" },
    takesEntityId: true,
    summary: "The person reviewed says they have read their submitted review (it then can no longer be changed). Only that person; a draft or someone else's review is 404. Audited",
    schema: { params: z.object({ id: uuid }) },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => reviews.acknowledge(a, r, c, (v.params as { id: string }).id))),
  });
}
