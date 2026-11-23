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
      "GET /api/audit-logs permission",
      "GET /api/auth/delete-account/preview baseline",
      "GET /api/auth/me baseline",
      "GET /api/cron/tick cron",
      "GET /api/employees permission",
      "GET /api/employees/:id permission",
      "GET /api/employees/:id/history permission",
      "GET /api/hierarchy/reporting permission",
      "GET /api/hierarchy/tree permission",
      "GET /api/invitations permission",
      "GET /api/organization baseline",
      "GET /api/organization/members permission",
      "GET /api/organization/structure permission",
      "GET /api/permissions permission",
      "GET /api/role-assignments permission",
      "GET /api/roles permission",
      "GET /api/roles/:id permission",
      "GET /healthz public",
      "PATCH /api/departments/:id permission",
      "PATCH /api/departments/:id/members/:mid permission",
      "PATCH /api/designations/:id permission",
      "PATCH /api/employees/:id permission",
      "PATCH /api/hierarchy/reporting/:id permission",
      "PATCH /api/organization permission",
      "PATCH /api/role-families/:id permission",
      "PATCH /api/roles/:id permission",
      "PATCH /api/teams/:id permission",
      "PATCH /api/teams/:id/members/:mid permission",
      "POST /api/auth/accept-invitation public",
      "POST /api/auth/change-password baseline",
      "POST /api/auth/delete-account baseline",
      "POST /api/auth/forgot-password public",
      "POST /api/auth/invitation-preview public",
      "POST /api/auth/login public",
      "POST /api/auth/logout public",
      "POST /api/auth/register public",
      "POST /api/auth/reset-password public",
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
      "POST /api/hierarchy/move permission",
      "POST /api/hierarchy/reporting permission",
      "POST /api/invitations permission",
      "POST /api/invitations/:id/regenerate permission",
      "POST /api/invitations/:id/revoke permission",
      "POST /api/organizations baseline",
      "POST /api/people/:membershipId/remove permission",
      "POST /api/people/:membershipId/reset-link permission",
      "POST /api/role-assignments permission",
      "POST /api/role-assignments/:id/revoke permission",
      "POST /api/role-families permission",
      "POST /api/role-families/:id/archive permission",
      "POST /api/role-families/:id/restore permission",
      "POST /api/roles permission",
      "POST /api/roles/:id/archive permission",
      "POST /api/teams permission",
      "POST /api/teams/:id/archive permission",
      "POST /api/teams/:id/members permission",
      "POST /api/teams/:id/restore permission",
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
