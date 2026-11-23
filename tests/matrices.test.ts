import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { PERMISSIONS, PERMISSION_KEYS } from "../backend/src/modules/permissions/catalog.js";
import { noHierarchy, resolveScope, isEmptyScope, type Grant } from "../backend/src/modules/permissions/resolver.js";
import { ROLE_TEMPLATES } from "../backend/src/modules/permissions/roleTemplates.js";
import type { RouteDef } from "../backend/src/http/registry.js";
import { ORIGIN, type TestApp } from "./helpers/app.js";
import { get, invite, makeAuthApp, post, signUpWithOrg } from "./helpers/auth.js";
import { addPerson, roleIds } from "./helpers/roles.js";

let t: TestApp;
afterEach(() => t?.cleanup());

const call = (route: RouteDef, cookie: string | undefined, params: Record<string, string>, body: Record<string, unknown> = {}) => {
  const url = route.path.replace(/:(\w+)/g, (_m, name: string) => params[name] ?? randomUUID());
  const r = request(t.app)[route.method](url).set("Origin", ORIGIN);
  if (cookie) r.set("Cookie", cookie);
  return route.method === "get" ? r.query(body) : r.send(body);
};

/** The grants a template gives, as the resolver sees them for an organization-wide assignment. */
function templateGrants(key: string): Grant[] {
  const tpl = ROLE_TEMPLATES.find((x) => x.key === key)!;
  const pairs = key === "owner" ? PERMISSIONS.map((p) => [p.key, ["all_in_scope"] as const] as const) : Object.entries(tpl.grants);
  return pairs.flatMap(([permission, modes]) => modes.map((mode) => ({ scopeType: "organization" as const, scopeId: null, permission, mode })));
}
const allowedByTemplate = (key: string, permission: string): boolean => !isEmptyScope(resolveScope(templateGrants(key), permission, "someone", noHierarchy, ""));

describe("permission matrix: every role template × every route that needs a permission (generated from the route registry)", () => {
  it("answers 403 exactly when the template does not grant the route's key, and never 401/403 when it does", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ids = await roleIds(t.app, owner);
    const people: Record<string, string> = { owner };
    for (const tpl of ROLE_TEMPLATES.filter((x) => x.key !== "owner")) people[tpl.key] = (await addPerson(t.app, owner, `${tpl.key}@example.com`, (ids as Record<string, string>)[tpl.key]!, tpl.name)).cookie;

    const routes = t.registry.list().filter((r) => r.access.kind === "permission");
    expect(routes.length).toBeGreaterThanOrEqual(8);
    let cells = 0;
    for (const route of routes) {
      const key = (route.access as { key: string }).key;
      expect(PERMISSION_KEYS.has(key), `${route.path} uses an unknown permission key ${key}`).toBe(true);
      for (const tpl of ROLE_TEMPLATES) {
        const res = await call(route, people[tpl.key], {});
        const granted = allowedByTemplate(tpl.key, key);
        if (granted) expect([401, 403], `${tpl.key} ${route.method} ${route.path} should pass the guard (${key})`).not.toContain(res.status);
        else expect(res.status, `${tpl.key} ${route.method} ${route.path} should be refused (${key})`).toBe(403);
        cells += 1;
      }
    }
    expect(cells).toBe(routes.length * ROLE_TEMPLATES.length);
  });

  it("a person with NO role (joined before roles existed) is refused every permission route and can use every baseline route", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const nobody = (await addPerson(t.app, owner, "norole@example.com", undefined, "No Role")).cookie;
    for (const route of t.registry.list().filter((r) => r.access.kind === "permission")) {
      expect((await call(route, nobody, {})).status, `no role: ${route.method} ${route.path}`).toBe(403);
    }
    for (const route of t.registry.list().filter((r) => r.access.kind === "baseline" && r.path !== "/api/organizations")) {
      expect([401, 403], `no role: ${route.method} ${route.path}`).not.toContain((await call(route, nobody, {})).status);
    }
    // and the API holds no organization-wide data route at all that a baseline person could reach: every route that
    // returns lists of people or records is a permission route (this fails if someone adds a data route as baseline)
    const baselineGets = t.registry.list().filter((r) => r.access.kind === "baseline" && r.method === "get").map((r) => r.path).sort();
    // (stage 6.1's overview adds counts over the scope the person's permissions already reach, and nothing beyond it;
    // stages 4.4 and 4.5 add the signed-in person's OWN data: my work, daily updates, notifications and preferences. Each
    // returns only the caller's rows; the tenancy matrix below checks that none of another organization's appears.)
    expect(baselineGets).toEqual(["/api/auth/delete-account/preview", "/api/auth/me", "/api/daily-updates", "/api/my-work", "/api/notifications", "/api/organization", "/api/overview", "/api/preferences"]);
  });

  it("every role can use the baseline routes without any permission", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ids = await roleIds(t.app, owner);
    const baseline = t.registry.list().filter((r) => r.access.kind === "baseline" && r.path !== "/api/organizations");
    expect(baseline.length).toBeGreaterThanOrEqual(4);
    for (const tpl of ROLE_TEMPLATES) {
      const cookie = tpl.key === "owner" ? owner : (await addPerson(t.app, owner, `${tpl.key}@example.com`, (ids as Record<string, string>)[tpl.key]!, tpl.name)).cookie;
      for (const route of baseline) {
        const res = await call(route, cookie, {});
        expect([401, 403], `${tpl.key} ${route.method} ${route.path}`).not.toContain(res.status);
      }
    }
  });

  it("every route that is not public or the cron route answers 401 with no session", async () => {
    t = makeAuthApp();
    for (const route of t.registry.list().filter((r) => r.access.kind === "baseline" || r.access.kind === "permission")) {
      expect((await call(route, undefined, {})).status, `${route.method} ${route.path}`).toBe(401);
    }
  });

  it("a route with a path parameter is marked takesEntityId (so the tenancy matrix covers it)", async () => {
    t = makeAuthApp();
    for (const route of t.registry.list()) if (route.path.includes(":")) expect(route.takesEntityId, `${route.method} ${route.path}`).toBe(true);
  });
});

