import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintTenantSql } from "../backend/src/db/sqlLint.js";

const src = path.resolve(import.meta.dirname, "../backend/src");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}
const rel = (p: string) => path.relative(src, p).split(path.sep).join("/");
/** SQL may live in the platform data layer (db/) and in module repositories only. */
const allowed = (r: string) => r.startsWith("db/") || /(^|\/)repositories\//.test(r);

describe("SQL lives only in repositories", () => {
  it("no .prepare( or db.exec( outside db/ and modules/*/repositories/", () => {
    const offenders = walk(src)
      .map(rel)
      .filter((r) => !allowed(r))
      .filter((r) => /\.prepare\(|\bdb\.exec\(/.test(fs.readFileSync(path.join(src, r), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("modules do not import better-sqlite3 directly", () => {
    const offenders = walk(src)
      .map(rel)
      .filter((r) => r.startsWith("modules/") && !/\/repositories\//.test(r))
      .filter((r) => /better-sqlite3/.test(fs.readFileSync(path.join(src, r), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("every SQL string in module repositories passes the tenant lint", () => {
    const problems: string[] = [];
    for (const file of walk(src).map(rel).filter((r) => /(^|\/)repositories\//.test(r))) {
      const text = fs.readFileSync(path.join(src, file), "utf8");
      for (const m of text.matchAll(/`([^`]*)`|"((?:select|insert|update|delete)\b[^"]*)"/gi)) {
        const sql = m[1] ?? m[2] ?? "";
        if (!/^\s*(select|insert|update|delete)\b/i.test(sql)) continue;
        for (const p of lintTenantSql(sql)) problems.push(`${file}: ${p}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
