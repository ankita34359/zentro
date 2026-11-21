import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GLOBAL_TABLES, lintTenantSql, tableRefs } from "../backend/src/db/sqlLint.js";
import { migrationsDir } from "./helpers/app.js";

const bad = (sql: string) => expect(lintTenantSql(sql).length, sql).toBeGreaterThan(0);
const good = (sql: string) => expect(lintTenantSql(sql), sql).toEqual([]);

describe("tenant SQL lint", () => {
  it("accepts statements that filter or insert by @organization_id", () => {
    good("SELECT * FROM widgets WHERE organization_id = @organization_id AND id = @id");
    good("SELECT w.* FROM widgets w WHERE w.organization_id = @organization_id");
    good("UPDATE widgets SET name = @name WHERE id = @id AND organization_id = @organization_id");
    good("DELETE FROM widgets WHERE organization_id = @organization_id AND id = @id");
    good("INSERT INTO widgets (id, organization_id, name) VALUES (@id, @organization_id, @name)");
    good("SELECT w.id, u.name FROM widgets w JOIN users u ON u.id = w.owner WHERE w.organization_id = @organization_id");
  });

  it("rejects a read, update or delete with no organization predicate", () => {
    bad("SELECT * FROM widgets WHERE id = @id");
    bad("SELECT * FROM widgets");
    bad("UPDATE widgets SET name = @name WHERE id = @id");
    bad("DELETE FROM widgets WHERE id = @id");
  });

  it("rejects a predicate hidden in a comment or a string literal", () => {
    bad("SELECT * FROM widgets -- WHERE organization_id = @organization_id");
    bad("SELECT * FROM widgets WHERE note = 'organization_id = @organization_id'");
  });

  it("rejects comparing organization_id to anything but the bound placeholder", () => {
    bad("SELECT * FROM widgets WHERE organization_id = 'org-a'");
    bad("SELECT * FROM widgets WHERE organization_id = @org");
  });

  it("rejects an INSERT that leaves out organization_id or does not bind it", () => {
    bad("INSERT INTO widgets (id, name) VALUES (@id, @name)");
    bad("INSERT INTO widgets (id, organization_id, name) VALUES (@id, 'org-a', @name)");
    bad("INSERT INTO widgets VALUES (@id, @organization_id, @name)");
  });

  it("requires the predicate for EVERY organization-owned table in a join", () => {
    bad("SELECT * FROM widgets w JOIN gadgets g ON g.widget_id = w.id WHERE w.organization_id = @organization_id");
    good(
      "SELECT * FROM widgets w JOIN gadgets g ON g.widget_id = w.id WHERE w.organization_id = @organization_id AND g.organization_id = @organization_id",
    );
    // the unqualified form is ambiguous with two organization tables, so it is not accepted
    bad("SELECT * FROM widgets w JOIN gadgets g ON g.widget_id = w.id WHERE organization_id = @organization_id");
  });

  it("checks the tables read by a subquery too", () => {
    bad("SELECT * FROM widgets w WHERE w.organization_id = @organization_id AND w.id IN (SELECT widget_id FROM gadgets)");
  });

  it("ignores global tables", () => {
    good("SELECT * FROM schema_migrations");
    good("SELECT value FROM spike_counters WHERE name = @name");
    good("INSERT INTO scheduled_job_runs (id, job_name, started_at, status) VALUES (@id, @j, @s, 'running')");
  });

  it("finds table names and aliases", () => {
    expect(tableRefs("SELECT * FROM widgets AS w LEFT JOIN gadgets g ON 1 WHERE 1").map((r) => `${r.table}/${r.alias}`)).toEqual([
      "widgets/w",
      "gadgets/g",
    ]);
  });
});

describe("schema lint of the real migrations", () => {
  it("every table is either on the global list or has an organization_id column", () => {
    const offenders: string[] = [];
    for (const f of fs.readdirSync(migrationsDir).filter((n) => n.endsWith(".sql"))) {
      const sql = fs.readFileSync(path.join(migrationsDir, f), "utf8");
      for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?\s*\(([\s\S]*?)\n\)\s*;/gi)) {
        const table = m[1]!.toLowerCase();
        if (GLOBAL_TABLES.has(table)) continue;
        if (!/\borganization_id\b/i.test(m[2]!)) offenders.push(`${f}: ${table}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
