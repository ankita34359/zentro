import { createHash } from "node:crypto";
import type { TenantCtx, TenantDb } from "../../db/tenant.js";
import { HttpError, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import type { AuditService } from "../audit/service.js";
import type { AuthStore } from "../auth/repositories/store.js";
import type { AuthContext, AuthService } from "../auth/service.js";
import type { Capabilities } from "../permissions/service.js";
import { todayIn } from "../tasks/dates.js";
import { Collector, type PeriodInfo } from "./collector.js";
import { canonicalJson } from "./engine/canonical.js";
import { computeScore, ENGINE_VERSION } from "./engine/engine.js";
import type { ComponentResult, Explanation, ModelDef, ScoreInputs, ScoreResult } from "./engine/types.js";
import { seedTemplates, toModelDef } from "./models.js";
import type { ModelRow, PeriodRow, ScoreComponentRow, ScoreRow, ScorecardRow } from "./repositories/scoring.js";

export const PERIOD_TYPES = ["month", "quarter", "year", "custom"] as const;
export type Trigger = "scheduled" | "manual" | "period_close" | "recalculation";

export interface PeriodView { id: string; name: string; periodType: string; startDate: string; endDate: string; status: "open" | "closed" | "locked"; closedAt: string | null; isDemo: boolean; scorecards: number }
export interface ScoreSummary { scoreId: string; runNumber: number; status: "final" | "provisional" | "insufficient"; total: number | null; band: string | null; confidence: number; confidenceLabel: string; weightCoverage: number; modelName: string; modelVersion: number; computedAt: string; trigger: string }
export interface ScorecardSummary extends ScoreSummary { scorecardId: string; subject: { id: string; name: string }; periodId: string; isDemo: boolean }
export interface ComponentView { key: string; label: string; providerKey: string; state: "ok" | "insufficient" | "missing"; score: number | null; weight: number; effectiveWeight: number; points: number | null; sampleSize: number; minSample: number; coverage: number; stateText: string; contributors: { ref: { type: string; id: string }; label: string; value: number | null; target?: number | null; weight: number; note?: string }[]; notes: string[] }
export interface ScoreDetail extends ScoreSummary {
  scorecardId: string;
  subject: { id: string; name: string };
  period: { id: string; name: string; startDate: string; endDate: string; status: string };
  /** Hidden from people who may see the total but not what it is made of (`performance.view_components`). */
  componentsHidden: boolean;
  components: ComponentView[];
  explanation: Explanation | null;
  engineVersion: string;
  isLatest: boolean;
}
export interface ScorecardDetail { scorecardId: string; subject: { id: string; name: string }; period: PeriodView; latest: ScoreDetail | null; runs: ScoreSummary[]; can: { recalculate: boolean; components: boolean } }
export interface VerifyResult { matches: boolean; expected: { total: number | null; status: string }; actual: { total: number | null; status: string }; engineVersion: string; modelVersion: number; mismatches: string[] }

const isDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
const labelOf = (c: number): string => (c >= 0.8 ? "high" : c >= 0.5 ? "medium" : "low");

/**
 * Periods, scorecards and score runs (stage 5.2). The collector reads the records, the pure engine scores them, and a run is stored
 * only when its inputs or outcome changed: runs are immutable and the list of runs is the score-change history. Everyone always
 * sees their own scorecard and what it is made of; others only inside `performance.view_scores` / `performance.view_components`.
 */
export class PerformanceService {
  constructor(private readonly o: { store: AuthStore; auth: AuthService; audit: AuditService }) {}

  private ctx(auth: AuthContext, requestId: string): TenantCtx {
    return this.o.auth.tenantCtx(auth, requestId);
  }
  private now = (): string => this.o.auth.iso();
  private today(ctx: TenantCtx): string {
    const org = this.o.store.orgs.findById(ctx.organizationId);
    return todayIn(org?.timezone ?? "UTC", new Date(this.now()));
  }
  private world(ctx: TenantCtx) {
    const tdb = this.o.store.tenant(ctx);
    const people = this.o.store.people(tdb);
    return { tdb, cards: this.o.store.scorecards(tdb), models: this.o.store.scoring(tdb), people, names: new Map(people.people().map((p) => [p.id, p.display_name])), today: this.today(ctx) };
  }

  // ---------- periods ----------

  private periodView(row: PeriodRow, cards: number): PeriodView {
    return { id: row.id, name: row.name, periodType: row.period_type, startDate: row.start_date, endDate: row.end_date, status: row.status as PeriodView["status"], closedAt: row.closed_at, isDemo: row.is_demo === 1, scorecards: cards };
  }
  periods(auth: AuthContext, requestId: string, caps: Capabilities): PeriodView[] {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const counts = new Map<string, number>();
    // a period shows how many scorecards the CALLER may open (their own, and those inside their scope), never the organization's total
    for (const c of w.cards.scorecards()) if (c.subject_membership_id && this.access(caps, ctx.membershipId, c.subject_membership_id).scores) counts.set(c.period_id, (counts.get(c.period_id) ?? 0) + 1);
    return w.cards.periods().map((p) => this.periodView(p, counts.get(p.id) ?? 0));
  }
  private requirePeriods(caps: Capabilities): void {
    if (!caps.scope("performance.manage_periods").all) throw new HttpError(403, "permission_denied", "You cannot manage periods.");
  }
  private cleanPeriod(input: { name?: string; periodType?: string; startDate?: string; endDate?: string }, base?: PeriodRow) {
    const name = (input.name ?? base?.name ?? "").replace(/\s+/g, " ").trim();
    if (name.length < 1 || name.length > 60) throw new HttpError(400, "invalid_title", "A period name is 1 to 60 characters.");
    const startDate = input.startDate ?? base?.start_date ?? "";
    const endDate = input.endDate ?? base?.end_date ?? "";
    if (!isDay(startDate) || !isDay(endDate) || endDate < startDate) throw new HttpError(400, "invalid_date", "A period needs a real start date and an end date that is not before it.");
    const periodType = input.periodType ?? base?.period_type ?? "quarter";
    if (!(PERIOD_TYPES as readonly string[]).includes(periodType)) throw new HttpError(400, "invalid_value", `A period type is one of: ${PERIOD_TYPES.join(", ")}.`);
    return { name, periodType, startDate, endDate };
  }
  createPeriod(auth: AuthContext, requestId: string, caps: Capabilities, input: { name: string; periodType?: string; startDate: string; endDate: string }): PeriodView {
    this.requirePeriods(caps);
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const c = this.cleanPeriod(input);
    if (w.cards.periods().some((p) => p.name.toLowerCase() === c.name.toLowerCase())) throw new HttpError(409, "name_taken", `A period named "${c.name}" already exists.`);
    const id = newId();
    this.o.store.transaction(() => {
      w.cards.insertPeriod({ id, ...c, now: this.now() });
      this.o.audit.record(w.tdb, ctx, { action: "performance.period_create", entityType: "performance_period", entityId: id, summary: `Created the performance period "${c.name}" (${c.startDate} to ${c.endDate})`, after: c });
    });
    return this.periodView(w.cards.period(id)!, 0);
  }
  updatePeriod(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: { name?: string; startDate?: string; endDate?: string }): PeriodView {
    this.requirePeriods(caps);
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const p = w.cards.period(id);
    if (!p) throw notFound();
    if (p.status !== "open") throw new HttpError(409, "period_closed", "A closed period cannot be changed. Reopen it first.");
    const c = this.cleanPeriod(input, p);
    if (w.cards.periods().some((x) => x.id !== id && x.name.toLowerCase() === c.name.toLowerCase())) throw new HttpError(409, "name_taken", `A period named "${c.name}" already exists.`);
    this.o.store.transaction(() => {
      w.cards.updatePeriod({ id, name: c.name, startDate: c.startDate, endDate: c.endDate });
      this.o.audit.record(w.tdb, ctx, { action: "performance.period_update", entityType: "performance_period", entityId: id, summary: `Changed the performance period "${c.name}"`, before: { name: p.name, startDate: p.start_date, endDate: p.end_date }, after: c });
    });
    return this.periodView(w.cards.period(id)!, w.cards.scorecards(id).length);
  }

  // ---------- model resolution and running ----------

  /** The active model for a person as of the period end: their designation's, else their role family's, else the default. */
  resolveModel(models: ModelRow[], designationId: string | null, familyId: string | null): ModelRow | undefined {
    const active = models.filter((m) => m.status === "active" && m.subject_type === "membership");
    return (designationId ? active.find((m) => m.designation_id === designationId) : undefined) ?? (familyId ? active.find((m) => m.role_family_id === familyId && m.designation_id === null) : undefined) ?? active.find((m) => m.is_default === 1 && m.is_demo === 0);
  }

  /** Demo hook (stage 5.3 closes the older demo period here). */
  prepareDemoPeriods(_tdb: TenantDb, _ctx: TenantCtx, _periodIds: string[], _today: string): void {
    // nothing to prepare yet
  }

  /** The first time anything is scored the standard models are added (an organization that never opened Scoring still works). */
  ensureModels(ctx: TenantCtx, w: { tdb: TenantDb; models: ReturnType<AuthStore["scoring"]> }): void {
    if (w.models.realModelCount() > 0) return;
    seedTemplates(w.models, ctx.membershipId, this.now());
    this.o.audit.record(w.tdb, ctx, { action: "scoring.seed", entityType: "scoring_model", entityId: null, summary: "Added the standard scoring models" });
  }

  /**
   * Scores one person for a period and stores a new run when the inputs or the outcome changed since the last one. `collector`
   * is built once for the period and reused for many people. Returns the run (new or the unchanged latest).
   */
  runFor(tdb: TenantDb, ctx: TenantCtx | null, collector: Collector, period: PeriodRow, m: string, name: string, trigger: Trigger, isDemo = false): { scoreId: string; created: boolean; changedFrom: number | null } | null {
    const cards = this.o.store.scorecards(tdb);
    const models = this.o.store.scoring(tdb);
    const rows = models.models();
    const model = this.resolveModel(rows, collector.designationOn(m), collector.roleFamilyOn(m));
    if (!model) return null;
    // the engine scores the CANONICAL form of the snapshot and the model (the very text that is stored), so a later verification reproduces it exactly
    const def = JSON.parse(canonicalJson(toModelDef(model, models.components(model.id)))) as ModelDef;
    const inputs = JSON.parse(canonicalJson(collector.inputsFor(m, name))) as ScoreInputs;
    const result = computeScore(inputs, def);
    const { asOf: _asOf, ...stable } = inputs;
    void _asOf;
    const outcome = { total: result.total, status: result.status, components: result.components.map((c) => [c.key, c.state, c.rawValue]) };
    const hash = sha(canonicalJson({ inputs: stable, model: { id: model.id, def }, engine: ENGINE_VERSION, outcome }));
    const key = `m:${m}`;
    let card = cards.scorecardFor(key, period.id);
    const last = card ? cards.latestHash(card.id) : undefined;
    if (card && last && last.hash === hash && card.scoring_model_id === model.id) return { scoreId: card.latest_score_id!, created: false, changedFrom: null };
    const now = this.now();
    if (!card) {
      const id = newId();
      cards.insertScorecard({ id, subjectKey: key, membershipId: m, periodId: period.id, modelId: model.id, isDemo, now });
      card = cards.scorecard(id)!;
    }
    const scoreId = newId();
    const run = (last?.run ?? 0) + 1;
    cards.insertScore({ id: scoreId, scorecardId: card.id, run, modelId: model.id, modelVersion: model.version, engineVersion: ENGINE_VERSION, status: result.status, total: result.total, confidence: result.confidence, weightCoverage: result.weightCoverage, hash, trigger, explanationJson: JSON.stringify(result.explanation), inputsJson: canonicalJson(inputs), modelJson: canonicalJson(def), by: ctx?.membershipId ?? null, now });
    for (const c of result.components) {
      cards.insertScoreComponent({ id: newId(), scoreId, key: c.key, label: c.label, providerKey: c.providerKey, raw: c.rawValue, normalized: c.score, weight: c.weight, effective: c.effectiveWeight, points: c.points, state: c.state, sample: c.sampleSize, minSample: c.minSample, coverage: c.coverage, inputsJson: JSON.stringify(c.contributors), notesJson: JSON.stringify(c.notes) });
    }
    cards.pointScorecard(card.id, scoreId, model.id, period.status === "open" ? "open" : "final");
    return { scoreId, created: true, changedFrom: last?.run ?? null };
  }

  /** People scored by default: everyone who is part of the organization (live), inside the given set when one is given. */
  recalculate(auth: AuthContext, requestId: string, caps: Capabilities, input: { periodId: string; subjectId?: string }, trigger: Trigger = "manual"): { periodId: string; scored: number; unchanged: number; skipped: number } {
    if (!caps.has("performance.recalculate")) throw new HttpError(403, "permission_denied", "You cannot recalculate scores.");
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const period = w.cards.period(input.periodId);
    if (!period) throw notFound();
    const scope = caps.scope("performance.recalculate");
    const live = w.people.people().filter((p) => p.archived_at === null && p.status !== "left");
    let targets = live;
    if (input.subjectId) {
      const p = w.people.person(input.subjectId);
      if (!p || !(scope.all || scope.members.has(p.id))) throw notFound();
      if (p.archived_at !== null) throw new HttpError(409, "archived", `${p.display_name} no longer belongs to the organization.`);
      targets = [p];
    } else targets = live.filter((p) => scope.all || scope.members.has(p.id));
    if (targets.length > 400) throw new HttpError(400, "too_many", "Calculate for a smaller group at a time.");
    let scored = 0;
    let unchanged = 0;
    let skipped = 0;
    this.o.store.transaction(() => {
      this.ensureModels(ctx, w);
      const info: PeriodInfo = { id: period.id, start: period.start_date, end: period.end_date, open: period.status === "open" };
      const collector = new Collector(w.tdb, info, w.today);
      for (const p of targets) {
        const r = this.runFor(w.tdb, ctx, collector, period, p.id, p.display_name, trigger);
        if (!r) skipped += 1;
        else if (r.created) scored += 1;
        else unchanged += 1;
      }
      this.o.audit.record(w.tdb, ctx, { action: "performance.recalculate", entityType: "performance_period", entityId: period.id, summary: `Calculated scores for ${targets.length} ${targets.length === 1 ? "person" : "people"} for "${period.name}": ${scored} new ${scored === 1 ? "run" : "runs"}, ${unchanged} unchanged${skipped ? `, ${skipped} without a model` : ""}`, after: { scored, unchanged, skipped } });
    });
    return { periodId: period.id, scored, unchanged, skipped };
  }

  // ---------- reading ----------

  private access(caps: Capabilities, me: string, subject: string): { scores: boolean; components: boolean } {
    if (me === subject) return { scores: true, components: true };
    const s = caps.scope("performance.view_scores");
    const c = caps.scope("performance.view_components");
    return { scores: s.all || s.members.has(subject), components: c.all || c.members.has(subject) };
  }
  private summary(score: ScoreRow, model: ModelRow | undefined, band: string | null): ScoreSummary {
    return { scoreId: score.id, runNumber: score.run_number, status: score.status as ScoreSummary["status"], total: score.total_score, band, confidence: Math.round(score.confidence * 100) / 100, confidenceLabel: labelOf(score.confidence), weightCoverage: Math.round(score.weight_coverage * 100) / 100, modelName: model?.name ?? "Model", modelVersion: score.model_version, computedAt: score.computed_at, trigger: score.trigger };
  }
  private bandOf(score: ScoreRow): string | null {
    try {
      return (JSON.parse(score.explanation_json) as Explanation).band;
    } catch {
      return null;
    }
  }

  /** The scorecards of a period the caller may see: their own, and those inside `performance.view_scores`. */
  scorecards(auth: AuthContext, requestId: string, caps: Capabilities, q: { periodId: string; search?: string }): ScorecardSummary[] {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const period = w.cards.period(q.periodId);
    if (!period) throw notFound();
    const modelRows = new Map(w.models.models().map((m) => [m.id, m]));
    const byCard = new Map(w.cards.latestScores(period.id).map((s) => [s.scorecard_id, s]));
    const needle = q.search?.trim().toLowerCase();
    const out: ScorecardSummary[] = [];
    for (const c of w.cards.scorecards(period.id)) {
      const m = c.subject_membership_id;
      const s = byCard.get(c.id);
      if (!m || !s || !this.access(caps, ctx.membershipId, m).scores) continue;
      const name = w.names.get(m) ?? "Former member";
      if (needle && !name.toLowerCase().includes(needle)) continue;
      out.push({ ...this.summary(s, modelRows.get(s.scoring_model_id), this.bandOf(s)), scorecardId: c.id, subject: { id: m, name }, periodId: period.id, isDemo: c.is_demo === 1 });
    }
    return out.sort((a, b) => (b.total ?? -1) - (a.total ?? -1) || a.subject.name.localeCompare(b.subject.name));
  }

  /** One person's scorecard for a period: `subjectId` defaults to the caller. 404 when it does not exist or is not theirs to see. */
  scorecardFor(auth: AuthContext, requestId: string, caps: Capabilities, q: { periodId: string; subjectId?: string }): ScorecardDetail {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const subject = q.subjectId ?? ctx.membershipId;
    const period = w.cards.period(q.periodId);
    if (!period || !w.names.has(subject) || !this.access(caps, ctx.membershipId, subject).scores) throw notFound();
    const card = w.cards.scorecardFor(`m:${subject}`, period.id);
    if (!card) throw notFound();
    return this.cardDetail(w, caps, ctx.membershipId, card, period);
  }
  scorecard(auth: AuthContext, requestId: string, caps: Capabilities, id: string): ScorecardDetail {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const card = w.cards.scorecard(id);
    const subject = card?.subject_membership_id;
    if (!card || !subject || !this.access(caps, ctx.membershipId, subject).scores) throw notFound();
    return this.cardDetail(w, caps, ctx.membershipId, card, w.cards.period(card.period_id)!);
  }
  private cardDetail(w: ReturnType<PerformanceService["world"]>, caps: Capabilities, me: string, card: ScorecardRow, period: PeriodRow): ScorecardDetail {
    const subject = card.subject_membership_id!;
    const acc = this.access(caps, me, subject);
    const models = new Map(w.models.models().map((m) => [m.id, m]));
    const runs = w.cards.scoresOf(card.id);
    const latest = runs.length ? runs[runs.length - 1]! : null;
    const cnt = w.cards.scorecards(period.id).length;
    const scope = caps.scope("performance.recalculate");
    return {
      scorecardId: card.id, subject: { id: subject, name: w.names.get(subject) ?? "Former member" }, period: this.periodView(period, cnt),
      latest: latest ? this.scoreView(w, caps, me, latest.id) : null,
      runs: [...runs].reverse().map((s) => this.summary(s, models.get(s.scoring_model_id), this.bandOf(s))),
      can: { recalculate: caps.has("performance.recalculate") && (scope.all || scope.members.has(subject)), components: acc.components },
    };
  }

  score(auth: AuthContext, requestId: string, caps: Capabilities, id: string): ScoreDetail {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    return this.scoreView(w, caps, ctx.membershipId, id);
  }
  private scoreView(w: ReturnType<PerformanceService["world"]>, caps: Capabilities, me: string, id: string): ScoreDetail {
    const s = w.cards.score(id);
    const card = s ? w.cards.scorecard(s.scorecard_id) : undefined;
    const subject = card?.subject_membership_id;
    if (!s || !card || !subject) throw notFound();
    const acc = this.access(caps, me, subject);
    if (!acc.scores) throw notFound();
    const period = w.cards.period(card.period_id)!;
    const model = w.models.model(s.scoring_model_id);
    const comps = acc.components ? w.cards.componentsOf(s.id) : [];
    const expl = JSON.parse(s.explanation_json) as Explanation;
    return {
      ...this.summary(s, model, expl.band), scorecardId: card.id, subject: { id: subject, name: w.names.get(subject) ?? "Former member" },
      period: { id: period.id, name: period.name, startDate: period.start_date, endDate: period.end_date, status: period.status },
      componentsHidden: !acc.components, components: comps.map((c) => this.componentView(c)), explanation: acc.components ? expl : null, engineVersion: s.engine_version, isLatest: card.latest_score_id === s.id,
    };
  }
  private componentView(c: ScoreComponentRow): ComponentView {
    const stateText = c.data_state === "ok" ? "Enough data" : c.data_state === "insufficient" ? `Not enough data (${c.sample_size} of ${c.min_sample} needed)` : "No data recorded";
    return { key: c.component_key, label: c.label, providerKey: c.provider_key, state: c.data_state as ComponentView["state"], score: c.normalized_score, weight: c.weight, effectiveWeight: c.effective_weight, points: c.contribution_points === null ? null : Math.round(c.contribution_points * 10) / 10, sampleSize: c.sample_size, minSample: c.min_sample, coverage: c.coverage, stateText, contributors: JSON.parse(c.inputs_json) as ComponentView["contributors"], notes: JSON.parse(c.notes_json) as string[] };
  }

  /**
   * "Verify": recomputes the run from the inputs and the model it stored, with the pure engine, and says whether the total, the
   * status and every component come out the same. A visible proof of reproducibility.
   */
  verify(auth: AuthContext, requestId: string, caps: Capabilities, id: string): VerifyResult {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const s = w.cards.score(id);
    const card = s ? w.cards.scorecard(s.scorecard_id) : undefined;
    const subject = card?.subject_membership_id;
    if (!s || !subject) throw notFound();
    const acc = this.access(caps, ctx.membershipId, subject);
    if (!acc.scores) throw notFound();
    if (!acc.components) throw new HttpError(403, "permission_denied", "Verifying needs permission to see what the score is made of.");
    const again: ScoreResult = computeScore(JSON.parse(s.inputs_json) as ScoreInputs, JSON.parse(s.model_json) as ModelDef);
    const stored = w.cards.componentsOf(s.id);
    const mismatches: string[] = [];
    if (again.total !== s.total_score) mismatches.push(`total: stored ${s.total_score}, recomputed ${again.total}`);
    if (again.status !== s.status) mismatches.push(`status: stored ${s.status}, recomputed ${again.status}`);
    for (const c of again.components as ComponentResult[]) {
      const old = stored.find((x) => x.component_key === c.key);
      if (!old) mismatches.push(`${c.label}: not stored`);
      else if (old.normalized_score !== c.score || old.data_state !== c.state) mismatches.push(`${c.label}: stored ${old.normalized_score} (${old.data_state}), recomputed ${c.score} (${c.state})`);
    }
    return { matches: mismatches.length === 0, expected: { total: s.total_score, status: s.status }, actual: { total: again.total, status: again.status }, engineVersion: s.engine_version, modelVersion: s.model_version, mismatches };
  }
}
