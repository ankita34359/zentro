/** Half-up rounding to one decimal using integer arithmetic on x × 10 with a small guard, so 86.45 → 86.5 on every platform. */
export function roundHalfUp1(x: number): number {
  const n = Math.floor(x * 10 + 0.5 + 1e-9);
  return n / 10;
}
export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export const fmt1 = (x: number): string => roundHalfUp1(x).toFixed(1);
export const fmtW = (x: number): string => (Math.round(x * 100) / 100).toFixed(2);

/** Whole days from `a` to `b` (both YYYY-MM-DD). Pure: no clock. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10))) - Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)))) / 86_400_000);
}
export const num = (config: Record<string, unknown>, key: string, fallback: number): number => (typeof config[key] === "number" && Number.isFinite(config[key] as number) ? (config[key] as number) : fallback);
