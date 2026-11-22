import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { PERMISSIONS, PERMISSION_KEYS } from "../backend/src/modules/permissions/catalog.js";
import { noHierarchy, resolveScope, isEmptyScope, type Grant } from "../backend/src/modules/permissions/resolver.js";
import { ROLE_TEMPLATES } from "../backend/src/modules/permissions/roleTemplates.js";
import type { RouteDef } from "../backend/src/http/registry.js";
import { ORIGIN, type TestApp } from "./helpers/app.js";
import { get, invite, makeAuthApp, signUpWithOrg } from "./helpers/auth.js";
import { addPerson, roleIds } from "./helpers/roles.js";

let t: TestApp;
afterEach(() => t?.cleanup());

const call = (route: RouteDef, cookie: string | undefined, params: Record<string, string>) => {
  const url = route.path.replace(/:(\w+)/g, (_m, name: string) => params[name] ?? randomUUID());
  const r = request(t.app)[route.method](url).set("Origin", ORIGIN);
  if (cookie) r.set("Cookie", cookie);
  return route.method === "get" ? r : r.send({});
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
    for (const tpl of ROLE_TEMPLATES.filter((x) => x.key !== "owner")) people[tpl.key] = (await addPerson(t.app, owner, `${tpl.key}@example.com`, ids[tpl.key], tpl.name)).cookie;

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
    expect(baselineGets).toEqual(["/api/auth/delete-account/preview", "/api/auth/me", "/api/organization"]);
  });

  it("every role can use the baseline routes without any permission", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ids = await roleIds(t.app, owner);
    const baseline = t.registry.list().filter((r) => r.access.kind === "baseline" && r.path !== "/api/organizations");
    expect(baseline.length).toBeGreaterThanOrEqual(4);
    for (const tpl of ROLE_TEMPLATES) {
      const cookie = tpl.key === "owner" ? owner : (await addPerson(t.app, owner, `${tpl.key}@example.com`, ids[tpl.key]!, tpl.name)).cookie;
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
    const fixtures: Record<string, Record<string, string>> = {
      "/api/invitations/:id/revoke": { id: invA.invitation.id },
      "/api/invitations/:id/regenerate": { id: invA.invitation.id },
      "/api/roles/:id": { id: idsA.employee! },
      "/api/people/:membershipId/reset-link": { membershipId: personA.membershipId },
    };
    const snapshot = () => JSON.stringify([
      t.db.prepare("SELECT id, revoked_at, accepted_at, code_hash FROM invitations ORDER BY id").all(),
      t.db.prepare("SELECT id, status, user_id FROM organization_memberships ORDER BY id").all(),
      t.db.prepare("SELECT id, role_id, revoked_at FROM user_role_assignments ORDER BY id").all(),
      t.db.prepare("SELECT COUNT(*) n FROM auth_tokens").get(),
      t.db.prepare("SELECT COUNT(*) n FROM role_permissions").get(),
    ]);
    const before = snapshot();

    const idRoutes = t.registry.list().filter((r) => r.takesEntityId);
    expect(idRoutes.length).toBeGreaterThanOrEqual(4);
    for (const route of idRoutes) {
      const params = fixtures[route.path];
      expect(params, `add a tenancy fixture for ${route.path}`).toBeTruthy(); // a new id route cannot slip through
      const res = await call(route, ownerB, params!);
      expect(res.status, `${route.method} ${route.path} with A's id as B`).toBe(404);
      expect(JSON.stringify(res.body)).not.toMatch(/Alpha|pending-a|member-a/i);
    }
    // lists: nothing of A's appears
    const lists = t.registry.list().filter((r) => r.method === "get" && !r.path.includes(":") && (r.access.kind === "permission" || r.path === "/api/organization" || r.path === "/api/auth/me"));
    expect(lists.length).toBeGreaterThanOrEqual(5);
    for (const route of lists) {
      const res = await call(route, ownerB, {});
      expect(res.status).toBe(200);
      const text = JSON.stringify(res.body);
      for (const secret of ["Alpha Co", "pending-a@example.com", "member-a@example.com", "Member Alpha", "Pending Alpha", "owner-a@example.com", invA.invitation.id, personA.membershipId, idsA.employee]) {
        expect(text, `${route.path} leaked ${secret}`).not.toContain(secret);
      }
    }
    expect(snapshot()).toBe(before); // nothing of A's changed
    // and the same calls as A's own administrator do work (the 404s above were about the organization, not the ids)
    expect((await get(t.app, `/api/roles/${idsA.employee}`, ownerA)).status).toBe(200);
  });
});
