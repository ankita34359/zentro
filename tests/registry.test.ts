import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { assertAllRegistered, expressRoutes, RouteRegistry, type RouteDef } from "../backend/src/http/registry.js";
import { sendData } from "../backend/src/http/envelope.js";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
afterEach(() => t?.cleanup());

const base: Omit<RouteDef, "access"> = { method: "get", path: "/api/x", summary: "s", handler: () => undefined };

describe("route registry: every route declares its protection", () => {
  it("refuses a route with no access marker", () => {
    const r = new RouteRegistry();
    expect(() => r.add(base as RouteDef)).toThrow(/must declare its access/);
  });

  it("refuses a malformed permission key, a public route without a reason, and duplicates", () => {
    const r = new RouteRegistry();
    expect(() => r.add({ ...base, access: { kind: "permission", key: "OKR Edit" } })).toThrow(/malformed permission key/);
    expect(() => r.add({ ...base, access: { kind: "public", why: "" } })).toThrow(/must say why/);
    r.add({ ...base, access: { kind: "permission", key: "okr.edit" } });
    expect(() => r.add({ ...base, access: { kind: "baseline" } })).toThrow(/registered twice/);
  });

  it("fails the boot check when a route is mounted on Express without the registry", () => {
    const app = express();
    const r = new RouteRegistry();
    r.add({ ...base, access: { kind: "baseline" } });
    r.mount(app, { authenticate: () => undefined, authorize: () => undefined, cronSecret: undefined });
    expect(() => assertAllRegistered(app, r)).not.toThrow();
    app.get("/sneaky", (_q, s) => void s.send("x"));
    expect(expressRoutes(app)).toContain("GET /sneaky");
    expect(() => assertAllRegistered(app, r)).toThrow(/Routes mounted without the registry: GET \/sneaky/);
  });

  it("createApp itself rejects stray routes (the real app passes the check at boot)", () => {
    t = makeTestApp();
    expect(() => assertAllRegistered(t.app, t.registry)).not.toThrow();
    expect(expressRoutes(t.app).sort()).toEqual(
      t.registry.list().map((r) => `${r.method.toUpperCase()} ${r.path}`).sort(),
    );
  });

  it("lists the registered routes with their markers (basis for the generated matrices in 2.3)", () => {
    t = makeTestApp();
    const rows = t.registry.list().map((r) => `${r.method.toUpperCase()} ${r.path} ${r.access.kind}`).sort();
    expect(rows).toEqual([
      "DELETE /api/integrations/endpoints/:id permission",
      "DELETE /api/kpis/:id/assignments/:aid permission",
      "DELETE /api/objectives/:id permission",
      "DELETE /api/objectives/:id/assignments/:aid permission",
      "DELETE /api/objectives/:id/parent permission",
      "DELETE /api/tasks/:id/comments/:cid permission",
      "DELETE /api/tasks/:id/dependencies/:depId permission",
      "GET /api/ai/insights permission",
      "GET /api/ai/status baseline",
      "GET /api/audit-logs permission",
      "GET /api/auth/delete-account/preview baseline",
      "GET /api/auth/me baseline",
      "GET /api/cron/tick cron",
      "GET /api/daily-updates baseline",
      "GET /api/demo/personas permission",
      "GET /api/demo/status permission",
      "GET /api/employees permission",
      "GET /api/employees/:id permission",
      "GET /api/employees/:id/history permission",
      "GET /api/evidence permission",
      "GET /api/evidence/:id permission",
      "GET /api/evidence/:id/file permission",
      "GET /api/export permission",
      "GET /api/hierarchy/reporting permission",
      "GET /api/hierarchy/tree permission",
      "GET /api/integrations/deliveries permission",
      "GET /api/integrations/endpoints permission",
      "GET /api/integrations/status permission",
      "GET /api/integrations/webhooks permission",
      "GET /api/invitations permission",
      "GET /api/kpis permission",
      "GET /api/kpis/:id permission",
      "GET /api/kpis/:id/history permission",
      "GET /api/kpis/:id/subjects permission",
      "GET /api/kpis/:id/thresholds permission",
      "GET /api/kpis/overview permission",
      "GET /api/leadership/overview permission",
      "GET /api/mentorship/assignments permission",
      "GET /api/mentorship/assignments/:id permission",
      "GET /api/mentorship/assignments/:id/activities permission",
      "GET /api/mentorship/assignments/:id/progress permission",
      "GET /api/mentorship/effectiveness permission",
      "GET /api/my-work baseline",
      "GET /api/notifications baseline",
      "GET /api/objectives permission",
      "GET /api/objectives/:id permission",
      "GET /api/objectives/:id/alignment permission",
      "GET /api/objectives/:id/history permission",
      "GET /api/objectives/alignment-gaps permission",
      "GET /api/objectives/linkable permission",
      "GET /api/objectives/tree permission",
      "GET /api/organization baseline",
      "GET /api/organization/members permission",
      "GET /api/organization/structure permission",
      "GET /api/overview baseline",
      "GET /api/performance/compare baseline",
      "GET /api/performance/compare/difference permission",
      "GET /api/performance/comparisons permission",
      "GET /api/performance/comparisons/:id permission",
      "GET /api/performance/models permission",
      "GET /api/performance/models/:id permission",
      "GET /api/performance/models/templates permission",
      "GET /api/performance/periods baseline",
      "GET /api/performance/reviews baseline",
      "GET /api/performance/scorecards baseline",
      "GET /api/performance/scorecards/:id baseline",
      "GET /api/performance/scorecards/for baseline",
      "GET /api/performance/scores/:id baseline",
      "GET /api/performance/trends baseline",
      "GET /api/permissions permission",
      "GET /api/preferences baseline",
      "GET /api/role-assignments permission",
      "GET /api/roles permission",
      "GET /api/roles/:id permission",
      "GET /api/tasks permission",
      "GET /api/tasks/:id permission",
      "GET /api/tasks/:id/comments permission",
      "GET /api/tasks/:id/updates permission",
      "GET /api/system permission",
      "GET /api/team-performance baseline",
      "GET /healthz public",
      "PATCH /api/departments/:id permission",
      "PATCH /api/departments/:id/members/:mid permission",
      "PATCH /api/designations/:id permission",
      "PATCH /api/employees/:id permission",
      "PATCH /api/hierarchy/reporting/:id permission",
      "PATCH /api/key-results/:id permission",
      "PATCH /api/kpis/:id permission",
      "PATCH /api/kpis/:id/assignments/:aid permission",
      "PATCH /api/mentorship/assignments/:id permission",
      "PATCH /api/objectives/:id permission",
      "PATCH /api/organization permission",
      "PATCH /api/performance/models/:id permission",
      "PATCH /api/performance/periods/:id permission",
      "PATCH /api/performance/reviews/:id permission",
      "PATCH /api/role-families/:id permission",
      "PATCH /api/roles/:id permission",
      "PATCH /api/tasks/:id permission",
      "PATCH /api/tasks/:id/comments/:cid permission",
      "PATCH /api/teams/:id permission",
      "PATCH /api/teams/:id/members/:mid permission",
      "POST /api/ai/ask permission",
      "POST /api/auth/accept-invitation public",
      "POST /api/auth/change-password baseline",
      "POST /api/auth/delete-account baseline",
      "POST /api/auth/forgot-password public",
      "POST /api/auth/invitation-preview public",
      "POST /api/auth/login public",
      "POST /api/auth/logout public",
      "POST /api/auth/register public",
      "POST /api/auth/reset-password public",
      "POST /api/daily-updates baseline",
      "POST /api/demo/load permission",
      "POST /api/demo/remove permission",
      "POST /api/demo/stop-viewing baseline",
      "POST /api/demo/view-as/:membershipId permission",
      "POST /api/departments permission",
      "POST /api/departments/:id/archive permission",
      "POST /api/departments/:id/members permission",
      "POST /api/departments/:id/restore permission",
      "POST /api/designations permission",
      "POST /api/designations/:id/archive permission",
      "POST /api/designations/:id/restore permission",
      "POST /api/employees permission",
      "POST /api/employees/:id/archive permission",
      "POST /api/employees/:id/designation permission",
      "POST /api/employees/:id/restore permission",
      "POST /api/evidence permission",
      "POST /api/evidence/:id/file permission",
      "POST /api/evidence/:id/links permission",
      "POST /api/evidence/:id/verify permission",
      "POST /api/evidence/:id/withdraw permission",
      "POST /api/export permission",
      "POST /api/hierarchy/move permission",
      "POST /api/hierarchy/reporting permission",
      "POST /api/inbound/:id public",
      "POST /api/integrations/endpoints permission",
      "POST /api/integrations/webhooks/rotate-secret permission",
      "POST /api/integrations/webhooks/test permission",
      "POST /api/invitations permission",
      "POST /api/invitations/:id/regenerate permission",
      "POST /api/invitations/:id/revoke permission",
      "POST /api/key-results/:id/progress permission",
      "POST /api/kpis permission",
      "POST /api/kpis/:id/archive permission",
      "POST /api/kpis/:id/assignments permission",
      "POST /api/kpis/:id/measurements permission",
      "POST /api/mentorship/assignments permission",
      "POST /api/mentorship/assignments/:id/activities permission",
      "POST /api/mentorship/assignments/:id/progress permission",
      "POST /api/notifications/:id/read baseline",
      "POST /api/notifications/read-all baseline",
      "POST /api/objectives permission",
      "POST /api/objectives/:id/assignments permission",
      "POST /api/objectives/:id/key-results permission",
      "POST /api/objectives/:id/publish permission",
      "POST /api/organizations baseline",
      "POST /api/people/:membershipId/remove permission",
      "POST /api/people/:membershipId/reset-link permission",
      "POST /api/performance/comparisons permission",
      "POST /api/performance/models permission",
      "POST /api/performance/models/:id/activate permission",
      "POST /api/performance/models/preview permission",
      "POST /api/performance/periods permission",
      "POST /api/performance/periods/:id/close permission",
      "POST /api/performance/periods/:id/lock permission",
      "POST /api/performance/periods/:id/reopen permission",
      "POST /api/performance/reviews permission",
      "POST /api/performance/reviews/:id/acknowledge baseline",
      "POST /api/performance/scorecards/recalculate permission",
      "POST /api/performance/scores/:id/verify baseline",
      "POST /api/role-assignments permission",
      "POST /api/role-assignments/:id/revoke permission",
      "POST /api/role-families permission",
      "POST /api/role-families/:id/archive permission",
      "POST /api/role-families/:id/restore permission",
      "POST /api/roles permission",
      "POST /api/roles/:id/archive permission",
      "POST /api/tasks permission",
      "POST /api/tasks/:id/assignments permission",
      "POST /api/tasks/:id/assignments/:aid/end permission",
      "POST /api/tasks/:id/comments permission",
      "POST /api/tasks/:id/dependencies permission",
      "POST /api/tasks/:id/outcome permission",
      "POST /api/tasks/:id/review permission",
      "POST /api/tasks/:id/updates permission",
      "POST /api/teams permission",
      "POST /api/teams/:id/archive permission",
      "POST /api/teams/:id/members permission",
      "POST /api/teams/:id/restore permission",
      "PUT /api/ai/settings permission",
      "PUT /api/integrations/webhooks permission",
      "PUT /api/kpis/:id/thresholds permission",
      "PUT /api/objectives/:id/parent permission",
      "PUT /api/preferences baseline",
      "PUT /api/roles/:id/permissions permission",
    ].sort());
  });
});

