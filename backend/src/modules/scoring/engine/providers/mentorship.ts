import { clamp } from "../math.js";
import type { Contributor, MentorshipLink, ProviderResult } from "../types.js";

export interface MentorshipConfig { minDays: number; k: number }
export const DEFAULT_MENTORSHIP: MentorshipConfig = { minDays: 60, k: 2.5 };

/**
 * One mentee's improvement index (docs/scoring-architecture.md section 7): 50 + k × the mean of the changes that could be measured,
 * kept between 0 and 100, so 50 means "no change". The changes are the score, delivery and quality differences in points, and the
 * development goals as `attainment − 50` (reaching half of them counts as no change). Null when nothing could be measured.
 */
export function improvementIndex(l: MentorshipLink, k: number): number | null {
  const parts = [l.scoreDelta, l.deliveryDelta, l.qualityDelta, l.goalAchievement === null ? null : l.goalAchievement - 50].filter((x): x is number => x !== null);
  if (parts.length === 0) return null;
  return clamp(50 + k * (parts.reduce((a, b) => a + b, 0) / parts.length), 0, 100);
}
export const durationFactor = (l: MentorshipLink, minDays: number): number => (minDays <= 0 ? 1 : Math.min(1, l.overlapDays / minDays));
const mark = (l: MentorshipLink): string => `${l.counterpart.name}`;

/** Mentor development: duration × credit-share weighted mean of the mentees' improvement indexes. Needs `minSample` mentees with data. */
export function developmentProvider(links: readonly MentorshipLink[], minSample: number, cfg: MentorshipConfig): ProviderResult {
  if (links.length === 0) return { value: null, state: "missing", sampleSize: 0, coverage: 0, evidenceShare: 0, contributors: [], notes: ["No mentee was assigned in this period"] };
  const notes: string[] = [];
  const contributors: Contributor[] = [];
  let num = 0;
  let den = 0;
  let ok = 0;
  for (const l of links) {
    const imp = improvementIndex(l, cfg.k);
    if (imp === null || l.overlapDays <= 0) {
      notes.push(`${mark(l)}: nothing could be compared yet (${l.baselineScore === null ? "no earlier score to start from" : "no change measurable"}), so this mentee is left out`);
      continue;
    }
    const w = durationFactor(l, cfg.minDays) * (1 / Math.max(1, l.mentorCount));
    num += w * imp;
    den += w;
    ok += 1;
    contributors.push({ ref: { type: "mentorship_assignment", id: l.assignmentId }, label: `${mark(l)} (${l.overlapDays} days${l.mentorCount > 1 ? `, ${l.mentorCount} mentors share the credit` : ""})`, value: Math.round(imp * 10) / 10, target: 50, weight: Math.round(w * 1000) / 1000, note: "50 = no change" });
  }
  const coverage = ok / links.length;
  if (ok < minSample) {
    notes.push(`Not enough data (${ok} of ${minSample} mentees with a measurable change)`);
    return { value: null, state: "insufficient", sampleSize: ok, coverage, evidenceShare: 0, contributors, notes };
  }
  return { value: clamp(num / den, 0, 100), state: "ok", sampleSize: ok, coverage, evidenceShare: 0, contributors, notes };
}

/** Mentoring activity: for each assignment, activities logged against the number expected at the cadence, capped at 1; the mean, as a score out of 100. */
export function activityProvider(links: readonly MentorshipLink[]): ProviderResult {
  if (links.length === 0) return { value: null, state: "missing", sampleSize: 0, coverage: 0, evidenceShare: 0, contributors: [], notes: ["No mentee was assigned in this period"] };
  const notes: string[] = [];
  const contributors: Contributor[] = [];
  const ratios: number[] = [];
  for (const l of links) {
    const expected = l.overlapDays / Math.max(1, l.cadenceDays);
    if (expected < 0.5) {
      notes.push(`${mark(l)}: only ${l.overlapDays} days in this period, too short to expect a session (every ${l.cadenceDays} days), so it is left out`);
      continue;
    }
    const ratio = Math.min(1, l.activities / expected);
    ratios.push(ratio);
    contributors.push({ ref: { type: "mentorship_assignment", id: l.assignmentId }, label: `${mark(l)}: ${l.activities} logged, about ${Math.round(expected * 10) / 10} expected (every ${l.cadenceDays} days)`, value: Math.round(ratio * 1000) / 10, target: 100, weight: 1 });
  }
  if (ratios.length === 0) return { value: null, state: "insufficient", sampleSize: 0, coverage: 0, evidenceShare: 0, contributors, notes };
  return { value: clamp((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100, 0, 100), state: "ok", sampleSize: ratios.length, coverage: ratios.length / links.length, evidenceShare: 0, contributors, notes };
}

/** A mentee's growth: the duration-weighted mean of their own improvement indexes. */
export function menteeGrowthProvider(links: readonly MentorshipLink[], cfg: MentorshipConfig): ProviderResult {
  if (links.length === 0) return { value: null, state: "missing", sampleSize: 0, coverage: 0, evidenceShare: 0, contributors: [], notes: ["No mentor was assigned in this period"] };
  let num = 0;
  let den = 0;
  let ok = 0;
  const notes: string[] = [];
  const contributors: Contributor[] = [];
  for (const l of links) {
    const imp = improvementIndex(l, cfg.k);
    if (imp === null || l.overlapDays <= 0) {
      notes.push(`With ${mark(l)}: nothing could be compared yet, so it is left out`);
      continue;
    }
    const w = Math.max(durationFactor(l, cfg.minDays), 0.0001);
    num += w * imp;
    den += w;
    ok += 1;
    contributors.push({ ref: { type: "mentorship_assignment", id: l.assignmentId }, label: `Mentored by ${mark(l)} (${l.overlapDays} days)`, value: Math.round(imp * 10) / 10, target: 50, weight: Math.round(w * 1000) / 1000, note: "50 = no change" });
  }
  if (ok === 0) return { value: null, state: "insufficient", sampleSize: 0, coverage: 0, evidenceShare: 0, contributors, notes };
  return { value: clamp(num / den, 0, 100), state: "ok", sampleSize: ok, coverage: ok / links.length, evidenceShare: 0, contributors, notes };
}