describe("tenancy matrix: an administrator of organization B against organization A (generated from the route registry)", () => {
  it("every route that takes an id answers 404 for A's ids, every list excludes A's rows, and A's data is untouched", async () => {
    t = makeAuthApp();
    const ownerA = await signUpWithOrg(t.app, "owner-a@example.com", "Alpha Co");
    const ownerB = await signUpWithOrg(t.app, "owner-b@example.com", "Beta Co");
    const idsA = await roleIds(t.app, ownerA);
    const invA = await invite(t.app, ownerA, "pending-a@example.com", "Pending Alpha");
    const personA = await addPerson(t.app, ownerA, "member-a@example.com", idsA.employee, "Member Alpha");
    const assignmentA = (t.db.prepare("SELECT id FROM user_role_assignments WHERE membership_id = ?").get(personA.membershipId) as { id: string }).id;
    const mk = async (path: string, body: Record<string, unknown>): Promise<string> => {
      const r = await post(t.app, path, body, ownerA);
      expect(r.status, path).toBe(201);
      return (r.body as { data: { id: string } }).data.id;
    };
    const deptA = await mk("/api/departments", { name: "Alpha Engineering" });
    const teamA = await mk("/api/teams", { name: "Alpha Platform", departmentId: deptA });
    const familyA = await mk("/api/role-families", { name: "Alpha Engineers" });
    const designationA = await mk("/api/designations", { name: "Alpha Mentor", roleFamilyId: familyA });
    const dirA = await mk("/api/employees", { name: "Dana Alpha", teamId: teamA, managerId: personA.membershipId });
    const taskA = await mk("/api/tasks", { title: "Alpha secret task", assigneeIds: [personA.membershipId] });
    const commentA = await mk(`/api/tasks/${taskA}/comments`, { body: "Alpha secret comment" });
    const taskA2 = await mk("/api/tasks", { title: "Alpha secret second task", assigneeIds: [personA.membershipId] });
    expect((await post(t.app, `/api/tasks/${taskA2}/dependencies`, { dependsOnId: taskA }, ownerA)).status).toBe(201);
    const objectiveA = await mk("/api/objectives", { level: "team", teamId: teamA, title: "Alpha secret objective", startDate: "2026-01-01", endDate: "2026-12-31", keyResults: [{ title: "Alpha secret key result", targetValue: 100 }] });
    const parentA = await mk("/api/objectives", { level: "company", title: "Alpha secret parent objective", startDate: "2026-01-01", endDate: "2026-12-31" });
    expect((await post(t.app, `/api/objectives/${objectiveA}/assignments`, { teamId: teamA }, ownerA)).status).toBe(201);
    const objectiveAssignmentA = (t.db.prepare("SELECT id FROM objective_assignments WHERE objective_id = ?").get(objectiveA) as { id: string }).id;
    const kpiA = await mk("/api/kpis", { name: "Alpha secret KPI", defaultTarget: 10 });
    expect((await post(t.app, `/api/kpis/${kpiA}/assignments`, { teamId: teamA }, ownerA)).status).toBe(201);
    expect((await post(t.app, `/api/kpis/${kpiA}/measurements`, { subject: { type: "person", id: personA.membershipId }, periodStart: "2026-01-01", value: 7 }, ownerA)).status).toBe(201);
    const kpiAssignmentA = (t.db.prepare("SELECT id FROM kpi_assignments WHERE kpi_id = ?").get(kpiA) as { id: string }).id;
    const modelA = ((await get(t.app, "/api/performance/models", ownerA)).body.data as { id: string; name: string }[]).find((m) => m.name === "Employee")!.id;
    const keyResultA = (t.db.prepare("SELECT id FROM key_results WHERE objective_id = ?").get(objectiveA) as { id: string }).id;
    const assignmentRowA = (t.db.prepare("SELECT id FROM task_assignments WHERE task_id = ?").get(taskA) as { id: string }).id;
    const notificationA = (t.db.prepare("SELECT id FROM notifications WHERE recipient_membership_id = ?").get(personA.membershipId) as { id: string }).id;
    const rowOf = (table: string, col = "membership_id") => (t.db.prepare(`SELECT id FROM ${table} WHERE ${col} = ?`).get(dirA) as { id: string }).id;
    const reportingA = rowOf("reporting_relationships", "subordinate_membership_id");
    const teamRowA = rowOf("team_memberships");
    const deptRowA = rowOf("department_memberships");
    // Each id route: the ids of A's records to try as B, and a body that PASSES validation (so the answer comes from the lookup, not from validation).
    const fixtures: Record<string, { params: Record<string, string>; body?: Record<string, unknown> }> = {
      "/api/invitations/:id/revoke": { params: { id: invA.invitation.id } },
      "/api/invitations/:id/regenerate": { params: { id: invA.invitation.id } },
      "/api/roles/:id": { params: { id: idsA.employee! }, body: { name: "Hacked by B" } },
      "/api/roles/:id/permissions": { params: { id: idsA.employee! }, body: { grants: [] } },
      "/api/roles/:id/archive": { params: { id: idsA.employee! } },
      "/api/role-assignments/:id/revoke": { params: { id: assignmentA } },
      "/api/people/:membershipId/reset-link": { params: { membershipId: personA.membershipId } },
      "/api/people/:membershipId/remove": { params: { membershipId: personA.membershipId } },
      "/api/departments/:id": { params: { id: deptA }, body: { name: "Hacked by B" } },
      "/api/departments/:id/archive": { params: { id: deptA } },
      "/api/departments/:id/restore": { params: { id: deptA } },
      "/api/teams/:id": { params: { id: teamA }, body: { name: "Hacked by B" } },
      "/api/teams/:id/archive": { params: { id: teamA } },
      "/api/teams/:id/restore": { params: { id: teamA } },
      "/api/role-families/:id": { params: { id: familyA }, body: { name: "Hacked by B" } },
      "/api/role-families/:id/archive": { params: { id: familyA } },
      "/api/role-families/:id/restore": { params: { id: familyA } },
      "/api/designations/:id": { params: { id: designationA }, body: { name: "Hacked by B" } },
      "/api/designations/:id/archive": { params: { id: designationA } },
      "/api/designations/:id/restore": { params: { id: designationA } },
      "/api/employees": { params: {}, body: { name: "Intruder", designationId: designationA } },
      "/api/employees/:id": { params: { id: dirA }, body: { name: "Hacked by B" } },
      "/api/employees/:id/designation": { params: { id: dirA }, body: { designationId: designationA } },
      "/api/employees/:id/archive": { params: { id: dirA } },
      "/api/employees/:id/restore": { params: { id: dirA } },
      "/api/employees/:id/history": { params: { id: dirA } },
      "/api/hierarchy/reporting": { params: {}, body: { subordinateId: dirA, managerId: personA.membershipId } },
      "/api/hierarchy/reporting/:id": { params: { id: reportingA }, body: {} },
      "/api/hierarchy/move": { params: {}, body: { membershipId: dirA, toTeamId: teamA } },
      "/api/teams/:id/members": { params: { id: teamA }, body: { membershipId: dirA } },
      "/api/teams/:id/members/:mid": { params: { id: teamA, mid: teamRowA }, body: { allocationPct: 50 } },
      "/api/departments/:id/members": { params: { id: deptA }, body: { membershipId: dirA } },
      "/api/departments/:id/members/:mid": { params: { id: deptA, mid: deptRowA }, body: { type: "deputy" } },
      "/api/tasks": { params: {}, body: { title: "Intruder", assigneeIds: [personA.membershipId], teamId: teamA } },
      "/api/tasks/:id": { params: { id: taskA }, body: { title: "Hacked by B" } },
      "/api/tasks/:id/assignments": { params: { id: taskA }, body: { assigneeId: personA.membershipId } },
      "/api/tasks/:id/assignments/:aid/end": { params: { id: taskA, aid: assignmentRowA } },
      "/api/tasks/:id/updates": { params: { id: taskA }, body: { type: "time_log", minutesLogged: 5 } },
      "/api/tasks/:id/comments": { params: { id: taskA }, body: { body: "Hacked by B" } },
      "/api/tasks/:id/comments/:cid": { params: { id: taskA, cid: commentA }, body: { body: "Hacked by B" } },
      "/api/tasks/:id/dependencies": { params: { id: taskA2 }, body: { dependsOnId: taskA } },
      "/api/tasks/:id/dependencies/:depId": { params: { id: taskA2, depId: taskA } },
      "/api/tasks/:id/outcome": { params: { id: taskA }, body: { summary: "Hacked by B" } },
      "/api/tasks/:id/review": { params: { id: taskA }, body: { quality: 1 } },
      "/api/objectives": { params: {}, body: { level: "team", teamId: teamA, title: "Intruder", startDate: "2026-01-01", endDate: "2026-12-31" } },
      "/api/objectives/:id": { params: { id: objectiveA }, body: { title: "Hacked by B" } },
      "/api/objectives/:id/publish": { params: { id: objectiveA }, body: { published: true } },
      "/api/objectives/:id/history": { params: { id: objectiveA } },
      "/api/objectives/:id/alignment": { params: { id: objectiveA } },
      "/api/objectives/:id/parent": { params: { id: objectiveA }, body: { parentId: parentA } },
      "/api/objectives/:id/assignments": { params: { id: objectiveA }, body: { assigneeId: personA.membershipId } },
      "/api/objectives/:id/assignments/:aid": { params: { id: objectiveA, aid: objectiveAssignmentA } },
      "/api/objectives/:id/key-results": { params: { id: objectiveA }, body: { title: "Hacked by B", targetValue: 10 } },
      "/api/key-results/:id": { params: { id: keyResultA }, body: { title: "Hacked by B" } },
      "/api/key-results/:id/progress": { params: { id: keyResultA }, body: { value: 5 } },
      "/api/kpis/:id": { params: { id: kpiA }, body: { name: "Hacked by B" } },
      "/api/kpis/:id/archive": { params: { id: kpiA } },
      "/api/kpis/:id/assignments": { params: { id: kpiA }, body: { assigneeId: personA.membershipId, targetValue: 5 } },
      "/api/kpis/:id/assignments/:aid": { params: { id: kpiA, aid: kpiAssignmentA }, body: { weight: 2 } },
      "/api/kpis/:id/thresholds": { params: { id: kpiA }, body: { thresholds: [] } },
      "/api/kpis/:id/subjects": { params: { id: kpiA } },
      "/api/kpis/:id/history": { params: { id: kpiA }, body: { subject: `person:${personA.membershipId}` } },
      "/api/kpis/:id/measurements": { params: { id: kpiA }, body: { subject: { type: "person", id: personA.membershipId }, periodStart: "2026-01-01", value: 5 } },
      "/api/performance/models/:id": { params: { id: modelA }, body: { name: "Hacked by B" } },
      "/api/performance/models/:id/activate": { params: { id: modelA } },
      "/api/performance/models/preview": { params: {}, body: { modelId: modelA, values: { okr: 50 } } },
      "/api/notifications/:id/read": { params: { id: notificationA } },
      "/api/demo/view-as/:membershipId": { params: { membershipId: personA.membershipId } },
    };
    const snapshot = () => JSON.stringify([
      t.db.prepare("SELECT id, revoked_at, accepted_at, code_hash FROM invitations ORDER BY id").all(),
      t.db.prepare("SELECT id, status, user_id FROM organization_memberships ORDER BY id").all(),
      t.db.prepare("SELECT id, role_id, revoked_at FROM user_role_assignments ORDER BY id").all(),
      t.db.prepare("SELECT COUNT(*) n FROM auth_tokens").get(),
      t.db.prepare("SELECT COUNT(*) n FROM role_permissions").get(),
      t.db.prepare("SELECT id, name, archived_at FROM roles ORDER BY id").all(),
      t.db.prepare("SELECT id, parent_id, name, archived_at FROM departments ORDER BY id").all(),
      t.db.prepare("SELECT id, department_id, parent_team_id, name, archived_at FROM teams ORDER BY id").all(),
      t.db.prepare("SELECT id, name, archived_at FROM role_families ORDER BY id").all(),
      t.db.prepare("SELECT id, role_family_id, name, archived_at FROM designations ORDER BY id").all(),
      t.db.prepare("SELECT id, display_name, status, archived_at, designation_id, user_id FROM organization_memberships ORDER BY id").all(),
      t.db.prepare("SELECT id, subordinate_membership_id, manager_membership_id, relationship_type, start_date, end_date FROM reporting_relationships ORDER BY id").all(),
      t.db.prepare("SELECT id, team_id, membership_id, membership_type, allocation_pct, start_date, end_date FROM team_memberships ORDER BY id").all(),
      t.db.prepare("SELECT id, department_id, membership_id, membership_type, start_date, end_date FROM department_memberships ORDER BY id").all(),
      t.db.prepare("SELECT id, membership_id, designation_id, start_date, end_date FROM designation_assignments ORDER BY id").all(),
      t.db.prepare("SELECT id, title, status, progress_pct, due_at, archived_at FROM tasks ORDER BY id").all(),
      t.db.prepare("SELECT id, task_id, assignee_membership_id, assignee_team_id, role, unassigned_at FROM task_assignments ORDER BY id").all(),
      t.db.prepare("SELECT id, task_id, update_type, to_status, body FROM task_updates ORDER BY id").all(),
      t.db.prepare("SELECT id, task_id, body, edited_at, deleted_at FROM task_comments ORDER BY id").all(),
      t.db.prepare("SELECT id, recipient_membership_id, read_at, dismissed_at FROM notifications ORDER BY id").all(),
      t.db.prepare("SELECT id, objective_id, key_result_id, outcome_summary, outcome_quality FROM tasks ORDER BY id").all(),
      t.db.prepare("SELECT task_id, depends_on_task_id FROM task_dependencies ORDER BY task_id").all(),
      t.db.prepare("SELECT id, title, lifecycle, visibility, archived_at, level FROM objectives ORDER BY id").all(),
      t.db.prepare("SELECT id, objective_id, title, target_value, current_value FROM key_results ORDER BY id").all(),
      t.db.prepare("SELECT id, parent_objective_id, child_objective_id, contribution_weight, ended_at FROM objective_relationships ORDER BY id").all(),
      t.db.prepare("SELECT id, objective_id, assignee_membership_id, assignee_team_id, role, end_date FROM objective_assignments ORDER BY id").all(),
      t.db.prepare("SELECT id, health, health_reason FROM objectives ORDER BY id").all(),
      t.db.prepare("SELECT id, key_result_id, value, source FROM objective_progress_history ORDER BY id").all(),
      t.db.prepare("SELECT id, key, name, description, archived_at FROM kpis ORDER BY id").all(),
      t.db.prepare("SELECT id, name, version, status, is_default FROM scoring_models WHERE organization_id = (SELECT id FROM organizations WHERE name = 'Alpha Co') ORDER BY id").all(),
      t.db.prepare("SELECT id, scoring_model_id, component_key, weight FROM scoring_model_components WHERE organization_id = (SELECT id FROM organizations WHERE name = 'Alpha Co') ORDER BY id").all(),
      t.db.prepare("SELECT id, kpi_id, team_id, membership_id, target_value, weight, effective_to FROM kpi_assignments ORDER BY id").all(),
      t.db.prepare("SELECT id, kpi_id, level, value FROM kpi_thresholds ORDER BY id").all(),
      t.db.prepare("SELECT id, kpi_id, subject_membership_id, period_start, value, supersedes_measurement_id FROM kpi_measurements ORDER BY id").all(),
      t.db.prepare("SELECT COUNT(*) n FROM automation_events").get(),
      t.db.prepare("SELECT name FROM organizations ORDER BY id").all(),
      t.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE organization_id = (SELECT id FROM organizations WHERE name = 'Alpha Co')").get(),
    ]);
    const before = snapshot();

    const idRoutes = t.registry.list().filter((r) => r.takesEntityId);
    expect(idRoutes.length).toBeGreaterThanOrEqual(40);
    for (const route of idRoutes) {
      const fx = fixtures[route.path];
      expect(fx, `add a tenancy fixture for ${route.path}`).toBeTruthy(); // a new id route cannot slip through
      const res = await call(route, ownerB, fx!.params, fx!.body);
      expect(res.status, `${route.method} ${route.path} with A's id as B`).toBe(404);
      expect(JSON.stringify(res.body)).not.toMatch(/Alpha|pending-a|member-a/i);
    }
    // lists: nothing of A's appears
    const lists = t.registry.list().filter((r) => r.method === "get" && !r.path.includes(":") && (r.access.kind === "permission" || ["/api/organization", "/api/auth/me", "/api/my-work", "/api/notifications", "/api/preferences", "/api/daily-updates", "/api/overview"].includes(r.path)));
    expect(lists.length).toBeGreaterThanOrEqual(12);
    for (const route of lists) {
      const res = await call(route, ownerB, {});
      expect(res.status).toBe(200);
      const text = JSON.stringify(res.body);
      for (const secret of ["Alpha Co", "pending-a@example.com", "member-a@example.com", "Member Alpha", "Pending Alpha", "Alpha Engineering", "Alpha Platform", "Alpha Engineers", "Alpha Mentor", "Dana Alpha", "Alpha secret", "owner-a@example.com", modelA, kpiA, kpiAssignmentA, objectiveA, keyResultA, taskA2, parentA, objectiveAssignmentA, invA.invitation.id, personA.membershipId, idsA.employee, deptA, teamA, familyA, designationA, dirA, reportingA, teamRowA, deptRowA, taskA, commentA, assignmentRowA, notificationA]) {
        expect(text, `${route.path} leaked ${secret}`).not.toContain(secret);
      }
    }
    expect(snapshot()).toBe(before); // nothing of A's changed
    // and the same calls as A's own administrator do work (the 404s above were about the organization, not the ids)
    expect((await get(t.app, `/api/roles/${idsA.employee}`, ownerA)).status).toBe(200);
  });
});
