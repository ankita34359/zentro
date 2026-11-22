import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FAKE_ENV, type TestApp } from "./helpers/app.js";
import { get, invite, makeAuthApp, PASSWORD, post, send, signUpWithOrg, TEST_CODE } from "./helpers/auth.js";
import { addPerson, roleIds } from "./helpers/roles.js";

let t: TestApp;
afterEach(() => t?.cleanup());
const all = <T>(sql: string, ...p: unknown[]) => t.db.prepare(sql).all(...p) as T[];
const one = <T>(sql: string, ...p: unknown[]) => t.db.prepare(sql).get(...p) as T;
const log = async (cookie: string, query = "") => get(t.app, `/api/audit-logs${query}`, cookie);

describe("the audit log", () => {
  it("records every change this stage and the earlier admin actions made, in order, with the actor, in plain words", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ids = await roleIds(t.app, owner);
    const inv = await invite(t.app, owner, "sam@example.com", "Sam");
    await post(t.app, `/api/invitations/${inv.invitation.id}/regenerate`, undefined, owner);
    const sam = await addPerson(t.app, owner, "sam2@example.com", ids.employee, "Sam Two");
    await post(t.app, `/api/people/${sam.membershipId}/reset-link`, undefined, owner);
    const role = (await post(t.app, "/api/roles", { name: "Program Director" }, owner)).body.data.id as string;
    await send(t.app, "put", `/api/roles/${role}/permissions`, { grants: [{ permission: "okr.view", mode: "own" }] }, owner);
    await post(t.app, "/api/role-assignments", { membershipId: sam.membershipId, roleId: role }, owner);
    await post(t.app, `/api/invitations/${inv.invitation.id}/revoke`, undefined, owner).catch(() => undefined);

    const res = await log(owner, "?limit=100");
    expect(res.status).toBe(200);
    const entries = res.body.data as { action: string; summary: string; actor: { name: string }; createdAt: string }[];
    const actions = entries.map((e) => e.action).reverse(); // oldest first
    expect(actions).toEqual(expect.arrayContaining(["organization.create", "invitation.create", "invitation.regenerate", "invitation.accept", "password_reset_link.create", "role.create", "role.permissions.update", "role_assignment.create"]));
    expect(actions[0]).toBe("organization.create");
    expect(entries.every((e) => e.actor.name !== undefined)).toBe(true);
    expect(entries.find((e) => e.action === "role_assignment.create")!.summary).toBe('Gave Sam Two the role "Program Director"');
    expect([...entries].map((e) => e.createdAt)).toEqual([...entries].map((e) => e.createdAt).sort().reverse()); // newest first
  });

  it("is written in the SAME transaction as the change: a refused or failed change leaves no row, a successful one always has one", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const before = one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs").n;
    expect((await post(t.app, "/api/roles", { name: "x" }, owner)).status).toBe(400); // refused by validation
    expect((await post(t.app, "/api/roles", { name: "Okay", copyFromRoleId: "11111111-1111-4111-8111-111111111111" }, owner)).status).toBe(404);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs").n).toBe(before);
    // force the audit insert itself to fail: the change must roll back with it
    t.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit down'); END;");
    const failed = await post(t.app, "/api/roles", { name: "Cannot Be Created" }, owner);
    expect(failed.status).toBe(500);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM roles WHERE name = 'Cannot Be Created'").n).toBe(0); // no change without its audit row
    t.db.exec("DROP TRIGGER fail_audit");
    expect((await post(t.app, "/api/roles", { name: "Can Be Created" }, owner)).status).toBe(201);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs").n).toBe(before + 1);
  });

  it("is append-only: no code path updates or deletes audit rows (the only deletion is an organization leaving with its last member)", () => {
    const src = path.resolve(import.meta.dirname, "../backend/src");
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".ts") ? [path.join(d, e.name)] : []));
    const offenders = walk(src).filter((f) => /\b(update|delete\s+from)\s+audit_logs\b/i.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(src, f));
    expect(offenders).toEqual(["modules/auth/repositories/erasure.ts"]);
  });

  it("holds no secret, link, code, token or password, and no IP address column exists", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ids = await roleIds(t.app, owner);
    const inv = await invite(t.app, owner, "sam@example.com", "Sam");
    const sam = await addPerson(t.app, owner, "sam2@example.com", ids.employee, "Sam Two");
    const reset = await post(t.app, `/api/people/${sam.membershipId}/reset-link`, undefined, owner);
    const dump = JSON.stringify(all("SELECT * FROM audit_logs"));
    for (const secret of [inv.code, inv.code.split(".")[1]!, reset.body.data.token, PASSWORD, TEST_CODE, FAKE_ENV.SESSION_SECRET, "/accept-invite", "/reset-password", "#code=", "#token="]) expect(dump).not.toContain(secret);
    const columns = all<{ name: string }>("PRAGMA table_info(audit_logs)").map((c) => c.name);
    expect(columns.some((c) => /(^|_)(ip|address|agent)($|_)/i.test(c))).toBe(false);
    expect(columns).toEqual(["id", "organization_id", "actor_user_id", "actor_membership_id", "actor_type", "action", "entity_type", "entity_id", "summary", "before_json", "after_json", "request_id", "created_at"]);
  });

  it("is readable only with audit.view (the Owner), filters by action, entity, actor and dates, and pages with a cursor", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ids = await roleIds(t.app, owner);
    const ceo = await addPerson(t.app, owner, "ceo@example.com", ids.ceo, "Chief");
    for (const n of ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"]) await post(t.app, "/api/roles", { name: `Role ${n}` }, owner);
    expect((await log(ceo.cookie)).status).toBe(403); // the CEO template does not include audit.view
    expect((await get(t.app, "/api/audit-logs")).status).toBe(401);
    const created = (await log(owner, "?action=role.create&limit=100")).body.data as { summary: string }[];
    expect(created).toHaveLength(5);
    const byEntity = (await log(owner, `?entityType=role&limit=100`)).body.data as { entityType: string }[];
    expect(byEntity.every((e) => e.entityType === "role")).toBe(true);
    const ownerM = one<{ id: string }>("SELECT id FROM organization_memberships WHERE work_email = 'owner@example.com'").id;
    expect(((await log(owner, `?actorId=${ownerM}&limit=100`)).body.data as unknown[]).length).toBeGreaterThan(5);
    expect(((await log(owner, `?actorId=${ceo.membershipId}&limit=100`)).body.data as unknown[]).length).toBe(1); // the CEO's own invitation acceptance
    expect(((await log(owner, `?to=${encodeURIComponent("2000-01-01T00:00:00.000Z")}`)).body.data as unknown[]).length).toBe(0);
    // paging: two at a time, no row twice, none missing
    const seen: string[] = [];
    let cursor = "";
    for (let i = 0; i < 20; i++) {
      const page = await log(owner, `?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      for (const e of page.body.data as { id: string }[]) seen.push(e.id);
      const next = page.body.meta.page.nextCursor as string | null;
      if (!next) break;
      cursor = next;
    }
    const everything = (await log(owner, "?limit=100")).body.data as { id: string }[];
    expect(seen).toEqual(everything.map((e) => e.id));
    expect(new Set(seen).size).toBe(seen.length);
    expect((await log(owner, "?limit=0")).status).toBe(400);
    expect((await log(owner, "?from=yesterday")).status).toBe(400);
  });

  it("each organization sees only its own audit log (cross-tenant)", async () => {
    t = makeAuthApp();
    const a = await signUpWithOrg(t.app, "a@example.com", "Alpha Co");
    const b = await signUpWithOrg(t.app, "b@example.com", "Beta Co");
    await post(t.app, "/api/roles", { name: "Alpha Secret Role" }, a);
    await post(t.app, "/api/roles", { name: "Beta Role" }, b);
    const seenByB = JSON.stringify((await log(b, "?limit=100")).body);
    expect(seenByB).toContain("Beta Role");
    expect(seenByB).not.toMatch(/Alpha/);
    const seenByA = JSON.stringify((await log(a, "?limit=100")).body);
    expect(seenByA).toContain("Alpha Secret Role");
    expect(seenByA).not.toMatch(/Beta/);
    // an actor id from the other organization finds nothing
    const bM = one<{ id: string }>("SELECT id FROM organization_memberships WHERE work_email = 'b@example.com'").id;
    expect(((await log(a, `?actorId=${bM}`)).body.data as unknown[]).length).toBe(0);
  });

  it("when a person who made changes deletes their account the entries stay (attributed to 'Former member'); when the whole organization is deleted its log goes with it", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ids = await roleIds(t.app, owner);
    const second = await addPerson(t.app, owner, "second@example.com", ids.owner, "Second");
    await post(t.app, "/api/roles", { name: "Made By Second" }, second.cookie);
    const del = await post(t.app, "/api/auth/delete-account", { password: PASSWORD, confirmEmail: "second@example.com" }, second.cookie);
    expect(del.status).toBe(200);
    const entries = (await log(owner, "?action=role.create&limit=100")).body.data as { summary: string; actor: { name: string } }[];
    expect(entries.find((e) => e.summary.includes("Made By Second"))!.actor.name).toBe("Former member");
    const leave = (await log(owner, "?action=person.leave")).body.data as unknown[];
    expect(leave).toHaveLength(1);
    // the owner is now the only member: deleting the account deletes the organization and its audit log
    const ok = await post(t.app, "/api/auth/delete-account", { password: PASSWORD, confirmEmail: "owner@example.com", confirmOrganizationName: "Acme" }, owner);
    expect(ok.status).toBe(200);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs").n).toBe(0);
  });
});
