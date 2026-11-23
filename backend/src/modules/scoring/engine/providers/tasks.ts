import { clamp, daysBetween, num } from "../math.js";
import type { Contributor, KpiInput, ProviderResult, TaskInput } from "../types.js";
import { kpiProvider } from "./kpi.js";

const PRIORITY: Record<string, number> = { low: 0.5, medium: 1, high: 1.5, critical: 2 };
const weightOf = (t: TaskInput): number => t.importance * (PRIORITY[t.priority] ?? 1);

/**
 * Delivery and reliability (docs/scoring-architecture.md 3.3): on-time, importance-weighted delivery of the tasks DUE in the period,
 * blended with estimate accuracy. Built from weighted RATES, so 100 on-time tasks and 20 on-time tasks give the same value:
 * quantity alone cannot raise it. A task that is not yet due and not finished is pending and left out.
 */
export function deliveryProvider(tasks: readonly TaskInput[], asOf: string, config: Record<string, unknown>, minSample: number): ProviderResult {
  const decay = num(config, "lateDecayDays", 7);
  const estimateWeight = num(config, "estimateWeight", 0.2);
  const minPairs = num(config, "minEstimatePairs", 3);
  const population = tasks.filter((t) => t.status !== "cancelled");
  let sw = 0;
  let sc = 0;
  let resolved = 0;
  let late = 0;
  let overdue = 0;
  let pending = 0;
  const pairs: number[] = [];
  const contributors: Contributor[] = [];
  for (const t of population) {
    const done = t.status === "completed" && t.completedOn !== null;
    if (!done && t.dueAt >= asOf) {
      pending += 1;
      continue;
    }
    const w = weightOf(t);
    let c = 0;
    if (done) {
      const d = daysBetween(t.dueAt, t.completedOn!);
      c = d <= 0 ? 1 : 0.5 * Math.max(0, 1 - d / decay);
      if (d > 0) late += 1;
      if (t.estimatedMinutes && t.actualMinutes && t.estimatedMinutes > 0 && t.actualMinutes > 0) pairs.push(Math.min(t.estimatedMinutes, t.actualMinutes) / Math.max(t.estimatedMinutes, t.actualMinutes));
    } else overdue += 1;
    sw += w;
    sc += w * c;
    resolved += 1;
    contributors.push({ ref: { type: "task", id: t.id }, label: t.title, value: c, weight: w, note: done ? (c === 1 ? "on time" : `late by ${daysBetween(t.dueAt, t.completedOn!)} days`) : "overdue" });
  }
  const notes: string[] = [];
  if (pending > 0) notes.push(`${pending} ${pending === 1 ? "task is" : "tasks are"} not due yet and left out`);
  if (resolved === 0) return { value: null, state: "missing", sampleSize: 0, coverage: 0, evidenceShare: 0, contributors: [], notes: [...notes, "No task was due in this period"] };
  let value = sc / sw;
  if (pairs.length >= minPairs) {
    const accuracy = pairs.reduce((a, b) => a + b, 0) / pairs.length;
    value = value * (1 - estimateWeight) + accuracy * estimateWeight;
    notes.push(`Estimate accuracy ${Math.round(accuracy * 100)}% over ${pairs.length} tasks counts for ${Math.round(estimateWeight * 100)}%`);
  }
  notes.push(`${resolved} tasks counted: ${resolved - late - overdue} on time, ${late} late, ${overdue} overdue`);
  const state = resolved >= minSample ? "ok" : "insufficient";
  if (state === "insufficient") notes.push(`Not enough data (${resolved} of ${minSample} due tasks needed)`);
  return { value: clamp(value * 100, 0, 100), state, sampleSize: resolved, coverage: state === "ok" ? 1 : resolved / Math.max(1, minSample), evidenceShare: 0, contributors, notes };
}

/** Quality and business impact (3.4): quality/impact KPIs and the reviewer-rated outcomes of finished tasks, blended. */
export function qualityProvider(kpis: readonly KpiInput[], tasks: readonly TaskInput[], config: Record<string, unknown>, minSample: number): ProviderResult {
  const blend = num(config, "qualityBlend", 0.5);
  const minRated = num(config, "minRatedTasks", 3);
  const k = kpiProvider(kpis, { ...config, categories: ["quality", "impact"] }, 1);
  const rated = tasks.filter((t) => t.status === "completed" && t.quality !== null);
  let sw = 0;
  let sv = 0;
  const contributors: Contributor[] = [...k.contributors];
  for (const t of rated) {
    const w = weightOf(t);
    sw += w;
    sv += w * ((t.quality! - 1) / 4);
    contributors.push({ ref: { type: "task", id: t.id }, label: `${t.title} (rated ${t.quality} of 5)`, value: (t.quality! - 1) / 4, weight: w });
  }
  const notes = [...k.notes];
  const hasKpi = k.state === "ok" && k.value !== null;
  const hasRatings = rated.length >= minRated;
  if (rated.length > 0 && !hasRatings) notes.push(`Only ${rated.length} of ${minRated} rated tasks needed, so ratings are shown but left out`);
  if (!hasKpi && !hasRatings) {
    return { value: null, state: k.state === "insufficient" || rated.length > 0 ? "insufficient" : "missing", sampleSize: k.sampleSize + rated.length, coverage: 0, evidenceShare: 0, contributors, notes: notes.length ? notes : ["No quality or impact KPI and no rated task in this period"] };
  }
  let value: number;
  if (hasKpi && hasRatings) value = (k.value as number) * blend + (sv / sw) * 100 * (1 - blend);
  else if (hasKpi) {
    value = k.value as number;
    notes.push("Only quality and impact KPIs were available (no rated tasks)");
  } else {
    value = (sv / sw) * 100;
    notes.push("Only reviewer-rated tasks were available (no quality or impact KPI)");
  }
  const sample = (hasKpi ? k.sampleSize : 0) + (hasRatings ? rated.length : 0);
  return { value: clamp(value, 0, 100), state: sample >= minSample ? "ok" : "insufficient", sampleSize: sample, coverage: hasKpi && hasRatings ? 1 : 0.5, evidenceShare: 0, contributors, notes };
}
