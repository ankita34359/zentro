import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = path.resolve(import.meta.dirname, "../../backend/src/modules/scoring/engine");
const files = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(d, e.name)) : e.name.endsWith(".ts") ? [path.join(d, e.name)] : []));

describe("the scoring engine stays pure (docs/scoring-architecture.md section 1)", () => {
  const sources = files(dir).map((f) => ({ f: path.relative(dir, f), src: fs.readFileSync(f, "utf8") }));
  it("imports only its own files and the two pure maths files it is allowed to read", () => {
    const allowed = [/^\.\.?\//, /okr\/attainment\.js$/, /kpi\/measure\.js$/];
    for (const { f, src } of sources) {
      for (const m of src.matchAll(/from\s+"([^"]+)"/g)) {
        const spec = m[1]!;
        const own = /^\.\.?\//.test(spec) && !/\.\.\/\.\.\/\.\.\//.test(spec.replace(/okr\/attainment\.js|kpi\/measure\.js/, ""));
        expect(own || allowed.some((a) => a.test(spec)), `${f} imports ${spec}`).toBe(true);
        expect(spec, `${f}`).not.toMatch(/db|repositor|node:|express|better-sqlite3|zod/);
      }
    }
  });
  it("never reads the clock, randomness, the network, the environment or an AI", () => {
    for (const { f, src } of sources) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const banned of [/Date\.now\(/, /new Date\(\s*\)/, /Math\.random\(/, /\bfetch\(/, /process\.env/, /\brequire\(/, /crypto/, /setTimeout/, /performance\.now/]) expect(code, `${f} uses ${banned}`).not.toMatch(banned);
    }
  });
  it("the two maths files it reads are themselves pure", () => {
    for (const rel of ["../../backend/src/modules/okr/attainment.ts", "../../backend/src/modules/kpi/measure.ts"]) {
      const src = fs.readFileSync(path.resolve(import.meta.dirname, rel), "utf8");
      expect(src).not.toMatch(/^import /m);
    }
  });
});
