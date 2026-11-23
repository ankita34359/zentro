import { keyResultAttainment, objectiveAttainment, type Direction, type ProgressMethod } from "../../../okr/attainment.js";
import { clamp } from "../math.js";
import type { Contributor, DepartmentInputs, ManagementInputs, ObjectiveInput, ProviderResult, TeamInputs } from "../types.js";

const none = (state: "missing" | "insufficient", notes: string[], contributors: Contributor[] = [], sampleSize = 0): ProviderResult => ({ value: null, state, sampleSize, coverage: 0, evidenceShare: 0, contributors, notes });

/** An objective's attainment (0 to 1) when enough of its key results have values, else null. */
export function attainmentOf(o: ObjectiveInput): number | null {
  const att = objectiveAttainment(o.keyResults.map((k) => ({ attainment: keyResultAttainment({ direction: k.direction as Direction, method: k.method as ProgressMethod, start: k.start, target: k.target, current: k.current, weight: k.weight }).value, weight: k.weight })));
  return att.dataState === "ok" ? att.value : null;
}
const live = (set: readonly ObjectiveInput[]): ObjectiveInput[] => set.filter((o) => o.lifecycle === "active" || o.lifecycle === "completed");
const days = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * Contribution to the company (docs/scoring-architecture.md 8.2): the attainment of the objectives that are LINKED to a parent,
 * weighted by how heavily each contributes to it. An objective with no parent contributes nothing to the company and is listed as such.
 */
export function contributionProvider(set: readonly ObjectiveInput[], minSample: number): ProviderResult {
  const objs = live(set);
  if (objs.length === 0) return none("missing", ["No active department objective overlaps this period"]);
  const notes: string[] = [];
  const contributors: Contributor[] = [];
  let num = 0;
  let den = 0;
  let ok = 0;
  let all = 0;
  for (const o of objs) {
    all += o.weight;
    const a = attainmentOf(o);
    if (!o.parent) {
      notes.push(`"${o.title}" is not linked to a company objective, so its progress does not count toward the company`);
      continue;
    }
    if (a === null) {
      notes.push(`"${o.title}" has too few recorded values to count`);
      continue;
    }
    const w = o.weight * o.parent.weight;
    num += w * a;
    den += w;
    ok += 1;
    contributors.push({ ref: { type: "objective", id: o.id }, label: `${o.title} → ${o.parent.title}`, value: a, target: null, weight: Math.round(w * 1000) / 1000, note: `contributes at weight ${o.parent.weight}` });
  }
  if (ok === 0) return none("insufficient", notes, contributors);
  const state = ok >= minSample ? "ok" : "insufficient";
  if (state === "insufficient") notes.push(`Not enough data (${ok} of ${minSample} linked objectives needed)`);
  return { value: state === "ok" ? clamp((num / den) * 100, 0, 100) : null, state, sampleSize: ok, coverage: all > 0 ? objs.filter((o) => o.parent).reduce((n, o) => n + o.weight, 0) / all : 0, evidenceShare: 0, contributors, notes };
}

/** Strategic execution: attainment (70 %) and pace (30 %, capped at 1) of the company objectives. Pace is attainment against the share of the time that has passed. */
export function strategicExecutionProvider(set: readonly ObjectiveInput[], asOf: string, minSample: number, attainmentShare = 0.7): ProviderResult {
  const objs = live(set);
  if (objs.length === 0) return none("missing", ["No active company objective overlaps this period"]);
  const notes: string[] = [];
  const contributors: Contributor[] = [];
  let num = 0;
  let den = 0;
  let ok = 0;
  for (const o of objs) {
    const a = attainmentOf(o);
    if (a === null) {
      notes.push(`"${o.title}" has too few recorded values to count`);
      continue;
    }
    const total = o.start && o.end ? Math.max(1, days(o.start, o.end) + 1) : 1;
    const elapsed = o.start ? clamp((days(o.start, asOf) + 1) / total, 0, 1) : 1;
    const pace = o.lifecycle === "completed" || elapsed < 0.05 ? 1 : Math.min(1, a / elapsed);
    const v = attainmentShare * a + (1 - attainmentShare) * pace;
    num += o.weight * v;
    den += o.weight;
    ok += 1;
    contributors.push({ ref: { type: "objective", id: o.id }, label: o.title, value: v, target: null, weight: o.weight, note: `attainment ${Math.round(a * 100)}%, pace ${Math.round(pace * 100)}%` });
  }
  if (ok === 0) return none("insufficient", notes, contributors);
  const state = ok >= minSample ? "ok" : "insufficient";
  if (state === "insufficient") notes.push(`Not enough data (${ok} of ${minSample} objectives needed)`);
  return { value: state === "ok" ? clamp((num / den) * 100, 0, 100) : null, state, sampleSize: ok, coverage: ok / objs.length, evidenceShare: 0, contributors, notes };
}

