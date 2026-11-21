import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = path.resolve(import.meta.dirname, "../../frontend/src");
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const files = walk(src).map((f) => ({
  rel: path.relative(src, f).split(path.sep).join("/"),
  text: stripComments(fs.readFileSync(f, "utf8")),
}));

describe("frontend safety rules (docs/frontend-structure.md section 7)", () => {
  it("never uses dangerouslySetInnerHTML", () => {
    expect(files.filter((f) => f.text.includes("dangerouslySetInnerHTML")).map((f) => f.rel)).toEqual([]);
  });

  it("touches browser storage only through lib/safeStorage.ts", () => {
    expect(files.filter((f) => f.rel !== "lib/safeStorage.ts" && /localStorage|sessionStorage/.test(f.text)).map((f) => f.rel)).toEqual([]);
  });

  it("does not read VITE_* variables (they cannot reach the Embarko build)", () => {
    expect(files.filter((f) => /import\.meta\.env\.VITE_|VITE_[A-Z]/.test(f.text)).map((f) => f.rel)).toEqual([]);
  });

  it("keeps secrets-looking words out of public.ts", () => {
    const pub = files.find((f) => f.rel === "config/public.ts")!;
    expect(pub.text).not.toMatch(/secret|token|password|apikey|api_key/i);
  });
});
