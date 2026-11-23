import type { Response } from "express";
import { z } from "zod";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { unauthenticated } from "../../lib/errors.js";
import { authOf } from "../auth/guards.js";
import type { PermissionService } from "../permissions/service.js";
import { ACTIVITY_TYPES, type MentorshipService } from "./service.js";

const uuid = z.string().uuid();
const day = z.string().max(10);
const idParams = z.object({ id: uuid });

/** Mentorship: assignments, activities, ratings and effectiveness (stage 5.5). */
export function registerMentorshipRoutes(registry: RouteRegistry, deps: { permissions: PermissionService; mentorship: MentorshipService }): void {
  const { permissions, mentorship } = deps;
  const call = <T>(res: Response, fn: (a: NonNullable<ReturnType<typeof authOf>>, r: string, c: ReturnType<typeof permissions.capsOf>) => T): T => {
    res.setHeader("Cache-Control", "no-store");
    const a = authOf(res);
    if (!a) throw unauthenticated();
    return fn(a, String(res.locals.requestId ?? ""), permissions.capsOf(res, a));
  };
  const id = (v: { params: unknown }) => (v.params as { id: string }).id;

  registry.add({
    method: "get",
    path: "/api/mentorship/assignments",
    access: { kind: "permission", key: "mentorship.view" },
    summary: "Mentorship assignments the caller may see: ones they are part of, and ones where the mentor or the mentee is inside their `mentorship.view` scope. Query: `mentorId`, `menteeId`, `status` (active, paused, ended). Each carries what the caller may do (`can`)",
    schema: { query: z.object({ mentorId: uuid.optional(), menteeId: uuid.optional(), status: z.enum(["active", "paused", "ended"]).optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => mentorship.list(a, r, c, v.query as { mentorId?: string; menteeId?: string; status?: string }))),
  });
  registry.add({
    method: "post",
    path: "/api/mentorship/assignments",
    access: { kind: "permission", key: "mentorship.manage" },
    takesEntityId: true,
    summary: "Assign a mentor to a mentee: `{mentorId, menteeId, startDate? (today or earlier), goals?, cadenceDays? (1 to 90, default 14)}`. The mentee must be inside the caller's `mentorship.manage` scope (403 outside_scope). 400 same_person; 409 duplicate, loop (two people never mentor each other). A mentee may have several mentors: the credit is shared. Audited",
    schema: { body: z.object({ mentorId: uuid, menteeId: uuid, startDate: day.optional(), goals: z.string().max(1000).optional(), cadenceDays: z.number().int().optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => mentorship.create(a, r, c, v.body as Parameters<MentorshipService["create"]>[3])), 201),
  });
  registry.add({
    method: "get",
    path: "/api/mentorship/assignments/:id",
    access: { kind: "permission", key: "mentorship.view" },
    takesEntityId: true,
    summary: "One assignment. Not visible to the caller, missing, or another organization's: 404",
    schema: { params: idParams },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => mentorship.one(a, r, c, id(v)))),
  });
  registry.add({
    method: "patch",
    path: "/api/mentorship/assignments/:id",
    access: { kind: "permission", key: "mentorship.manage" },
    takesEntityId: true,
    summary: "Change goals or cadence, pause or resume, or end an assignment: `{goals?, cadenceDays?, status?: active|paused|ended, endDate? (with ended: the day it stops applying; default today, after the start)}`. A paused assignment is not counted in scores; an ended one cannot be changed (409 ended). Audited",
    schema: { params: idParams, body: z.object({ goals: z.string().max(1000).optional(), cadenceDays: z.number().int().optional(), status: z.enum(["active", "paused", "ended"]).optional(), endDate: day.optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => mentorship.update(a, r, c, id(v), v.body as Parameters<MentorshipService["update"]>[4]))),
  });
  registry.add({
    method: "get",
    path: "/api/mentorship/assignments/:id/activities",
    access: { kind: "permission", key: "mentorship.view" },
    takesEntityId: true,
    summary: "What the mentor and mentee did together, newest first",
    schema: { params: idParams },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => mentorship.activities(a, r, c, id(v)))),
  });
  registry.add({
    method: "post",
    path: "/api/mentorship/assignments/:id/activities",
    access: { kind: "permission", key: "mentorship.log" },
    takesEntityId: true,
    summary: "Log an activity: `{type: one_on_one|feedback|review|unblock|training|goal_setting, occurredOn? (today or earlier, inside the assignment), durationMinutes?, summary, outcome?}`. The mentor, or someone with `mentorship.log` over them; not while paused (409 paused). Audited",
    schema: { params: idParams, body: z.object({ type: z.enum(ACTIVITY_TYPES), occurredOn: day.optional(), durationMinutes: z.number().int().nullable().optional(), summary: z.string().min(1).max(1000), outcome: z.string().max(500).nullable().optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => mentorship.logActivity(a, r, c, id(v), v.body as Parameters<MentorshipService["logActivity"]>[4])), 201),
  });
  registry.add({
    method: "get",
    path: "/api/mentorship/assignments/:id/progress",
    access: { kind: "permission", key: "mentorship.view" },
    takesEntityId: true,
    summary: "How the mentoring is going: the ratings people entered, and with `?periodId` the measured change in the mentee's scores for that period (baseline, current, differences, improvement index). Raw scores only for people who may see the mentee's score",
    schema: { params: idParams, query: z.object({ periodId: uuid.optional() }) },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => mentorship.progress(a, r, c, id(v), (v.query as { periodId?: string }).periodId))),
  });
  registry.add({
    method: "post",
    path: "/api/mentorship/assignments/:id/progress",
    access: { kind: "permission", key: "mentorship.log" },
    takesEntityId: true,
    summary: "Rate how the mentoring is going, 1 to 5: `{periodId, value, note?}`. Only the mentor or the mentee; stored as mentor_entered or mentee_entered. Audited",
    schema: { params: idParams, body: z.object({ periodId: uuid, value: z.number(), note: z.string().max(500).optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => mentorship.rate(a, r, c, id(v), v.body as { periodId: string; value: number; note?: string })), 201),
  });
  registry.add({
    method: "get",
    path: "/api/mentorship/effectiveness",
    access: { kind: "permission", key: "mentorship.view" },
    takesEntityId: true,
    summary: "How the mentees of each visible mentor changed in a period, with every factor disclosed: `?periodId` (required) `&mentorId`. Per mentor: the development and activity numbers, mentee count and average days; per mentee: days, duration factor, number of mentors and credit share, improvement index (50 = no change), the measured changes (only where the caller may see the mentee's score), activities against the number expected. Mentors are compared only with mentors; `caveats` says why the result has many causes",
    schema: { query: z.object({ periodId: uuid, mentorId: uuid.optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => mentorship.effectiveness(a, r, c, v.query as { periodId: string; mentorId?: string }))),
  });
}