/** Organizational health: how the company and department objectives are doing: on track or completed 100, at risk 50, delayed 0. Not-started and no-data objectives are left out. */
export function orgHealthProvider(set: readonly ObjectiveInput[], minSample: number): ProviderResult {
  const objs = live(set);
  if (objs.length === 0) return none("missing", ["No active company or department objective overlaps this period"]);
  const score: Record<string, number> = { on_track: 1, completed: 1, at_risk: 0.5, delayed: 0 };
  const counted = objs.filter((o) => o.health !== undefined && o.health !== null && o.health in score);
  const left = objs.length - counted.length;
  const notes = left > 0 ? [`${left} ${left === 1 ? "objective is" : "objectives are"} not started or have no recorded values, so ${left === 1 ? "it is" : "they are"} left out`] : [];
  const contributors: Contributor[] = counted.filter((o) => (score[o.health as string] ?? 1) < 1).map((o) => ({ ref: { type: "objective", id: o.id }, label: `${o.title} (${String(o.health).replace("_", " ")})`, value: score[o.health as string] ?? 0, target: 1, weight: 1 }));
  if (counted.length < minSample) return none("insufficient", [...notes, `Not enough data (${counted.length} of ${minSample} objectives with a health needed)`], contributors, counted.length);
  const mean = counted.reduce((n, o) => n + (score[o.health as string] ?? 0), 0) / counted.length;
  return { value: clamp(mean * 100, 0, 100), state: "ok", sampleSize: counted.length, coverage: counted.length / objs.length, evidenceShare: 0, contributors, notes: [...notes, `${counted.filter((o) => (score[o.health as string] ?? 0) === 1).length} of ${counted.length} are on track or completed`] };
}

/** Team development: how the people someone answers for changed between periods. 50 means no change; 2.5 points of index per point of score (same scale as mentoring). */
export function teamDevelopmentProvider(t: TeamInputs | undefined, minSample: number, k = 2.5): ProviderResult {
  const members = t?.members ?? [];
  if (members.length === 0) return none("missing", ["Nobody reports to this person or belongs to a team they lead"]);
  const deltas = members.filter((m) => m.baseline !== null && m.current !== null).map((m) => (m.current as number) - (m.baseline as number));
  const notes = members.length > deltas.length ? [`${members.length - deltas.length} of ${members.length} people have no earlier score to compare with, so they are left out`] : [];
  if (deltas.length < minSample) return none("insufficient", [...notes, `Not enough data (${deltas.length} of ${minSample} people with a measurable change)`], [], deltas.length);
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  return { value: clamp(50 + k * mean, 0, 100), state: "ok", sampleSize: deltas.length, coverage: deltas.length / members.length, evidenceShare: 0, contributors: [{ ref: { type: "team", id: "members" }, label: `${deltas.length} people: average score change ${mean >= 0 ? "+" : "−"}${Math.abs(Math.round(mean * 10) / 10)} points`, value: clamp(50 + k * mean, 0, 100) / 100, target: null, weight: deltas.length, note: "50 = no change" }], notes: [...notes, "A team's change has many causes; it is shown for the person who answers for the team, not to blame or credit them alone."] };
}

/** Management responsibilities: the share of direct reports who got a review from this manager on time. One-to-one cadence and blocker resolution are not measured yet. */
export function managementProvider(m: ManagementInputs | undefined, minSample: number): ProviderResult {
  const reports = m?.reports ?? [];
  const caveat = "One-to-one cadence and blocker resolution are not measured yet: only reviews count.";
  if (reports.length === 0) return none("missing", ["No direct reports in this period", caveat]);
  const submitted = reports.filter((r) => r.submitted).length;
  if (m?.periodOpen && submitted === 0) return none("missing", ["Reviews for this period are written once it ends", caveat]);
  const onTime = reports.filter((r) => r.submitted && r.onTime).length;
  if (reports.length < minSample) return none("insufficient", [`Not enough data (${reports.length} of ${minSample} reports needed)`, caveat], [], reports.length);
  return {
    value: clamp((onTime / reports.length) * 100, 0, 100), state: "ok", sampleSize: reports.length, coverage: submitted / reports.length, evidenceShare: 0,
    contributors: [{ ref: { type: "reviews", id: "reports" }, label: `Reviews submitted on time for ${onTime} of ${reports.length} direct reports${submitted > onTime ? ` (${submitted - onTime} more came late)` : ""}`, value: onTime / reports.length, target: 1, weight: reports.length }],
    notes: [`On time means within ${m?.graceDays ?? 14} days of the period's end.`, caveat],
  };
}

/** Team performance of a department head: the mean score of the people in the departments they head, one line per department, no individual named. */
export function departmentPeopleProvider(d: DepartmentInputs | undefined, minSample: number): ProviderResult {
  const deps = d?.departments ?? [];
  if (deps.length === 0) return none("missing", ["This person heads no department in this period"]);
  const scored = deps.filter((x) => x.mean !== null && x.people >= minSample);
  const contributors: Contributor[] = deps.map((x) => ({ ref: { type: "department", id: x.name }, label: `${x.name}: ${x.people} ${x.people === 1 ? "person" : "people"} with a score`, value: x.mean === null ? null : x.mean / 100, target: null, weight: x.people }));
  if (scored.length === 0) return none("insufficient", [`Not enough data (a department needs at least ${minSample} people with a score)`], contributors);
  const people = scored.reduce((n, x) => n + x.people, 0);
  return { value: clamp(scored.reduce((n, x) => n + (x.mean as number) * x.people, 0) / people, 0, 100), state: "ok", sampleSize: people, coverage: scored.length / deps.length, evidenceShare: 0, contributors, notes: ["The average of the scores of the people in the department, weighted by how many there are. It shows how the department is doing, not who is doing it."] };
}
