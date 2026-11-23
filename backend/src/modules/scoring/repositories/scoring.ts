import type { TenantDb } from "../../../db/tenant.js";

export interface ModelRow {
  id: string;
  name: string;
  template_key: string | null;
  version: number;
  status: string;
  subject_type: string;
  role_family_id: string | null;
  designation_id: string | null;
  is_default: number;
  min_weight_coverage: number;
  min_confidence_for_final: number;
  config_json: string;
  supersedes_model_id: string | null;
  created_by_membership_id: string;
  is_demo: number;
  created_at: string;
  updated_at: string;
}
const MODEL_COLS = "id, name, template_key, version, status, subject_type, role_family_id, designation_id, is_default, min_weight_coverage, min_confidence_for_final, config_json, supersedes_model_id, created_by_membership_id, is_demo, created_at, updated_at";
export interface ComponentRow { id: string; scoring_model_id: string; component_key: string; label: string; weight: number; provider_key: string; min_sample: number; config_json: string; sort_order: number }
const COMP_COLS = "id, scoring_model_id, component_key, label, weight, provider_key, min_sample, config_json, sort_order";

/** Scoring models and their components for ONE organization (the tenant handle supplies the organization id). */
export class ScoringRepository {
  constructor(private readonly tdb: TenantDb) {}

  models(includeRetired = true): ModelRow[] {
    return this.tdb.all<ModelRow>(`SELECT ${MODEL_COLS} FROM scoring_models WHERE organization_id = @organization_id AND (@all = 1 OR status <> 'retired') ORDER BY name COLLATE NOCASE, version DESC`, { all: includeRetired ? 1 : 0 });
  }
  model(id: string): ModelRow | undefined {
    return this.tdb.get<ModelRow>(`SELECT ${MODEL_COLS} FROM scoring_models WHERE organization_id = @organization_id AND id = @id`, { id });
  }
  components(modelId?: string): ComponentRow[] {
    return this.tdb.all<ComponentRow>(`SELECT ${COMP_COLS} FROM scoring_model_components WHERE organization_id = @organization_id AND (@modelId IS NULL OR scoring_model_id = @modelId) ORDER BY scoring_model_id, sort_order, component_key`, { modelId: modelId ?? null });
  }
  realModelCount(): number {
    return this.tdb.get<{ n: number }>("SELECT COUNT(*) AS n FROM scoring_models WHERE organization_id = @organization_id AND is_demo = 0")?.n ?? 0;
  }
  insertModel(m: { id: string; name: string; templateKey: string | null; version: number; status: string; roleFamilyId: string | null; designationId: string | null; isDefault: boolean; minWeightCoverage: number; minConfidenceForFinal: number; configJson: string; supersedesId: string | null; createdBy: string; isDemo?: boolean; now: string }): void {
    this.tdb.run(
      "INSERT INTO scoring_models (id, organization_id, name, template_key, version, status, role_family_id, designation_id, is_default, min_weight_coverage, min_confidence_for_final, config_json, supersedes_model_id, created_by_membership_id, is_demo, created_at, updated_at) VALUES (@id, @organization_id, @name, @templateKey, @version, @status, @roleFamilyId, @designationId, @isDefault, @minWeightCoverage, @minConfidenceForFinal, @configJson, @supersedesId, @createdBy, @isDemo, @now, @now)",
      { ...m, isDefault: m.isDefault ? 1 : 0, isDemo: m.isDemo ? 1 : 0 },
    );
  }
  updateModel(m: { id: string; name: string; roleFamilyId: string | null; designationId: string | null; isDefault: boolean; minWeightCoverage: number; minConfidenceForFinal: number; configJson: string; now: string }): void {
    this.tdb.run("UPDATE scoring_models SET name = @name, role_family_id = @roleFamilyId, designation_id = @designationId, is_default = @isDefault, min_weight_coverage = @minWeightCoverage, min_confidence_for_final = @minConfidenceForFinal, config_json = @configJson, updated_at = @now WHERE organization_id = @organization_id AND id = @id", { ...m, isDefault: m.isDefault ? 1 : 0 });
  }
  setStatus(id: string, status: string, now: string): void {
    this.tdb.run("UPDATE scoring_models SET status = @status, updated_at = @now WHERE organization_id = @organization_id AND id = @id", { id, status, now });
  }
  clearDefaultExcept(id: string, now: string): void {
    this.tdb.run("UPDATE scoring_models SET is_default = 0, updated_at = @now WHERE organization_id = @organization_id AND is_default = 1 AND id <> @id AND is_demo = 0", { id, now });
  }
  insertComponent(c: { id: string; modelId: string; key: string; label: string; weight: number; providerKey: string; minSample: number; configJson: string; sortOrder: number }): void {
    this.tdb.run("INSERT INTO scoring_model_components (id, organization_id, scoring_model_id, component_key, label, weight, provider_key, min_sample, config_json, sort_order) VALUES (@id, @organization_id, @modelId, @key, @label, @weight, @providerKey, @minSample, @configJson, @sortOrder)", c);
  }
  deleteComponents(modelId: string): void {
    this.tdb.run("DELETE FROM scoring_model_components WHERE organization_id = @organization_id AND scoring_model_id = @modelId", { modelId });
  }
}

