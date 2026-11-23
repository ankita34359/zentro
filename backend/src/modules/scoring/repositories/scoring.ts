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
