import { daysBetween } from "../tasks/dates.js";

/**
 * Objective health (docs/scoring-architecture.md section 9): a deterministic calculation, not a score. A pure function of
 * the stored progress, the objective's own window and today's date, so the same inputs always give the same answer and the
 * reason it states is made of the very numbers used.
 *
 *   elapsed = clamp((today − start) / (end − start), 0, 1)       ratio = progress / elapsed
 *   completed    progress ≥ 100% or lifecycle completed
 *   not_started  start is in the future (or a draft)
 *   delayed      today is past the end and progress < 100%
 *   on_track     ratio ≥ 0.90        at_risk  0.60 ≤ ratio < 0.90        delayed  ratio < 0.60
 *   no_data      no key result has a recorded value and more than 10% of the time has passed
 * Very early in the window (under 5% elapsed) there is nothing to compare with: on track if there is data, else not started.
 */
export type Health = "not_started" | "on_track" | "at_risk" | "delayed" | "completed" | "no_data";
export const HEALTH_LABEL: Readonly<Record<Health, string>> = { not_started: "Not started", on_track: "On track", at_risk: "At risk", delayed: "Delayed", completed: "Completed", no_data: "No data" };

export interface HealthThresholds { onTrack: number; atRisk: number; noDataAfter: number; earlyWindow: number }
export const DEFAULT_THRESHOLDS: HealthThresholds = { onTrack: 0.9, atRisk: 0.6, noDataAfter: 0.1, earlyWindow: 0.05 };

export interface HealthInput {
  lifecycle: string;
  startDate: string;
  endDate: string;
  today: string;
  /** 0 to 1, or null when no key result has a recorded value. */
  progress: number | null;
}
export interface HealthResult { health: Health | null; reason: string; elapsed: number; ratio: number | null }

const pct = (n: number): string => `${Math.round(n * 100)}%`;

export function objectiveHealth(i: HealthInput, t: HealthThresholds = DEFAULT_THRESHOLDS): HealthResult {
  const span = Math.max(1, daysBetween(i.startDate, i.endDate));
  const elapsed = Math.min(1, Math.max(0, daysBetween(i.startDate, i.today) / span));
  const done = (health: Health | null, reason: string, ratio: number | null = null): HealthResult => ({ health, reason, elapsed, ratio });
  if (i.lifecycle === "cancelled") return done(null, "Cancelled: health is not tracked.");
  if (i.lifecycle === "completed" || (i.progress !== null && i.progress >= 1)) return done("completed", i.lifecycle === "completed" ? "Marked completed." : `Progress ${pct(i.progress ?? 1)}: the target is reached.`);
  if (i.lifecycle === "draft") return done("not_started", "Still a draft: it starts when it is activated.");
  if (i.today < i.startDate) return done("not_started", `It starts on ${i.startDate}.`);
  if (i.today > i.endDate) return done("delayed", i.progress === null ? `The end date (${i.endDate}) has passed and nothing is recorded.` : `The end date (${i.endDate}) has passed at ${pct(i.progress)} progress.`);
  if (i.progress === null) {
    if (elapsed > t.noDataAfter) return done("no_data", `${pct(elapsed)} of the time has passed and no key result has a recorded value.`);
    return done("not_started", "Nothing is recorded yet; it is still early.");
  }
  if (elapsed < t.earlyWindow) return done("on_track", `Only ${pct(elapsed)} of the time has passed; progress is ${pct(i.progress)}.`);
  const ratio = i.progress / elapsed;
  const detail = `progress ${pct(i.progress)} vs ${pct(elapsed)} expected (ratio ${ratio.toFixed(2)})`;
  if (ratio >= t.onTrack) return done("on_track", `On pace: ${detail}.`, ratio);
  if (ratio >= t.atRisk) return done("at_risk", `Behind pace: ${detail}.`, ratio);
  return done("delayed", `Well behind pace: ${detail}.`, ratio);
}
