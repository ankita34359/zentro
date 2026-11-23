import { createHash } from "node:crypto";
import { newId } from "../../lib/ids.js";
import type { Collector } from "./collector.js";
import { canonicalJson } from "./engine/canonical.js";
import { computeScore, ENGINE_VERSION } from "./engine/engine.js";
import type { ModelDef, ScoreInputs } from "./engine/types.js";
import { toModelDef } from "./models.js";
import type { ModelRow, PeriodRow, ScorecardRepository, ScoringRepository } from "./repositories/scoring.js";

export type Trigger = "scheduled" | "manual" | "period_close" | "recalculation";
export interface RunOutcome { scoreId: string; created: boolean; changedFrom: number | null }

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

/** The active model for a person as of the period end: their designation's, else their role family's, else the default. */
export function resolveModel(models: ModelRow[], designationId: string | null, familyId: string | null): ModelRow | undefined {
  const active = models.filter((m) => m.status === "active" && m.subject_type === "membership");
  return (designationId ? active.find((m) => m.designation_id === designationId) : undefined) ?? (familyId ? active.find((m) => m.role_family_id === familyId && m.designation_id === null) : undefined) ?? active.find((m) => m.is_default === 1 && m.is_demo === 0);
}

/**
 * Scores one person for a period and stores a new run when the inputs or the outcome changed since the last one, and nothing
 * otherwise. Shared by the people who press "calculate", the closing of a period and the nightly job, so all three behave the
 * same. `collector` is built once for the period and reused for many people. The caller owns the transaction and the audit entry.
 */
export function runScore(d: { cards: ScorecardRepository; models: ScoringRepository; now: string }, collector: Collector, period: PeriodRow, m: string, name: string, trigger: Trigger, opt: { by: string | null; isDemo?: boolean }): RunOutcome | null {
  const rows = d.models.models();
  const model = resolveModel(rows, collector.designationOn(m), collector.roleFamilyOn(m));
  if (!model) return null;
  // the engine scores the CANONICAL form of the snapshot and the model (the very text that is stored), so a later verification reproduces it exactly
  const def = JSON.parse(canonicalJson(toModelDef(model, d.models.components(model.id)))) as ModelDef;
  const inputs = JSON.parse(canonicalJson(collector.inputsFor(m, name))) as ScoreInputs;
  const result = computeScore(inputs, def);
  const { asOf: _asOf, ...stable } = inputs;
  void _asOf;
  const outcome = { total: result.total, status: result.status, components: result.components.map((c) => [c.key, c.state, c.rawValue]) };
  const hash = sha(canonicalJson({ inputs: stable, model: { id: model.id, def }, engine: ENGINE_VERSION, outcome }));
  const key = `m:${m}`;
  let card = d.cards.scorecardFor(key, period.id);
  const last = card ? d.cards.latestHash(card.id) : undefined;
  const cardStatus = period.status === "open" ? "open" : "final";
  if (card && last && last.hash === hash && card.scoring_model_id === model.id) {
    if (card.status !== cardStatus) d.cards.pointScorecard(card.id, card.latest_score_id!, model.id, cardStatus);
    return { scoreId: card.latest_score_id!, created: false, changedFrom: null };
  }
  if (!card) {
    const id = newId();
    d.cards.insertScorecard({ id, subjectKey: key, membershipId: m, periodId: period.id, modelId: model.id, isDemo: opt.isDemo ?? false, now: d.now });
    card = d.cards.scorecard(id)!;
  }
  const scoreId = newId();
  const run = (last?.run ?? 0) + 1;
  d.cards.insertScore({ id: scoreId, scorecardId: card.id, run, modelId: model.id, modelVersion: model.version, engineVersion: ENGINE_VERSION, status: result.status, total: result.total, confidence: result.confidence, weightCoverage: result.weightCoverage, hash, trigger, explanationJson: JSON.stringify(result.explanation), inputsJson: canonicalJson(inputs), modelJson: canonicalJson(def), by: opt.by, now: d.now });
  for (const c of result.components) {
    d.cards.insertScoreComponent({ id: newId(), scoreId, key: c.key, label: c.label, providerKey: c.providerKey, raw: c.rawValue, normalized: c.score, weight: c.weight, effective: c.effectiveWeight, points: c.points, state: c.state, sample: c.sampleSize, minSample: c.minSample, coverage: c.coverage, inputsJson: JSON.stringify(c.contributors), notesJson: JSON.stringify(c.notes) });
  }
  d.cards.pointScorecard(card.id, scoreId, model.id, cardStatus);
  collector.forget(m);
  return { scoreId, created: true, changedFrom: last?.run ?? null };
}

/** Mentors are scored after everyone else, because a mentor's development score reads their mentees' scores from the same period. */
export function scoringOrder<T extends { id: string }>(people: readonly T[], collector: Collector): T[] {
  return [...people.filter((p) => !collector.mentorsAnyone(p.id)), ...people.filter((p) => collector.mentorsAnyone(p.id))];
}
