/** Canonical JSON: keys sorted, numbers to at most 12 significant digits, so the same facts always give the same text (and the same hash). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canon(value));
}
function canon(v: unknown): unknown {
  if (typeof v === "number") return Number.isFinite(v) ? Number(v.toPrecision(12)) : null;
  if (Array.isArray(v)) return v.map(canon);
  if (v !== null && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) o[k] = canon(x);
    }
    return o;
  }
  return v;
}
