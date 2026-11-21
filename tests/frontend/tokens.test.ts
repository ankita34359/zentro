import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { duration, ease, riseDistance, staggerStep } from "@/lib/motion";

const src = path.resolve(import.meta.dirname, "../../frontend/src");
const tokens = fs.readFileSync(path.join(src, "styles/tokens.css"), "utf8");

/** The text of one top-level block such as ":root,\n.theme-light {" or "@theme {". */
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
  const light = block(":root,\n.theme-light");
  const dark = block(".dark,\n.theme-dark");

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

  const hex = (b: string, name: string) => (value(b, name) ?? "").toLowerCase();
  const luminance = (h: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };

  it("dark mode is a deep rich navy with layered surfaces, never black", () => {
    expect(hex(dark, "--background")).toBe("#070b1a");
    expect(hex(dark, "--card")).toBe("#0e1530");
    expect(hex(dark, "--raised")).toBe("#151d3f");
    // each layer is lighter than the one below it, and none is pure black
    expect(luminance(hex(dark, "--card"))).toBeGreaterThan(luminance(hex(dark, "--background")));
    expect(luminance(hex(dark, "--raised"))).toBeGreaterThan(luminance(hex(dark, "--card")));
    expect(luminance(hex(dark, "--background"))).toBeGreaterThan(0.002);
    expect(value(dark, "--card-highlight")).toMatch(/rgb\(255 255 255 \/ 0\.\d+\)/); // faint top highlight
  });

  it("light mode is crisp white cards on a very light cool lavender-grey page", () => {
    expect(hex(light, "--background")).toBe("#f4f5fb");
    expect(hex(light, "--card")).toBe("#ffffff");
    expect(luminance(hex(light, "--background"))).toBeGreaterThan(0.9);
    expect(luminance(hex(light, "--background"))).toBeLessThan(1);
    expect(hex(light, "--primary")).toBe("#4f46e5"); // vivid indigo, white text on it passes
    expect(value(light, "--shadow-ink")).toContain("79 70 229"); // indigo-tinted shadows
  });

  it("defines the aurora brand gradient at 135 degrees from indigo to violet to orchid", () => {
    for (const b of [light, dark]) {
      expect(hex(b, "--brand-from")).toBe("#4f46e5");
      expect(hex(b, "--brand-via")).toBe("#8b5cf6");
      expect(hex(b, "--brand-to")).toBe("#d946ef");
      expect(value(b, "--gradient-brand")).toMatch(/^linear-gradient\(135deg, var\(--brand-from\)/);
      expect(value(b, "--gradient-brand-strong")).toMatch(/^linear-gradient\(135deg/);
      for (const t of ["--text-from", "--text-via", "--text-to", "--strong-from", "--strong-via", "--strong-to", "--on-gradient"]) expect(value(b, t), t).toBeTruthy();
    }
  });

  it("has the six data-series tokens with the specified hues", () => {
    const want: Record<string, string> = { 1: "#6366f1", 2: "#14b8a6", 3: "#d946ef", 4: "#f59e0b", 5: "#38bdf8", 6: "#84cc16" };
    for (const [n, h] of Object.entries(want)) expect(value(tokens, `--color-series-${n}`)?.toLowerCase()).toBe(h);
  });

  it("status colours are untouched in meaning: emerald, amber, rose, sky hues", () => {
    const hue = (n: string) => Number(/oklch\([\d.]+ [\d.]+ ([\d.]+)\)/.exec(value(light, n) ?? "")?.[1]);
    expect(hue("--on-track")).toBeCloseTo(160, 0);
    expect(hue("--at-risk")).toBeCloseTo(75, 0);
    expect(hue("--off-track")).toBeCloseTo(18, 0);
    expect(hue("--info")).toBeCloseTo(235, 0);
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
