import { afterEach, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import type { TestApp } from "./helpers/app.js";
import { makeAuthApp } from "./helpers/auth.js";

let t: TestApp;
afterEach(() => t?.cleanup());

/** What is wrong (if anything) with one schema node: text without a length limit, a list without a size limit, a free-form object. */
function problems(schema: ZodType, where: string, seen = new Set<unknown>()): string[] {
  if (seen.has(schema)) return [];
  seen.add(schema);
  const def = (schema as unknown as { _zod: { def: Record<string, any> } })._zod.def;
  const type = def.type as string;
  const out: string[] = [];
  const checks = ((def.checks ?? []) as { _zod: { def: { check: string; format?: string } } }[]).map((c) => c._zod.def.check);
  switch (type) {
    case "string": {
      const max = (schema as unknown as { maxLength: number | null }).maxLength;
      const fmt = (schema as unknown as { format?: string | null }).format;
      if (max === null && fmt !== "uuid") out.push(`${where}: text without a maximum length`);
      break;
    }
    case "array":
      if (!checks.includes("max_length")) out.push(`${where}: list without a maximum size`);
      out.push(...problems(def.element, `${where}[]`, seen));
      break;
    case "object":
      for (const [k, v] of Object.entries(def.shape as Record<string, ZodType>)) out.push(...problems(v, `${where}.${k}`, seen));
      break;
    case "optional": case "nullable": case "default": case "readonly": case "catch": case "nonoptional":
      out.push(...problems(def.innerType, where, seen));
      break;
    case "pipe":
      out.push(...problems(def.in, where, seen));
      break;
    case "union":
      for (const o of def.options as ZodType[]) out.push(...problems(o, where, seen));
      break;
    case "record":
      out.push(...problems(def.keyType, `${where}{key}`, seen), ...problems(def.valueType, `${where}{value}`, seen));
      if (def.valueType?._zod?.def?.type === "unknown" || def.valueType?._zod?.def?.type === "any") out.push(`${where}: free-form values`);
      break;
    case "number": {
      const n = schema as unknown as { minValue: number | null; maxValue: number | null };
      if (n.maxValue === null || n.minValue === null || !Number.isFinite(n.maxValue) || !Number.isFinite(n.minValue)) out.push(`${where}: number without a minimum and maximum`);
      break;
    }
    default:
      break; // boolean, enum, literal, date etc. are bounded by nature
  }
  return out;
}

describe("input validation: every route bounds what it accepts", () => {
  it("no body, query or path parameter takes unbounded text, lists or numbers", () => {
    t = makeAuthApp();
    const found: string[] = [];
    for (const r of t.registry.list()) {
      for (const part of ["params", "query", "body"] as const) {
        const s = r.schema?.[part];
        if (s) found.push(...problems(s, `${r.method.toUpperCase()} ${r.path} ${part}`));
      }
    }
    if (process.env.SHOW_VALIDATION) console.log(found.join("\n"));
    expect(found).toEqual([]);
  });
});
