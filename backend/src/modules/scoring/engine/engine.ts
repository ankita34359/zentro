import { clamp, fmt1, fmtW, roundHalfUp1 } from "./math.js";
import { PROVIDERS } from "./registry.js";
import type { ComponentResult, DataState, Explanation, ModelComponent, ModelDef, ProviderResult, ScoreInputs, ScoreResult, Status } from "./types.js";

export const ENGINE_VERSION = "1";

const STATE_TEXT = (state: DataState, c: { sampleSize: number; minSample: number }): string => (state === "ok" ? "Enough data" : state === "insufficient" ? `Not enough data (${c.sampleSize} of ${c.minSample} needed)` : "No data recorded");

function run(inputs: ScoreInputs, c: ModelComponent): ProviderResult {
  const o = inputs.overrides?.[c.key];
  if (o) {
    const state: DataState = o.state ?? (o.value === null ? "missing" : "ok");
    return { value: o.value === null ? null : clamp(o.value, 0, 100), state, sampleSize: o.sampleSize ?? (state === "ok" ? Math.max(1, c.minSample) * 2 : 0), coverage: o.coverage ?? (state === "ok" ? 1 : 0), evidenceShare: 0, contributors: [], notes: ["Entered directly (what-if)"] };
  }
  const p = PROVIDERS[c.providerKey];
  if (!p) return { value: null, state: "missing", sampleSize: 0, coverage: 0, evidenceShare: 0, contributors: [], notes: [`The provider "${c.providerKey}" is not available`] };
  return p(inputs, c);
}

/**
 * computeScore: a PURE function of the snapshot and the model (docs/scoring-architecture.md sections 5 and 6). No database, no
 * clock, no randomness, no network, no AI. Components that are `ok` are renormalized so their weights sum to 1; those that are
 * `insufficient` or `missing` are left out and listed. A recorded zero is a real zero; no record is not zero.
 */
export function computeScore(inputs: ScoreInputs, model: ModelDef): ScoreResult {
  const comps = [...model.components].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
  const totalWeight = comps.reduce((n, c) => n + c.weight, 0);
  const provided = comps.map((c) => ({ c, r: run(inputs, c) }));
  const ok = provided.filter(({ r }) => r.state === "ok" && r.value !== null);
  const okWeight = ok.reduce((n, { c }) => n + c.weight, 0);
  const weightCoverage = totalWeight > 0 ? okWeight / totalWeight : 0;

  const results: ComponentResult[] = provided.map(({ c, r }) => {
    const isOk = r.state === "ok" && r.value !== null;
    const effective = isOk && okWeight > 0 ? c.weight / okWeight : 0;
    return {
      key: c.key, label: c.label, providerKey: c.providerKey, weight: totalWeight > 0 ? c.weight / totalWeight : 0, state: r.state,
      score: r.value === null ? null : roundHalfUp1(r.value), rawValue: r.value, effectiveWeight: effective, points: isOk ? effective * (r.value as number) : null,
      sampleSize: r.sampleSize, minSample: c.minSample, coverage: r.coverage, evidenceShare: r.evidenceShare, contributors: r.contributors, notes: r.notes,
    };
  });

  const rawTotal = ok.length > 0 && okWeight > 0 ? results.reduce((n, r) => n + (r.points ?? 0), 0) : null;
  // confidence: weight coverage × how far each ok component is past its minimum sample × evidence (evidence only counts for components that expect it)
  const sampleFactor = ok.length === 0 ? 0 : ok.reduce((n, { c, r }) => n + (c.minSample > 0 ? Math.min(1, r.sampleSize / (2 * c.minSample)) : 1), 0) / ok.length;
  const expecting = ok.filter(({ c }) => (c.config.evidence ?? "none") !== "none");
  const evW = expecting.reduce((n, { c }) => n + c.weight, 0);
  const evidenceFactor = evW === 0 ? 1 : 0.5 + 0.5 * (expecting.reduce((n, { c, r }) => n + c.weight * r.evidenceShare, 0) / evW);
  const confidence = clamp(weightCoverage * sampleFactor * evidenceFactor, 0, 1);

  const reasons: string[] = [];
  let status: Status;
  if (rawTotal === null || weightCoverage < model.minWeightCoverage) {
    status = "insufficient";
    reasons.push(weightCoverage === 0 ? "No component has enough data" : `Only ${Math.round(weightCoverage * 100)}% of the model's weight has enough data (at least ${Math.round(model.minWeightCoverage * 100)}% is needed)`);
  } else {
    if (inputs.period.open) reasons.push("The period is still open");
    for (const r of results) if (r.state !== "ok") reasons.push(`${r.label}: ${r.state === "missing" ? "no data recorded" : "not enough data"}`);
    if (confidence < model.minConfidenceForFinal) reasons.push(`Confidence ${Math.round(confidence * 100)}% is below ${Math.round(model.minConfidenceForFinal * 100)}%`);
    const required = ok.filter(({ c, r }) => c.config.evidence === "required" && r.evidenceShare < 1);
    for (const { c } of required) reasons.push(`${c.label}: claims not yet evidenced`);
    status = reasons.length === 0 ? "final" : "provisional";
  }
  const total = status === "insufficient" || rawTotal === null ? null : roundHalfUp1(rawTotal);
  const conf = { value: Math.round(confidence * 100) / 100, label: confidence >= 0.8 ? ("high" as const) : confidence >= 0.5 ? ("medium" as const) : ("low" as const), parts: { coverage: Math.round(weightCoverage * 100) / 100, sample: Math.round(sampleFactor * 100) / 100, evidence: Math.round(evidenceFactor * 100) / 100 } };

  const bands = [...model.bands].sort((a, b) => b.min - a.min);
  const band = total === null ? null : (bands.find((b) => total >= b.min)?.label ?? null);
  const explanation = explain({ results, total, rawTotal, status, band, conf, reasons, ok: ok.length });
  return { total, rawTotal, status, weightCoverage, confidence, components: results, explanation };
}

