/**
 * Tenant lint for repository SQL. A statement that touches an organization-owned table must filter or insert by
 * the placeholder @organization_id (the wrapper binds it from the signed-in session, never from the request).
 *
 * This is a deliberately simple text check, not a SQL parser. It finds table references after FROM / JOIN /
 * UPDATE / INTO and requires, for each organization-owned table, a predicate `<alias or table>.organization_id =
 * @organization_id` (or the unqualified form when only one organization-owned table is involved). Known limits:
 * it does not understand every SQL construct, so it errs toward REJECTING; strict mode (tenant.ts) is the second net.
 */

/** Tables that are NOT owned by one organization. Anything else is treated as organization-owned. */
export const GLOBAL_TABLES: ReadonlySet<string> = new Set([
  "schema_migrations",
  "spike_counters", // stage 1.1 table, unused since 1.3; dropped by a later migration (kept one release so a rollback still works)
  "scheduled_job_runs", // organization_id is optional (NULL for platform jobs); operational log, not tenant data
  "permissions",
  "users",
  "sessions",
  "auth_tokens",
  "organizations",
]);

export interface TableRef {
  table: string;
  alias: string;
}

const KEYWORDS = new Set([
  "where", "on", "using", "group", "order", "limit", "having", "set", "values", "select", "left", "right",
  "inner", "outer", "cross", "join", "union", "returning", "natural", "window", "offset",
]);

function stripNoise(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''") // string literals can hide words like "from"
    .replace(/\s+/g, " ")
    .trim();
}

export function tableRefs(sql: string): TableRef[] {
  const s = stripNoise(sql);
  const refs: TableRef[] = [];
  const re = /\b(?:from|join|update|into)\s+("?[a-z_][a-z0-9_]*"?)(?:\s+(?:as\s+)?("?[a-z_][a-z0-9_]*"?))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const table = m[1]!.replace(/"/g, "").toLowerCase();
    let alias = (m[2] ?? "").replace(/"/g, "").toLowerCase();
    if (!alias || KEYWORDS.has(alias)) alias = table;
    refs.push({ table, alias });
  }
  return refs;
}

export function lintTenantSql(sql: string, globalTables: ReadonlySet<string> = GLOBAL_TABLES): string[] {
  const problems: string[] = [];
  const s = stripNoise(sql);
  const refs = tableRefs(sql).filter((r) => !globalTables.has(r.table));
  if (refs.length === 0) return problems;

  if (/\borganization_id\s*=\s*(?!@organization_id\b)/i.test(s) && !/@organization_id\b/.test(s)) {
    problems.push("organization_id must be compared to @organization_id (bound from the session), not to another value");
  }

  const isInsert = /^\s*insert\b/i.test(s);
  if (isInsert) {
    const m = /^insert\s+(?:or\s+\w+\s+)?into\s+"?([a-z_][a-z0-9_]*)"?\s*\(([^)]*)\)/i.exec(s);
    if (m && !globalTables.has(m[1]!.toLowerCase())) {
      const cols = m[2]!.split(",").map((c) => c.trim().toLowerCase());
      if (!cols.includes("organization_id")) problems.push(`INSERT into ${m[1]} must set organization_id`);
      if (!/@organization_id\b/.test(s)) problems.push(`INSERT into ${m[1]} must bind @organization_id`);
    } else if (!m) {
      problems.push("INSERT into an organization-owned table must list its columns, including organization_id");
    }
    // INSERT ... SELECT: tables read by the SELECT part must be filtered as well.
    const selectAt = s.search(/\bselect\b/i);
    if (selectAt > 0) problems.push(...selectChecks(s.slice(selectAt), refs.filter((r) => r.table !== (m?.[1] ?? "").toLowerCase())));
    return problems;
  }
  problems.push(...selectChecks(s, refs));
  return problems;
}

function selectChecks(s: string, refs: TableRef[]): string[] {
  const problems: string[] = [];
  for (const r of refs) {
    const qualified = new RegExp(`\\b(?:${r.alias}|${r.table})\\.organization_id\\s*=\\s*@organization_id\\b`, "i");
    const unqualified = /(?<![.\w])organization_id\s*=\s*@organization_id\b/i;
    const ok = qualified.test(s) || (refs.length === 1 && unqualified.test(s));
    if (!ok) problems.push(`${r.table}: missing "organization_id = @organization_id"`);
  }
  return problems;
}
