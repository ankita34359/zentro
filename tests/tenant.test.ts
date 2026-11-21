import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../backend/src/db/open.js";
import { createTenantDb, type TenantCtx } from "../backend/src/db/tenant.js";
import { TenantViolationError } from "../backend/src/lib/errors.js";
import { tmpDir } from "./helpers/app.js";
import fs from "node:fs";

let db: Database.Database;
let dir: string;

const ctx = (organizationId: string): TenantCtx => ({ userId: "u", membershipId: "m", organizationId, sessionId: "s", requestId: "r" });

beforeEach(() => {
  dir = tmpDir();
  db = openDatabase(dir).db;
  db.exec(`CREATE TABLE widgets (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL);
           CREATE TABLE gadgets (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, widget_id TEXT NOT NULL);`);
  db.exec(`INSERT INTO widgets VALUES ('w1','org-a','alpha'), ('w2','org-b','beta');
           INSERT INTO gadgets VALUES ('g1','org-a','w1'), ('g2','org-b','w2');`);
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("tenant-scoped repository handle", () => {
  it("binds the organization from the session context", () => {
    const a = createTenantDb(db, ctx("org-a"), { strict: true });
    expect(a.all("SELECT id FROM widgets WHERE organization_id = @organization_id")).toEqual([{ id: "w1" }]);
    expect(a.get("SELECT id FROM widgets WHERE organization_id = @organization_id AND id = @id", { id: "w2" })).toBeUndefined();
  });

  it("another organization's id is simply not found (the route layer turns this into 404)", () => {
    const b = createTenantDb(db, ctx("org-b"), { strict: true });
    expect(b.get("SELECT * FROM widgets WHERE organization_id = @organization_id AND id = @id", { id: "w1" })).toBeUndefined();
  });

  it("writes only touch the caller's organization", () => {
    const b = createTenantDb(db, ctx("org-b"), { strict: true });
    expect(b.run("UPDATE widgets SET name = @n WHERE id = @id AND organization_id = @organization_id", { n: "hacked", id: "w1" }).changes).toBe(0);
    expect(b.run("DELETE FROM widgets WHERE id = @id AND organization_id = @organization_id", { id: "w1" }).changes).toBe(0);
    expect(db.prepare("SELECT name FROM widgets WHERE id = 'w1'").get()).toEqual({ name: "alpha" });
    b.run("INSERT INTO widgets (id, organization_id, name) VALUES (@id, @organization_id, @n)", { id: "w3", n: "new" });
    expect(db.prepare("SELECT organization_id FROM widgets WHERE id = 'w3'").get()).toEqual({ organization_id: "org-b" });
  });

  it("refuses a caller-supplied organization_id parameter", () => {
    const a = createTenantDb(db, ctx("org-a"), { strict: true });
    expect(() => a.all("SELECT * FROM widgets WHERE organization_id = @organization_id", { organization_id: "org-b" })).toThrow(TenantViolationError);
  });

  it("strict mode rejects a statement with no organization predicate, before it runs", () => {
    const a = createTenantDb(db, ctx("org-a"), { strict: true });
    expect(() => a.all("SELECT * FROM widgets")).toThrow(/Tenant lint failed/);
    expect(() => a.run("DELETE FROM widgets WHERE id = @id", { id: "w2" })).toThrow(TenantViolationError);
    expect(db.prepare("SELECT COUNT(*) AS n FROM widgets").get()).toEqual({ n: 2 });
  });

  it("strict mode catches a join that leaks another organization's rows", () => {
    // The text lint is satisfied (widgets is filtered; gadgets is wrongly treated as a global table) but the join
    // drags in a gadget of another organization: the row check is the second net.
    db.exec("INSERT INTO gadgets VALUES ('g3','org-b','w1')");
    const a = createTenantDb(db, ctx("org-a"), { strict: true, globalTables: new Set(["gadgets"]) });
    expect(() =>
      a.all("SELECT g.id, g.organization_id FROM widgets w JOIN gadgets g ON g.widget_id = w.id WHERE w.organization_id = @organization_id"),
    ).toThrow(/another organization/);
  });

  it("non-strict mode (production default) skips the lint and the row check", () => {
    const a = createTenantDb(db, ctx("org-a"), { strict: false });
    expect(a.all("SELECT * FROM widgets")).toHaveLength(2);
  });

  it("needs an organization id", () => {
    expect(() => createTenantDb(db, ctx(""), { strict: true })).toThrow(TenantViolationError);
  });

  it("transaction rolls back as one unit", () => {
    const a = createTenantDb(db, ctx("org-a"), { strict: true });
    expect(() =>
      a.transaction((tx) => {
        tx.run("INSERT INTO widgets (id, organization_id, name) VALUES ('w9', @organization_id, 'x')");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(db.prepare("SELECT COUNT(*) AS n FROM widgets WHERE id = 'w9'").get()).toEqual({ n: 0 });
  });

  it("strict mode is on under the test runner by default", () => {
    const a = createTenantDb(db, ctx("org-a")); // no option: NODE_ENV=test under vitest
    expect(() => a.all("SELECT * FROM widgets")).toThrow(TenantViolationError);
  });
});
