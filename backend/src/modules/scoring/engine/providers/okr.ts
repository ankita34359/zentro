import { keyResultAttainment, objectiveAttainment, type Direction, type ProgressMethod } from "../../../okr/attainment.js";
import { clamp } from "../math.js";
import type { Contributor, ObjectiveInput, ProviderResult } from "../types.js";

/** OKR achievement (docs/scoring-architecture.md 3.1): the weighted mean of the attainment of the objectives that have enough data. Tasks never enter it. */
export function okrProvider(set: readonly ObjectiveInput[], minSample: number, label: string): ProviderResult {
  const considered = set.filter((o) => o.lifecycle === "active" || o.lifecycle === "completed");
  const notes: string[] = [];
  const contributors: Contributor[] = [];
  let weighted = 0;
  let weightOk = 0;
  let weightAll = 0;
  let okCount = 0;
  let anyData = 0;
  let krsUsed = 0;
  for (const o of considered) {
    weightAll += o.weight;
    const krs = o.keyResults.map((k) => ({ k, a: keyResultAttainment({ direction: k.direction as Direction, method: k.method as ProgressMethod, start: k.start, target: k.target, current: k.current, weight: k.weight }) }));
    const att = objectiveAttainment(krs.map(({ k, a }) => ({ attainment: a.value, weight: k.weight })));
    if (att.value !== null) anyData += 1;
    if (att.dataState === "ok" && att.value !== null) {
      okCount += 1;
      weighted += o.weight * att.value;
      weightOk += o.weight;
      for (const { k, a } of krs) {
        if (a.value === null) notes.push(`"${k.title}" (${o.title}) has no recorded value yet, so it is left out`);
        else {
          krsUsed += 1;
          contributors.push({ ref: { type: "key_result", id: k.id }, label: `${k.title} (${o.title})`, value: a.value, target: null, weight: o.weight * k.weight, ...(a.regressed ? { note: "went backwards: counted as 0" } : a.capped ? { note: "beyond the target: counted as 100%" } : {}) });
        }
      }
    } else if (att.value !== null) {
      notes.push(`"${o.title}" has a value for only ${Math.round(att.coverage * 100)}% of its key-result weight, so it is shown but left out of the score`);
    } else {
      notes.push(`"${o.title}" has no recorded values yet`);
    }
  }
  if (considered.length === 0) return { value: null, state: "missing", sampleSize: 0, coverage: 0, evidenceShare: 0, contributors: [], notes: [`No active ${label} objective overlaps this period`] };
  if (okCount === 0) return { value: null, state: anyData > 0 ? "insufficient" : "missing", sampleSize: 0, coverage: 0, evidenceShare: 0, contributors, notes };
  const coverage = weightAll > 0 ? weightOk / weightAll : 0;
  const state = okCount >= minSample ? "ok" : "insufficient";
  if (state === "insufficient") notes.push(`Not enough data (${okCount} of ${minSample} objectives needed)`);
  return { value: clamp((weighted / weightOk) * 100, 0, 100), state, sampleSize: krsUsed, coverage, evidenceShare: 0, contributors, notes };
}
