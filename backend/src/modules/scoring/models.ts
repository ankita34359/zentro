import type { TenantCtx } from "../../db/tenant.js";
import { HttpError, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import type { AuditService } from "../audit/service.js";
import type { AuthStore } from "../auth/repositories/store.js";
import type { AuthContext, AuthService } from "../auth/service.js";
import type { Capabilities } from "../permissions/service.js";
import { computeScore } from "./engine/engine.js";
import { PROVIDERS } from "./engine/registry.js";
import { DEFAULT_BANDS, TEMPLATES, type Template } from "./engine/templates.js";
import type { Band, ComponentResult, DataState, Explanation, ModelDef, ScoreInputs, Status } from "./engine/types.js";
import type { ComponentRow, ModelRow, ScoringRepository } from "./repositories/scoring.js";

export interface ComponentView { key: string; label: string; weight: number; providerKey: string; minSample: number; config: Record<string, unknown>; sortOrder: number }
export interface ModelView {
  id: string;
  name: string;
  templateKey: string | null;
  version: number;
  status: "draft" | "active" | "retired";
  roleFamily: { id: string; name: string } | null;
  designation: { id: string; name: string } | null;
  isDefault: boolean;
  minWeightCoverage: number;
  minConfidenceForFinal: number;
  bands: Band[];
  components: ComponentView[];
  weightTotal: number;
  isDemo: boolean;
  /** Whether it can be activated as it stands, and if not, why. */
  problems: string[];
}
export interface ModelInput {
  name?: string;
  roleFamilyId?: string | null;
  designationId?: string | null;
  isDefault?: boolean;
  minWeightCoverage?: number;
  minConfidenceForFinal?: number;
  bands?: Band[];
  components?: { key: string; label: string; weight: number; providerKey: string; minSample?: number; config?: Record<string, unknown> }[];
}

export const providerKeys = (): string[] => [...Object.keys(PROVIDERS), "mentorship.mentee_growth", "mentorship.development", "mentorship.activity", "team.development", "mgmt.responsibilities", "dept.team_performance", "dept.contribution", "leadership.strategic_execution", "org.health"].sort();

const parse = (s: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(s) as unknown;
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
const bandsOf = (row: ModelRow): Band[] => {
  const b = parse(row.config_json).bands;
  return Array.isArray(b) && b.every((x) => typeof x === "object" && x !== null && typeof (x as Band).min === "number" && typeof (x as Band).label === "string") ? (b as Band[]) : DEFAULT_BANDS;
};

/** The engine's view of a stored model. */
export function toModelDef(row: ModelRow, comps: ComponentRow[]): ModelDef {
  return {
    name: row.name, version: row.version, minWeightCoverage: row.min_weight_coverage, minConfidenceForFinal: row.min_confidence_for_final, bands: bandsOf(row),
    components: comps.filter((c) => c.scoring_model_id === row.id).map((c) => ({ key: c.component_key, label: c.label, weight: c.weight, providerKey: c.provider_key, minSample: c.min_sample, sortOrder: c.sort_order, config: parse(c.config_json) })),
  };
}

/** Seeds the role templates for an organization that has none: all active, version 1, the Employee model the default. Idempotent. */
export function seedTemplates(repo: ScoringRepository, createdBy: string, now: string, opts: { isDemo?: boolean; only?: string[]; designationId?: string } = {}): ModelRow[] {
  const out: ModelRow[] = [];
  for (const t of TEMPLATES.filter((x) => !opts.only || opts.only.includes(x.key))) {
    const id = newId();
    repo.insertModel({ id, name: opts.isDemo ? `${t.name} (demo)` : t.name, templateKey: t.key, version: 1, status: "active", roleFamilyId: null, designationId: opts.designationId ?? null, isDefault: t.isDefault && !opts.isDemo, minWeightCoverage: 0.6, minConfidenceForFinal: 0.6, configJson: JSON.stringify({ bands: DEFAULT_BANDS }), supersedesId: null, createdBy, isDemo: opts.isDemo, now });
    t.components.forEach((c, i) => repo.insertComponent({ id: newId(), modelId: id, key: c.key, label: c.label, weight: c.weight, providerKey: c.providerKey, minSample: c.minSample, configJson: JSON.stringify(c.config), sortOrder: i }));
    out.push(repo.model(id)!);
  }
  return out;
}

function validate(components: NonNullable<ModelInput["components"]>): string[] {
  const problems: string[] = [];
  if (components.length === 0) problems.push("A model needs at least one component.");
  const keys = new Set<string>();
  const known = new Set(providerKeys());
  for (const c of components) {
    if (keys.has(c.key)) problems.push(`The component key "${c.key}" is used twice.`);
    keys.add(c.key);
    if (!known.has(c.providerKey)) problems.push(`"${c.label}" uses a measure that does not exist (${c.providerKey}).`);
    if (!(c.weight > 0)) problems.push(`"${c.label}" needs a weight above 0.`);
  }
  const total = components.reduce((n, c) => n + c.weight, 0);
  if (Math.abs(total - 100) > 1e-9) problems.push(`The weights add up to ${Math.round(total * 100) / 100}, not 100.`);
  return problems;
}

/**
 * Scoring models (stage 5.1). Weights and minimums are DATA, edited here; the providers (what each component measures) are code.
 * A model can only be activated when its weights add up to exactly 100. Editing an active model creates the next version as a
 * draft; activating it retires the one it replaces, and scores already stored keep pointing at the version they used.
 */
export class ModelService {
  constructor(private readonly o: { store: AuthStore; auth: AuthService; audit: AuditService }) {}

  private ctx(auth: AuthContext, requestId: string): TenantCtx {
    return this.o.auth.tenantCtx(auth, requestId);
  }
  private now = (): string => this.o.auth.iso();
  private requireConfigure(caps: Capabilities): void {
    if (!caps.scope("performance.configure").all) throw new HttpError(403, "permission_denied", "You cannot change scoring models.");
  }

  /** The templates are seeded once, the first time anyone opens scoring. */
  ensureSeeded(ctx: TenantCtx): void {
    const tdb = this.o.store.tenant(ctx);
    const repo = this.o.store.scoring(tdb);
    if (repo.realModelCount() > 0) return;
    this.o.store.transaction(() => {
      if (repo.realModelCount() > 0) return;
      const made = seedTemplates(repo, ctx.membershipId, this.now());
      this.o.audit.record(tdb, ctx, { action: "scoring.seed", entityType: "scoring_model", entityId: null, summary: `Added the ${made.length} standard scoring models (Employee, Intern, Team lead, Manager, Mentor, Department head, Senior management, CEO)`, after: { models: made.map((m) => m.name) } });
    });
  }

  private view(w: { repo: ScoringRepository; families: Map<string, string>; designations: Map<string, string> }, row: ModelRow, comps: ComponentRow[]): ModelView {
    const def = toModelDef(row, comps);
    const cv = def.components.map((c): ComponentView => ({ key: c.key, label: c.label, weight: c.weight, providerKey: c.providerKey, minSample: c.minSample, config: c.config, sortOrder: c.sortOrder }));
    return {
      id: row.id, name: row.name, templateKey: row.template_key, version: row.version, status: row.status as ModelView["status"],
      roleFamily: row.role_family_id ? { id: row.role_family_id, name: w.families.get(row.role_family_id) ?? "Role family" } : null,
      designation: row.designation_id ? { id: row.designation_id, name: w.designations.get(row.designation_id) ?? "Designation" } : null,
      isDefault: row.is_default === 1, minWeightCoverage: row.min_weight_coverage, minConfidenceForFinal: row.min_confidence_for_final, bands: def.bands, components: cv,
      weightTotal: Math.round(cv.reduce((n, c) => n + c.weight, 0) * 100) / 100, isDemo: row.is_demo === 1,
      problems: validate(cv.map((c) => ({ key: c.key, label: c.label, weight: c.weight, providerKey: c.providerKey }))),
    };
  }
  private world(ctx: TenantCtx) {
    const tdb = this.o.store.tenant(ctx);
    const structure = this.o.store.structure(tdb);
    return { tdb, repo: this.o.store.scoring(tdb), families: new Map(structure.roleFamilies().map((f) => [f.id, f.name])), designations: new Map(structure.designations().map((d) => [d.id, d.name])), structure };
  }

  list(auth: AuthContext, requestId: string, caps: Capabilities, q: { includeRetired?: boolean }): ModelView[] {
    if (!caps.has("performance.view_components")) throw new HttpError(403, "permission_denied", "Not allowed");
    const ctx = this.ctx(auth, requestId);
    this.ensureSeeded(ctx);
    const w = this.world(ctx);
    const comps = w.repo.components();
    return w.repo.models(q.includeRetired === true).map((m) => this.view(w, m, comps.filter((c) => c.scoring_model_id === m.id)));
  }

  templates(): { key: string; name: string; description: string; components: { label: string; weight: number; providerKey: string }[] }[] {
    return TEMPLATES.map((t: Template) => ({ key: t.key, name: t.name, description: t.description, components: t.components.map((c) => ({ label: c.label, weight: c.weight, providerKey: c.providerKey })) }));
  }

  detail(auth: AuthContext, requestId: string, caps: Capabilities, id: string): ModelView {
    if (!caps.has("performance.view_components")) throw new HttpError(403, "permission_denied", "Not allowed");
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const m = w.repo.model(id);
    if (!m) throw notFound();
    return this.view(w, m, w.repo.components(id));
  }

  /** A new model: from a standard template, as a draft (give it a name that is not in use). */
  create(auth: AuthContext, requestId: string, caps: Capabilities, input: { templateKey: string; name?: string }): ModelView {
    this.requireConfigure(caps);
    const ctx = this.ctx(auth, requestId);
    this.ensureSeeded(ctx);
    const w = this.world(ctx);
    const t = TEMPLATES.find((x) => x.key === input.templateKey);
    if (!t) throw new HttpError(400, "unknown_template", `A template is one of: ${TEMPLATES.map((x) => x.key).join(", ")}.`);
    const name = (input.name ?? `${t.name} (copy)`).replace(/\s+/g, " ").trim();
    if (name.length < 1 || name.length > 80) throw new HttpError(400, "invalid_title", "A model name is 1 to 80 characters.");
    if (w.repo.models().some((m) => m.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, "name_taken", `A model named "${name}" already exists. Edit it instead, or choose another name.`);
    const id = newId();
    this.o.store.transaction(() => {
      w.repo.insertModel({ id, name, templateKey: t.key, version: 1, status: "draft", roleFamilyId: null, designationId: null, isDefault: false, minWeightCoverage: 0.6, minConfidenceForFinal: 0.6, configJson: JSON.stringify({ bands: DEFAULT_BANDS }), supersedesId: null, createdBy: ctx.membershipId, now: this.now() });
      t.components.forEach((c, i) => w.repo.insertComponent({ id: newId(), modelId: id, key: c.key, label: c.label, weight: c.weight, providerKey: c.providerKey, minSample: c.minSample, configJson: JSON.stringify(c.config), sortOrder: i }));
      this.o.audit.record(w.tdb, ctx, { action: "scoring.model_create", entityType: "scoring_model", entityId: id, summary: `Created the scoring model "${name}" from the ${t.name} template (draft)`, after: { template: t.key } });
    });
    return this.detail(auth, requestId, caps, id);
  }

  /** Edits a draft in place; editing an ACTIVE or retired model creates the next version as a draft (the old one is untouched). */
  update(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: ModelInput): ModelView {
    this.requireConfigure(caps);
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const cur = w.repo.model(id);
    if (!cur) throw notFound();
    const curComps = w.repo.components(id);
    const name = (input.name ?? cur.name).replace(/\s+/g, " ").trim();
    if (name.length < 1 || name.length > 80) throw new HttpError(400, "invalid_title", "A model name is 1 to 80 characters.");
    const mwc = input.minWeightCoverage ?? cur.min_weight_coverage;
    const mcf = input.minConfidenceForFinal ?? cur.min_confidence_for_final;
    if (!(mwc > 0 && mwc <= 1) || !(mcf >= 0 && mcf <= 1)) throw new HttpError(400, "invalid_number", "Coverage and confidence minimums are between 0 and 1 (coverage above 0).");
    const bands = input.bands ?? bandsOf(cur);
    if (bands.length === 0 || !bands.some((b) => b.min === 0)) throw new HttpError(400, "invalid_bands", "The bands need one that starts at 0.");
    if (input.roleFamilyId && !w.families.has(input.roleFamilyId)) throw notFound();
    if (input.designationId && !w.designations.has(input.designationId)) throw notFound();
    const components = input.components ?? toModelDef(cur, curComps).components.map((c) => ({ key: c.key, label: c.label, weight: c.weight, providerKey: c.providerKey, minSample: c.minSample, config: c.config }));
    for (const c of components) {
      if (!Number.isFinite(c.weight) || c.weight < 0 || c.weight > 100) throw new HttpError(400, "invalid_number", `The weight of "${c.label}" must be a number from 0 to 100.`);
      if ((c.minSample ?? 1) < 0 || !Number.isInteger(c.minSample ?? 1)) throw new HttpError(400, "invalid_number", `The minimum sample of "${c.label}" must be a whole number.`);
    }
    if (name.toLowerCase() !== cur.name.toLowerCase() && w.repo.models().some((m) => m.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, "name_taken", `A model named "${name}" already exists.`);
    const fresh = cur.status !== "draft";
    const targetId = fresh ? newId() : id;
    const version = fresh ? Math.max(...w.repo.models().filter((m) => m.name === cur.name).map((m) => m.version)) + 1 : cur.version;
    if (fresh && w.repo.models().some((m) => m.name === cur.name && m.status === "draft")) throw new HttpError(409, "draft_exists", "This model already has a draft version. Edit that one.");
    this.o.store.transaction(() => {
      const row = { id: targetId, name: fresh ? cur.name : name, roleFamilyId: input.roleFamilyId === undefined ? cur.role_family_id : input.roleFamilyId, designationId: input.designationId === undefined ? cur.designation_id : input.designationId, isDefault: input.isDefault ?? cur.is_default === 1, minWeightCoverage: mwc, minConfidenceForFinal: mcf, configJson: JSON.stringify({ bands }), now: this.now() };
      if (fresh) w.repo.insertModel({ ...row, templateKey: cur.template_key, version, status: "draft", supersedesId: cur.id, createdBy: ctx.membershipId });
      else {
        w.repo.updateModel(row);
        w.repo.deleteComponents(id);
      }
      components.forEach((c, i) => w.repo.insertComponent({ id: newId(), modelId: targetId, key: c.key, label: c.label, weight: c.weight, providerKey: c.providerKey, minSample: c.minSample ?? 1, configJson: JSON.stringify(c.config ?? {}), sortOrder: i }));
      this.o.audit.record(w.tdb, ctx, {
        action: "scoring.model_update", entityType: "scoring_model", entityId: targetId,
        summary: fresh ? `Started version ${version} of the scoring model "${cur.name}" (draft; version ${cur.version} stays as it is)` : `Changed the draft of the scoring model "${name}"`,
        before: { version: cur.version, weights: curComps.map((c) => [c.component_key, c.weight]) }, after: { version, weights: components.map((c) => [c.key, c.weight]) },
      });
    });
    return this.detail(auth, requestId, caps, targetId);
  }

  /** Makes a draft the model in use: weights must add up to exactly 100. The version it replaces is retired. */
  activate(auth: AuthContext, requestId: string, caps: Capabilities, id: string): ModelView {
    this.requireConfigure(caps);
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const m = w.repo.model(id);
    if (!m) throw notFound();
    if (m.status === "active") throw new HttpError(409, "already_active", "This version is already active.");
    if (m.status === "retired") throw new HttpError(409, "retired", "A retired version cannot be activated. Edit it to start a new version.");
    const view = this.view(w, m, w.repo.components(id));
    if (view.problems.length > 0) throw new HttpError(400, "model_invalid", view.problems[0]!, { problems: view.problems });
    this.o.store.transaction(() => {
      const now = this.now();
      for (const other of w.repo.models()) if (other.id !== id && other.name === m.name && other.status === "active") w.repo.setStatus(other.id, "retired", now);
      w.repo.setStatus(id, "active", now);
      if (m.is_default === 1) w.repo.clearDefaultExcept(id, now);
      this.o.audit.record(w.tdb, ctx, { action: "scoring.model_activate", entityType: "scoring_model", entityId: id, summary: `Activated version ${m.version} of the scoring model "${m.name}"`, after: { version: m.version } });
    });
    return this.detail(auth, requestId, caps, id);
  }

  // ---------- what-if (stores nothing) ----------

  /**
   * Runs a model on values someone types in, or on a snapshot, in dry-run mode: nothing is stored. `values` give a component a
   * score directly (null = no data). This is the calculator under Settings → Scoring.
   */
  preview(auth: AuthContext, requestId: string, caps: Capabilities, input: { modelId: string; values: Record<string, number | null>; periodClosed?: boolean }): { total: number | null; status: Status; weightCoverage: number; confidence: number; components: ComponentResult[]; explanation: Explanation } {
    this.requireConfigure(caps);
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const m = w.repo.model(input.modelId);
    if (!m) throw notFound();
    const def = toModelDef(m, w.repo.components(m.id));
    const overrides: NonNullable<ScoreInputs["overrides"]> = {};
    for (const c of def.components) {
      const v = input.values[c.key];
      overrides[c.key] = { value: v === undefined || v === null ? null : Math.min(100, Math.max(0, Number(v))), state: (v === undefined || v === null ? "missing" : "ok") as DataState };
      if (v !== undefined && v !== null && !Number.isFinite(Number(v))) throw new HttpError(400, "invalid_number", `The value for "${c.label}" must be a number.`);
    }
    const result = computeScore({ subject: { type: "membership", id: "what-if", label: "What-if" }, period: { start: "2000-01-01", end: "2000-12-31", open: input.periodClosed === false }, asOf: "2000-12-31", objectives: { personal: [], team: [], department: [], company: [] }, kpis: [], teamKpis: [], tasks: [], teamTasks: [], overrides }, def);
    return { total: result.total, status: result.status, weightCoverage: result.weightCoverage, confidence: result.confidence, components: result.components, explanation: result.explanation };
  }
}
