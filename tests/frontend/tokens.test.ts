import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { duration, ease, riseDistance, staggerStep } from "@/lib/motion";

const src = path.resolve(import.meta.dirname, "../../frontend/src");
const tokens = fs.readFileSync(path.join(src, "styles/tokens.css"), "utf8");

/** The text of one top-level block such as ":root {" or ".dark {". */
function block(selector: string): string {
  const start = tokens.indexOf(`\n${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = tokens.indexOf("{", start); i < tokens.length; i++) {
    if (tokens[i] === "{") depth++;
    if (tokens[i] === "}" && --depth === 0) return tokens.slice(start, i);
  }
  throw new Error("unterminated block");
}
const names = (b: string) => [...b.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]!);
const value = (b: string, name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(b)?.[1]?.trim();

describe("design tokens (one file decides the look)", () => {
  const light = block(":root");
  const dark = block(".dark");

  it("every themed role defined for light is also defined for dark (and nothing extra)", () => {
    const themed = (b: string) => names(b).filter((n) => !/^--(sidebar-width|header-height|page-max-width|duration-|stagger|ease-|rise-)/.test(n));
    expect(themed(dark).sort()).toEqual(themed(light).sort());
  });

  it("defines the four fixed status colours, each with solid, soft and ink", () => {
    for (const s of ["on-track", "at-risk", "off-track", "info"]) {
      for (const part of ["", "-soft", "-ink"]) {
        expect(value(light, `--${s}${part}`), `light --${s}${part}`).toBeTruthy();
        expect(value(dark, `--${s}${part}`), `dark --${s}${part}`).toBeTruthy();
      }
    }
  });

  it("has a full brand ramp, a slate ramp and one accent", () => {
    for (const n of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) {
      expect(tokens).toContain(`--color-brand-${n}:`);
      expect(tokens).toContain(`--color-slate-${n}:`);
    }
    expect(tokens).toContain("--color-orchid-600:");
  });

  it("defines the type scale, radii, shadows, layout sizes and motion timings", () => {
    for (const t of ["display", "title", "heading", "body", "label", "caption", "overline"]) expect(tokens).toContain(`--text-${t}:`);
    for (const r of ["sm", "md", "lg", "xl", "2xl"]) expect(tokens).toContain(`--radius-${r}:`);
    for (const s of ["xs", "sm", "md", "lg"]) expect(tokens).toContain(`--shadow-${s}:`);
    for (const v of ["--sidebar-width", "--header-height", "--page-max-width"]) expect(tokens).toContain(`${v}:`);
  });

  it("uses a deep navy for dark mode, not black, and an off-white for light mode", () => {
    const lightness = (v: string | undefined) => Number(/oklch\(([\d.]+)/.exec(v ?? "")?.[1]);
    expect(lightness(value(dark, "--background"))).toBeGreaterThan(0.1);
    expect(lightness(value(dark, "--background"))).toBeLessThan(0.25);
    expect(/oklch\([\d.]+ ([\d.]+)/.exec(value(dark, "--background") ?? "")?.[1]).not.toBe("0");
    expect(lightness(value(light, "--background"))).toBeGreaterThan(0.97);
    expect(lightness(value(light, "--background"))).toBeLessThan(1);
  });

  it("keeps the motion timings in lib/motion.ts in step with the CSS tokens", () => {
    const ms = (n: string) => Number(/(\d+)ms/.exec(value(tokens, n) ?? "")?.[1]);
    expect(ms("--duration-fast") / 1000).toBe(duration.fast);
    expect(ms("--duration-base") / 1000).toBe(duration.base);
    expect(ms("--duration-slow") / 1000).toBe(duration.slow);
    expect(ms("--duration-data") / 1000).toBe(duration.data);
    expect(ms("--stagger-step") / 1000).toBe(staggerStep);
    expect(Number(/(\d+)px/.exec(value(tokens, "--rise-distance") ?? "")?.[1])).toBe(riseDistance);
    const bezier = (n: string) => /cubic-bezier\(([^)]+)\)/.exec(value(tokens, n) ?? "")?.[1]?.split(",").map(Number);
    expect(bezier("--ease-out")).toEqual([...ease.out]);
    expect(bezier("--ease-in-out")).toEqual([...ease.inOut]);
  });

  it("interface motion is 150 to 350 ms; only data reveals go longer", () => {
    expect(duration.fast).toBeGreaterThanOrEqual(0.15);
    expect(duration.slow).toBeLessThanOrEqual(0.35);
    expect(duration.data).toBeLessThanOrEqual(0.8);
  });
});

describe("components use tokens, never raw colours", () => {
  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? walk(p) : /\.(ts|tsx|css)$/.test(p) ? [p] : [];
    });
  }
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("no hex, rgb(), hsl() or oklch() literals outside styles/tokens.css", () => {
    const offenders = walk(src)
      .filter((f) => !f.endsWith(path.join("styles", "tokens.css")))
      .filter((f) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/.test(strip(fs.readFileSync(f, "utf8"))))
      .map((f) => path.relative(src, f));
    expect(offenders).toEqual([]);
  });

  it("no hard-coded animation durations in components (use the motion tokens)", () => {
    const offenders = walk(src)
      .filter((f) => /components|pages|layouts|motion/.test(f) && f.endsWith(".tsx"))
      .filter((f) => /duration-\[\d|transition=\{\{[^}]*duration:\s*[\d.]+[,}]/.test(strip(fs.readFileSync(f, "utf8"))))
      .map((f) => path.relative(src, f));
    expect(offenders).toEqual([]);
  });
});