describe("route guards fail closed until sessions exist", () => {
  const routes = (r: RouteRegistry) => {
    r.add({ method: "get", path: "/api/_t/me", access: { kind: "baseline" }, summary: "t", handler: (_q, s) => sendData(s, { me: true }) });
    r.add({ method: "get", path: "/api/_t/okr", access: { kind: "permission", key: "okr.view" }, summary: "t", handler: (_q, s) => sendData(s, 1) });
  };

  it("answers 401 for baseline and permission routes with the default guards", async () => {
    t = makeTestApp({ extraRoutes: routes });
    for (const p of ["/api/_t/me", "/api/_t/okr"]) {
      const res = await request(t.app).get(p);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("unauthenticated");
    }
  });

  it("runs authenticate then authorize with the declared key, and validation only after both pass", async () => {
    const calls: string[] = [];
    t = makeTestApp({
      extraRoutes: (r) =>
        r.add({
          method: "get",
          path: "/api/_t/q",
          access: { kind: "permission", key: "kpi.edit" },
          summary: "t",
          schema: { query: z.object({ n: z.coerce.number().int().min(1) }).strict() },
          handler: (_q, s, v) => sendData(s, v.query),
        }),
      guards: {
        cronSecret: undefined,
        authenticate: () => void calls.push("authn"),
        authorize: (_q, _s, key) => void calls.push(`authz:${key}`),
      },
    });
    expect((await request(t.app).get("/api/_t/q?n=0")).status).toBe(400);
    expect(calls).toEqual(["authn", "authz:kpi.edit"]);
    const ok = await request(t.app).get("/api/_t/q?n=3");
    expect(ok.body.data).toEqual({ n: 3 });
  });
});