export interface PeriodRow { id: string; name: string; period_type: string; start_date: string; end_date: string; status: string; closed_at: string | null; closed_by_membership_id: string | null; is_demo: number; created_at: string }
export interface ScorecardRow { id: string; subject_type: string; subject_key: string; subject_membership_id: string | null; period_id: string; scoring_model_id: string; status: string; latest_score_id: string | null; is_demo: number; created_at: string }
export interface ScoreRow {
  id: string; scorecard_id: string; run_number: number; scoring_model_id: string; model_version: number; engine_version: string; status: string; total_score: number | null; confidence: number; weight_coverage: number; inputs_hash: string;
  trigger: string; explanation_json: string; inputs_json: string; model_json: string; computed_at: string; computed_by_membership_id: string | null;
}
export interface ScoreComponentRow { id: string; score_id: string; component_key: string; label: string; provider_key: string; raw_value: number | null; normalized_score: number | null; weight: number; effective_weight: number; contribution_points: number | null; data_state: string; sample_size: number; min_sample: number; coverage: number; inputs_json: string; notes_json: string }
const PERIOD_COLS = "id, name, period_type, start_date, end_date, status, closed_at, closed_by_membership_id, is_demo, created_at";
const CARD_COLS = "id, subject_type, subject_key, subject_membership_id, period_id, scoring_model_id, status, latest_score_id, is_demo, created_at";
const SCORE_COLS_LIGHT = "id, scorecard_id, run_number, scoring_model_id, model_version, engine_version, status, total_score, confidence, weight_coverage, inputs_hash, trigger, explanation_json, '' AS inputs_json, '' AS model_json, computed_at, computed_by_membership_id";
const SCORE_COLS = "id, scorecard_id, run_number, scoring_model_id, model_version, engine_version, status, total_score, confidence, weight_coverage, inputs_hash, trigger, explanation_json, inputs_json, model_json, computed_at, computed_by_membership_id";
const SC_COLS = "id, score_id, component_key, label, provider_key, raw_value, normalized_score, weight, effective_weight, contribution_points, data_state, sample_size, min_sample, coverage, inputs_json, notes_json";

/** Periods, scorecards and the immutable score runs for ONE organization. */
export class ScorecardRepository {
  constructor(private readonly tdb: TenantDb) {}

  periods(): PeriodRow[] {
    return this.tdb.all<PeriodRow>(`SELECT ${PERIOD_COLS} FROM performance_periods WHERE organization_id = @organization_id ORDER BY start_date DESC, name`);
  }
  period(id: string): PeriodRow | undefined {
    return this.tdb.get<PeriodRow>(`SELECT ${PERIOD_COLS} FROM performance_periods WHERE organization_id = @organization_id AND id = @id`, { id });
  }
  insertPeriod(p: { id: string; name: string; periodType: string; startDate: string; endDate: string; isDemo?: boolean; now: string }): void {
    this.tdb.run("INSERT INTO performance_periods (id, organization_id, name, period_type, start_date, end_date, is_demo, created_at) VALUES (@id, @organization_id, @name, @periodType, @startDate, @endDate, @isDemo, @now)", { ...p, isDemo: p.isDemo ? 1 : 0 });
  }
  updatePeriod(p: { id: string; name: string; startDate: string; endDate: string }): void {
    this.tdb.run("UPDATE performance_periods SET name = @name, start_date = @startDate, end_date = @endDate WHERE organization_id = @organization_id AND id = @id AND status = 'open'", p);
  }
  setPeriodStatus(id: string, status: string, by: string | null, now: string): void {
    this.tdb.run("UPDATE performance_periods SET status = @status, closed_at = CASE WHEN @status = 'open' THEN NULL ELSE COALESCE(closed_at, @now) END, closed_by_membership_id = CASE WHEN @status = 'open' THEN NULL ELSE COALESCE(closed_by_membership_id, @by) END WHERE organization_id = @organization_id AND id = @id", { id, status, by, now });
  }