function explain(a: { results: ComponentResult[]; total: number | null; rawTotal: number | null; status: Status; band: string | null; conf: Explanation["confidence"]; reasons: string[]; ok: number }): Explanation {
  const okOnes = a.results.filter((r) => r.state === "ok" && r.score !== null);
  const formula = a.total === null ? "Not enough data to score" : `${okOnes.map((r) => `(${fmt1(r.rawValue as number)} × ${fmtW(r.effectiveWeight)})`).join(" + ")} = ${fmt1(a.total)}`;
  const parts = okOnes.reduce((n, r) => n + roundHalfUp1(r.points as number), 0);
  const rounding = a.total !== null && Math.abs(roundHalfUp1(parts) - a.total) >= 0.05 ? `The component points add up to ${fmt1(parts)} when each is rounded on its own; the total is rounded once from the unrounded points.` : null;
  const dataQuality = a.results.flatMap((r) => r.notes.filter((n) => r.state !== "ok" || /expected|left out|not enough|counted|against/i.test(n)).map((n) => `${r.label}: ${n}`));
  const whatWouldChangeThis = a.results.filter((r) => r.state !== "ok").map((r) => (r.state === "missing" ? `Record data for "${r.label}" so it can count${r.notes[0] ? ` (${r.notes[0]})` : ""}` : `Add more data for "${r.label}" (${r.sampleSize} of ${r.minSample} needed)`));
  return {
    formula, status: a.status, band: a.band, confidence: a.conf,
    components: a.results.map((r) => {
      const sorted = [...r.contributors].filter((c) => c.value !== null).sort((x, y) => (y.value as number) - (x.value as number) || x.label.localeCompare(y.label));
      return { key: r.key, label: r.label, state: r.state, score: r.score, weight: r.weight, effectiveWeight: r.effectiveWeight, points: r.points === null ? null : roundHalfUp1(r.points), stateText: STATE_TEXT(r.state, r), topContributors: sorted.slice(0, 3), gaps: sorted.filter((c) => (c.value as number) < 0.75).slice(-3).reverse() };
    }),
    reasons: a.reasons, dataQuality, whatWouldChangeThis, rounding,
  };
}
