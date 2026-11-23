import type { Response } from "express";
import { z } from "zod";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { unauthenticated } from "../../lib/errors.js";
import { authOf } from "../auth/guards.js";
import type { PermissionService } from "../permissions/service.js";
import { DEPT_ROLES, EMPLOYMENT_TYPES, RELATIONSHIP_TYPES, TEAM_ROLES } from "./common.js";
import type { HierarchyService } from "./hierarchyService.js";
import type { PeopleService } from "./service.js";

const uuid = z.string().uuid();
const day = z.string().max(10);
const text = z.string().max(300);
const idParams = z.object({ id: uuid });
const employmentType = z.enum(EMPLOYMENT_TYPES);
const flag = z.enum(["true", "false"]);

/** People and the hierarchy (stages 2.6 and 2.7). */
export function registerPeopleRoutes(registry: RouteRegistry, deps: { permissions: PermissionService; people: PeopleService; hierarchy: HierarchyService }): void {
  const { permissions, people, hierarchy } = deps;
  const me = (res: Response) => {
    const a = authOf(res);
    if (!a) throw unauthenticated();
    return a;
  };
  const rid = (res: Response) => String(res.locals.requestId ?? "");
  const call = <T>(res: Response, fn: (a: ReturnType<typeof me>, r: string, c: ReturnType<typeof permissions.capsOf>) => T): T => {
    res.setHeader("Cache-Control", "no-store");
    const a = me(res);
    return fn(a, rid(res), permissions.capsOf(res, a));
  };

  registry.add({
    method: "get",
    path: "/api/employees",
    access: { kind: "permission", key: "people.view" },
    summary: "The people directory inside the caller's scope (and always themselves). Query: `search`, `departmentId`, `teamId`, `designationId`, `status`, `includeArchived`, `limit` (default 200, at most 500), `offset`. Returns `{people, total, limit, offset}`; `email` is present only when the caller may see sensitive details of that person",
    schema: { query: z.object({ search: z.string().max(100).optional(), departmentId: uuid.optional(), teamId: uuid.optional(), designationId: uuid.optional(), status: z.enum(["active", "invited", "suspended", "left"]).optional(), includeArchived: flag.optional(), limit: z.coerce.number().int().min(1).max(500).optional(), offset: z.coerce.number().int().min(0).optional() }).strict() },
    handler: (_req, res, v) => {
      const q = v.query as { search?: string; departmentId?: string; teamId?: string; designationId?: string; status?: string; includeArchived?: "true" | "false"; limit?: number; offset?: number };
      sendData(res, call(res, (a, r, c) => people.list(a, r, c, { ...q, includeArchived: q.includeArchived === "true" })));
    },
  });
  registry.add({
    method: "post",
    path: "/api/employees",
    access: { kind: "permission", key: "people.manage" },
    takesEntityId: true,
    summary: "Add a person who has no login yet: `{name, workEmail?, employeeCode?, employmentType?, startDate?, designationId?, departmentId?, teamId?, managerId?}`. Optional placement and a primary manager are created with them. A holder whose scope is `reports` must give a manager from their reports (403 outside_scope). 409 employee_code_taken. Audited",
    schema: { body: z.object({ name: z.string().min(1).max(200), workEmail: z.string().max(200).nullable().optional(), employeeCode: z.string().max(80).nullable().optional(), employmentType: employmentType.nullable().optional(), startDate: day.nullable().optional(), designationId: uuid.nullable().optional(), departmentId: uuid.nullable().optional(), teamId: uuid.nullable().optional(), managerId: uuid.nullable().optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => people.create(a, r, c, v.body as Parameters<PeopleService["create"]>[3])), 201),
  });
  registry.add({
    method: "get",
    path: "/api/employees/:id",
    access: { kind: "permission", key: "people.view" },
    takesEntityId: true,
    summary: "One person's profile: designation, departments, teams (current rows with ids), managers, direct reports, employment details (only with `people.view_sensitive` or `people.manage` over them, or for yourself) and what the caller may do (`can`). A person outside the caller's scope, or in another organization, is 404",
    schema: { params: idParams },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => people.profile(a, r, c, (v.params as { id: string }).id))),
  });
  registry.add({
    method: "patch",
    path: "/api/employees/:id",
    access: { kind: "permission", key: "people.manage" },
    takesEntityId: true,
    summary: "Change a person's details: `{name?, workEmail?, employeeCode?, employmentType?, startDate?, endDate?}`. A person with a login keeps the name they chose (409 has_login). Audited by field name only",
    schema: { params: idParams, body: z.object({ name: z.string().min(1).max(200).optional(), workEmail: z.string().max(200).nullable().optional(), employeeCode: z.string().max(80).nullable().optional(), employmentType: employmentType.nullable().optional(), startDate: day.nullable().optional(), endDate: day.nullable().optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => people.update(a, r, c, (v.params as { id: string }).id, v.body as Parameters<PeopleService["update"]>[4]))),
  });
  registry.add({
    method: "post",
    path: "/api/employees/:id/designation",
    access: { kind: "permission", key: "people.manage" },
    takesEntityId: true,
    summary: "Give a person a designation: `{designationId, startDate?, reason?}`. The previous one ends on the start day (history kept); the start day is today or earlier (400 future_date, before_current_start); 409 no_change. Audited",
    schema: { params: idParams, body: z.object({ designationId: uuid, startDate: day.nullable().optional(), reason: text.nullable().optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => people.setDesignation(a, r, c, (v.params as { id: string }).id, v.body as Parameters<PeopleService["setDesignation"]>[4]))),
  });
  registry.add({
    method: "post",
    path: "/api/employees/:id/archive",
    access: { kind: "permission", key: "people.manage" },
    takesEntityId: true,
    summary: "Archive a person who has no login (people with a login are removed on the Users page: 409 has_login). Refused while people report to them (409 has_reports). Their placements and lines end today; nothing is deleted",
    schema: { params: idParams },
    handler: (_req, res, v) => {
      call(res, (a, r, c) => people.archive(a, r, c, (v.params as { id: string }).id));
      sendData(res, { archived: true });
    },
  });
  registry.add({
    method: "post",
    path: "/api/employees/:id/restore",
    access: { kind: "permission", key: "people.manage" },
    takesEntityId: true,
    summary: "Bring an archived person back (their old placements stay ended; place them again)",
    schema: { params: idParams },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => people.restore(a, r, c, (v.params as { id: string }).id))),
  });
  registry.add({
    method: "get",
    path: "/api/employees/:id/history",
    access: { kind: "permission", key: "people.view" },
    takesEntityId: true,
    summary: "A person's designations, departments, teams, managers and reports over time (newest first, with start and end days)",
    schema: { params: idParams },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => people.history(a, r, c, (v.params as { id: string }).id))),
  });

  // ----- hierarchy -----
  registry.add({
    method: "get",
    path: "/api/hierarchy/reporting",
    access: { kind: "permission", key: "org.view" },
    summary: "Reporting lines of one person, current and past, as subordinate and as manager. Query: `membershipId` (default: the caller). Only people the caller may see appear",
    schema: { query: z.object({ membershipId: uuid.optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => hierarchy.reporting(a, r, c, (v.query as { membershipId?: string }).membershipId ?? a.membershipId ?? ""))),
  });
  registry.add({
    method: "post",
    path: "/api/hierarchy/reporting",
    access: { kind: "permission", key: "hierarchy.manage" },
    takesEntityId: true,
    summary: "Add a reporting line: `{subordinateId, managerId, type?: primary|secondary|dotted|project, startDate?, reason?}`. A person has one primary manager at a time: a new primary ends the old one on the start day. Loops are refused (409 would_create_cycle); 409 already_reporting. Audited",
    schema: { body: z.object({ subordinateId: uuid, managerId: uuid, type: z.enum(RELATIONSHIP_TYPES).optional(), startDate: day.nullable().optional(), reason: text.nullable().optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => hierarchy.addReporting(a, r, c, v.body as Parameters<HierarchyService["addReporting"]>[3])), 201),
  });
  registry.add({
    method: "patch",
    path: "/api/hierarchy/reporting/:id",
    access: { kind: "permission", key: "hierarchy.manage" },
    takesEntityId: true,
    summary: "End a reporting line (never deleted): `{endDate?, reason?}`; the end day is the first day it no longer applies (default today). 409 already_ended",
    schema: { params: idParams, body: z.object({ endDate: day.nullable().optional(), reason: text.nullable().optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => hierarchy.endReporting(a, r, c, (v.params as { id: string }).id, v.body as { endDate?: string | null; reason?: string | null }))),
  });
  registry.add({
    method: "post",
    path: "/api/hierarchy/move",
    access: { kind: "permission", key: "hierarchy.manage" },
    takesEntityId: true,
    summary: "Move a person to a team and/or department on a day, atomically: `{membershipId, toTeamId?, toDepartmentId?, effectiveDate?, reason?}`. Their open team and department rows end that day and the new ones start; reporting lines are untouched. 409 no_change. Audited",
    schema: { body: z.object({ membershipId: uuid, toTeamId: uuid.nullable().optional(), toDepartmentId: uuid.nullable().optional(), effectiveDate: day.nullable().optional(), reason: text.nullable().optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => hierarchy.move(a, r, c, v.body as Parameters<HierarchyService["move"]>[3]))),
  });
  registry.add({
    method: "post",
    path: "/api/teams/:id/members",
    access: { kind: "permission", key: "hierarchy.manage" },
    takesEntityId: true,
    summary: "Put a person in a team: `{membershipId, type?: lead|deputy_lead|member, allocationPct?, startDate?}`. A new lead replaces the old one (the old lead stays as a member from that day). The team's department membership is added when missing. 409 already_member",
    schema: { params: idParams, body: z.object({ membershipId: uuid, type: z.enum(TEAM_ROLES).optional(), allocationPct: z.number().int().min(1).max(100).optional(), startDate: day.nullable().optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => hierarchy.addTeamMember(a, r, c, (v.params as { id: string }).id, v.body as Parameters<HierarchyService["addTeamMember"]>[4])), 201),
  });
  registry.add({
    method: "patch",
    path: "/api/teams/:id/members/:mid",
    access: { kind: "permission", key: "hierarchy.manage" },
    takesEntityId: true,
    summary: "Change or end a team membership row: `{endDate}` ends it; `{type}` ends it and starts a new row with the new type from `effectiveDate` (default today); `{allocationPct}` changes in place",
    schema: { params: z.object({ id: uuid, mid: uuid }), body: z.object({ type: z.enum(TEAM_ROLES).optional(), allocationPct: z.number().int().min(1).max(100).optional(), endDate: day.nullable().optional(), effectiveDate: day.nullable().optional() }).strict() },
    handler: (_req, res, v) => {
      const p = v.params as { id: string; mid: string };
      sendData(res, call(res, (a, r, c) => hierarchy.changeTeamMember(a, r, c, p.id, p.mid, v.body as Parameters<HierarchyService["changeTeamMember"]>[5])));
    },
  });
  registry.add({
    method: "post",
    path: "/api/departments/:id/members",
    access: { kind: "permission", key: "hierarchy.manage" },
    takesEntityId: true,
    summary: "Put a person in a department: `{membershipId, type?: head|deputy|member, startDate?}`. A new head replaces the old one (the old head stays as a member from that day). 409 already_member",
    schema: { params: idParams, body: z.object({ membershipId: uuid, type: z.enum(DEPT_ROLES).optional(), startDate: day.nullable().optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => hierarchy.addDepartmentMember(a, r, c, (v.params as { id: string }).id, v.body as Parameters<HierarchyService["addDepartmentMember"]>[4])), 201),
  });
  registry.add({
    method: "patch",
    path: "/api/departments/:id/members/:mid",
    access: { kind: "permission", key: "hierarchy.manage" },
    takesEntityId: true,
    summary: "Change or end a department membership row: `{endDate}` ends it; `{type}` ends it and starts a new row with the new type from `effectiveDate` (default today)",
    schema: { params: z.object({ id: uuid, mid: uuid }), body: z.object({ type: z.enum(DEPT_ROLES).optional(), endDate: day.nullable().optional(), effectiveDate: day.nullable().optional() }).strict() },
    handler: (_req, res, v) => {
      const p = v.params as { id: string; mid: string };
      sendData(res, call(res, (a, r, c) => hierarchy.changeDepartmentMember(a, r, c, p.id, p.mid, v.body as Parameters<HierarchyService["changeDepartmentMember"]>[5])));
    },
  });
}