  scorecards(periodId?: string): ScorecardRow[] {
    return this.tdb.all<ScorecardRow>(`SELECT ${CARD_COLS} FROM performance_scorecards WHERE organization_id = @organization_id AND (@periodId IS NULL OR period_id = @periodId) ORDER BY created_at, rowid`, { periodId: periodId ?? null });
  }
  scorecard(id: string): ScorecardRow | undefined {
    return this.tdb.get<ScorecardRow>(`SELECT ${CARD_COLS} FROM performance_scorecards WHERE organization_id = @organization_id AND id = @id`, { id });
  }
  scorecardFor(subjectKey: string, periodId: string): ScorecardRow | undefined {
    return this.tdb.get<ScorecardRow>(`SELECT ${CARD_COLS} FROM performance_scorecards WHERE organization_id = @organization_id AND subject_key = @subjectKey AND period_id = @periodId`, { subjectKey, periodId });
  }
  insertScorecard(c: { id: string; subjectKey: string; membershipId: string | null; periodId: string; modelId: string; isDemo?: boolean; now: string }): void {
    this.tdb.run("INSERT INTO performance_scorecards (id, organization_id, subject_type, subject_key, subject_membership_id, period_id, scoring_model_id, is_demo, created_at) VALUES (@id, @organization_id, 'membership', @subjectKey, @membershipId, @periodId, @modelId, @isDemo, @now)", { ...c, isDemo: c.isDemo ? 1 : 0 });
  }
  /** The one place a scorecard changes: which run is the latest, and which model it is scored with. The runs themselves never change. */
  pointScorecard(id: string, scoreId: string, modelId: string, status: string): void {
    this.tdb.run("UPDATE performance_scorecards SET latest_score_id = @scoreId, scoring_model_id = @modelId, status = @status WHERE organization_id = @organization_id AND id = @id", { id, scoreId, modelId, status });
  }

  /** Runs without the (large) stored inputs and model. */
  scoresOf(scorecardId: string): ScoreRow[] {
    return this.tdb.all<ScoreRow>(`SELECT ${SCORE_COLS_LIGHT} FROM performance_scores WHERE organization_id = @organization_id AND scorecard_id = @scorecardId ORDER BY run_number`, { scorecardId });
  }
  latestScores(periodId: string): ScoreRow[] {
    return this.tdb.all<ScoreRow>(`SELECT s.id AS id, s.scorecard_id AS scorecard_id, s.run_number AS run_number, s.scoring_model_id AS scoring_model_id, s.model_version AS model_version, s.engine_version AS engine_version, s.status AS status, s.total_score AS total_score, s.confidence AS confidence, s.weight_coverage AS weight_coverage, s.inputs_hash AS inputs_hash, s.trigger AS trigger, s.explanation_json AS explanation_json, '' AS inputs_json, '' AS model_json, s.computed_at AS computed_at, s.computed_by_membership_id AS computed_by_membership_id FROM performance_scores s JOIN performance_scorecards c ON c.latest_score_id = s.id AND c.organization_id = @organization_id WHERE s.organization_id = @organization_id AND c.period_id = @periodId`, { periodId });
  }
  score(id: string): ScoreRow | undefined {
    return this.tdb.get<ScoreRow>(`SELECT ${SCORE_COLS} FROM performance_scores WHERE organization_id = @organization_id AND id = @id`, { id });
  }
  latestHash(scorecardId: string): { hash: string; run: number } | undefined {
    const r = this.tdb.get<{ inputs_hash: string; run_number: number }>("SELECT inputs_hash, run_number FROM performance_scores WHERE organization_id = @organization_id AND scorecard_id = @scorecardId ORDER BY run_number DESC LIMIT 1", { scorecardId });
    return r ? { hash: r.inputs_hash, run: r.run_number } : undefined;
  }
  insertScore(s: { id: string; scorecardId: string; run: number; modelId: string; modelVersion: number; engineVersion: string; status: string; total: number | null; confidence: number; weightCoverage: number; hash: string; trigger: string; explanationJson: string; inputsJson: string; modelJson: string; by: string | null; now: string }): void {
    this.tdb.run(
      "INSERT INTO performance_scores (id, organization_id, scorecard_id, run_number, scoring_model_id, model_version, engine_version, status, total_score, confidence, weight_coverage, inputs_hash, trigger, explanation_json, inputs_json, model_json, computed_at, computed_by_membership_id) VALUES (@id, @organization_id, @scorecardId, @run, @modelId, @modelVersion, @engineVersion, @status, @total, @confidence, @weightCoverage, @hash, @trigger, @explanationJson, @inputsJson, @modelJson, @now, @by)",
      s,
    );
  }
  componentsOf(scoreId: string): ScoreComponentRow[] {
    return this.tdb.all<ScoreComponentRow>(`SELECT ${SC_COLS} FROM performance_score_components WHERE organization_id = @organization_id AND score_id = @scoreId ORDER BY rowid`, { scoreId });
  }
  insertScoreComponent(c: { id: string; scoreId: string; key: string; label: string; providerKey: string; raw: number | null; normalized: number | null; weight: number; effective: number; points: number | null; state: string; sample: number; minSample: number; coverage: number; inputsJson: string; notesJson: string }): void {
    this.tdb.run(
      "INSERT INTO performance_score_components (id, organization_id, score_id, component_key, label, provider_key, raw_value, normalized_score, weight, effective_weight, contribution_points, data_state, sample_size, min_sample, coverage, inputs_json, notes_json) VALUES (@id, @organization_id, @scoreId, @key, @label, @providerKey, @raw, @normalized, @weight, @effective, @points, @state, @sample, @minSample, @coverage, @inputsJson, @notesJson)",
      c,
    );
  }
}
