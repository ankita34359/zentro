/** WCAG 2.1 contrast helpers. Used by the /design page to show measured ratios for the live theme. */
export type Rgb = [number, number, number];

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

export const luminance = ([r, g, b]: Rgb): number => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

export function contrastRatio(a: Rgb, b: Rgb): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Converts any CSS colour (including oklch) to sRGB with a canvas. Returns null where canvas is unavailable. */
export function cssColorToRgb(css: string): Rgb | null {
  if (typeof document === "undefined") return null;
  const ctx = document.createElement("canvas").getContext?.("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "black";
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0];
}

export const MIN_TEXT_CONTRAST = 4.5;
