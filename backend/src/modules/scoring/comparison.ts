import type { TenantCtx } from "../../db/tenant.js";
import { HttpError, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import type { AuditService } from "../audit/service.js";
import type { AuthStore } from "../auth/repositories/store.js";
import type { AuthContext, AuthService } from "../auth/service.js";
import type { Capabilities } from "../permissions/service.js";
import { todayIn } from "../tasks/dates.js";
import { Collector } from "./collector.js";
import { explainDifference, MIN_RANKED, positions, type DifferencePart, type Normalization } from "./engine/compare.js";
import { daysBetween } from "./engine/math.js";
import type { ScoreInputs } from "./engine/types.js";
import { scoreAccess } from "./performance.js";
import type { ComparisonRow } from "./repositories/scoring.js";

export interface CompareQuery { periodId: string; roleFamilyId?: string; departmentId?: string; subjectIds?: string[]; minTenureDays?: number; includeInsufficient?: boolean }
export interface CompareEntry {
  subject: { id: string; name: string };
  total: number | null;
  status: "final" | "provisional" | "insufficient";
  band: string | null;
  model: string;
  rank: number | null;
  percentile: number | null;
  zScore: number | null;
  isYou: boolean;
  /** Shown beside the numbers, never applied to them. */
  context: { tenureDays: number | null; teamSize: number | null; taskLoad: number; dataCoverage: number; confidence: string; evidence: number };
}
export interface CompareResult {
  period: { id: string; name: string; status: string };
  roleFamily: { id: string; name: string } | null;
  filters: { departmentId: string | null; minTenureDays: number; includeInsufficient: boolean; subjectIds: string[] };
  /** How many people were ranked (the cohort), and how many were left out and why. */
  cohortSize: number;
  excluded: { insufficient: number; tenure: number };
  normalization: Normalization;
  notes: string[];
  /** The caller's own position, whatever their permissions. */
  you: { rank: number | null; of: number; percentile: number | null; zScore: number | null; total: number | null } | null;
  /** Named rows: only people the caller may compare (`performance.compare`) and may see the score of. */
  entries: CompareEntry[];
  hiddenCount: number;
  canSeeNames: boolean;
}
export interface SavedComparison { id: string; name: string; periodId: string; createdBy: { id: string; name: string }; createdAt: string; cohortSize: number; normalization: string }
export interface SavedComparisonDetail extends SavedComparison { result: CompareResult }
export interface Difference { period: { id: string; name: string }; a: { id: string; name: string; total: number | null }; b: { id: string; name: string; total: number | null }; totalDifference: number | null; parts: DifferencePart[] }

/**
 * Peer comparison (stage 5.4, docs/scoring-architecture.md 8.1). The cohort is "same role family, same period", resolved as of the
 * period; different families are never compared (422 cohort_mismatch). Everyone sees their OWN position in the cohort; names and
 * other people's scores need `performance.compare` over them (and a right to see their score). Tenure, team size, task load and data
 * coverage are shown next to the numbers and never applied to them.
 */
export class ComparisonService {
  constructor(private readonly o: { store: AuthStore; auth: AuthService; audit: AuditService }) {}

  private ctx(auth: AuthContext, requestId: string): TenantCtx {
    return this.o.auth.tenantCtx(auth, requestId);
  }
  private now = (): string => this.o.auth.iso();
  private world(ctx: TenantCtx) {
    const tdb = this.o.store.tenant(ctx);
    const people = this.o.store.people(tdb);
    const org = this.o.store.orgs.findById(ctx.organizationId);
    return { tdb, cards: this.o.store.scorecards(tdb), models: this.o.store.scoring(tdb), people, structure: this.o.store.structure(tdb), names: new Map(people.people().map((p) => [p.id, p.display_name])), today: todayIn(org?.timezone ?? "UTC", new Date(this.now())) };
  }

  compare(auth: AuthContext, requestId: string, caps: Capabilities, q: CompareQuery): CompareResult {
    const ctx = this.ctx(auth, requestId);
    return this.build(ctx, this.world(ctx), caps, q);
  }

  private build(ctx: TenantCtx, w: ReturnType<ComparisonService["world"]>, caps: Capabilities, q: CompareQuery): CompareResult {
    const me = ctx.membershipId;
    const period = w.cards.period(q.periodId);
    if (!period) throw notFound();
    const minTenureDays = Math.min(Math.max(Math.round(q.minTenureDays ?? 30), 0), 3650);
    const includeInsufficient = q.includeInsufficient === true;
    const subjectIds = [...new Set(q.subjectIds ?? [])];
    if (subjectIds.length > 60) throw new HttpError(400, "too_many", "Compare at most 60 people at a time.");
    if (q.departmentId && !w.structure.departments().some((d) => d.id === q.departmentId)) throw notFound();
    const collector = new Collector(w.tdb, { id: period.id, start: period.start_date, end: period.end_date, open: period.status === "open" }, w.today);
    const ref = collector.asOf;

    // which role family: the one named, else the one all listed people share, else the caller's own
    const families = w.structure.roleFamilies();
    const familyName = new Map(families.map((f) => [f.id, f.name]));
    let familyId = q.roleFamilyId ?? null;
    if (familyId && !familyName.has(familyId)) throw notFound();
    if (subjectIds.length > 0) {
      for (const id of subjectIds) if (!w.names.has(id)) throw notFound();
      const of = new Set(subjectIds.map((id) => collector.roleFamilyOn(id) ?? "none"));
      if (of.size > 1 || of.has("none") || (familyId !== null && !of.has(familyId))) throw new HttpError(422, "cohort_mismatch", "These people do not share a role family, so they cannot be compared. A comparison only ever covers one role family: there is no score that compares different kinds of work.");
      familyId = [...of][0]!;
    }
    if (!familyId) familyId = collector.roleFamilyOn(me);
    const base = { period: { id: period.id, name: period.name, status: period.status }, roleFamily: familyId ? { id: familyId, name: familyName.get(familyId) ?? "Role family" } : null, filters: { departmentId: q.departmentId ?? null, minTenureDays, includeInsufficient, subjectIds } };
    if (!familyId) {
      return { ...base, cohortSize: 0, excluded: { insufficient: 0, tenure: 0 }, normalization: "raw", notes: ["You have no role family yet, so there is nobody to compare you with. Ask an administrator to give you a designation."], you: null, entries: [], hiddenCount: 0, canSeeNames: caps.has("performance.compare") };
    }

    // the cohort: everyone with a scorecard in the period who belonged to the family on the reference day
    const latest = new Map(w.cards.latestScores(period.id).map((s) => [s.scorecard_id, s]));
    const modelsById = new Map(w.models.models().map((m) => [m.id, m]));
    const desRows = w.people.designationRows();
    const teamRows = w.people.teamRows({ asOf: ref });
    const deptRows = w.people.deptRows({ asOf: ref });
    const teamSize = new Map<string, number>();
    for (const r of teamRows) teamSize.set(r.team_id, (teamSize.get(r.team_id) ?? 0) + 1);
    const tenureOf = (m: string): number | null => {
      const row = desRows.find((r) => r.membership_id === m && r.start_date <= ref && (r.end_date === null || ref < r.end_date));
      return row ? Math.max(0, daysBetween(row.start_date, ref)) : null;
    };
    let tooShort = 0;
    let noScore = 0;
    const rows: { m: string; total: number | null; status: CompareEntry["status"]; band: string | null; model: string; ctx: CompareEntry["context"] }[] = [];
    for (const c of w.cards.scorecards(period.id)) {
      const m = c.subject_membership_id;
      const s = c.latest_score_id ? latest.get(c.id) : undefined;
      if (!m || !s || collector.roleFamilyOn(m) !== familyId) continue;
      if (subjectIds.length > 0 && !subjectIds.includes(m)) continue;
      if (q.departmentId && !deptRows.some((r) => r.membership_id === m && r.department_id === q.departmentId)) continue;
      const tenure = tenureOf(m);
      if (subjectIds.length === 0 && tenure !== null && tenure < minTenureDays) { tooShort += 1; continue; }
      if (s.total_score === null && !includeInsufficient) { noScore += 1; continue; }
      const full = w.cards.score(s.id);
      const inputs = full ? (JSON.parse(full.inputs_json) as ScoreInputs) : null;
      const expl = JSON.parse(s.explanation_json) as { band: string | null; confidence: { label: string; parts: { evidence: number } } };
      const myTeams = teamRows.filter((r) => r.membership_id === m).map((r) => teamSize.get(r.team_id) ?? 0);
      const model = modelsById.get(s.scoring_model_id);
      rows.push({
        m, total: s.total_score, status: s.status as CompareEntry["status"], band: expl.band, model: `${model?.name ?? "Model"} v${s.model_version}`,
        ctx: { tenureDays: tenure, teamSize: myTeams.length ? Math.max(...myTeams) : null, taskLoad: inputs ? Math.round(inputs.tasks.reduce((n, t) => n + t.importance, 0) * 10) / 10 : 0, dataCoverage: Math.round(s.weight_coverage * 100) / 100, confidence: expl.confidence.label, evidence: Math.round(expl.confidence.parts.evidence * 100) / 100 },
      });
    }
    const ranked = rows.filter((r) => r.total !== null);
    const pos = positions(ranked.map((r) => ({ id: r.m, total: r.total as number })));
    // fewer than 3 people: the scores are shown side by side, with no rank at all
    const at = new Map(pos.positions.map((p) => [p.id, pos.normalization === "raw" ? { ...p, rank: null as number | null } : { ...p, rank: p.rank as number | null }]));
    const compareScope = caps.scope("performance.compare");
    const canSeeNames = caps.has("performance.compare");
    const mayShow = (m: string): boolean => m === me || (canSeeNames && (compareScope.all || compareScope.members.has(m)) && scoreAccess(caps, me, m).scores);
    const entries: CompareEntry[] = rows
      .filter((r) => mayShow(r.m))
      .map((r): CompareEntry => {
        const p = at.get(r.m);
        return { subject: { id: r.m, name: w.names.get(r.m) ?? "Former member" }, total: r.total, status: r.status, band: r.band, model: r.model, rank: p?.rank ?? null, percentile: p?.percentile ?? null, zScore: p?.zScore ?? null, isYou: r.m === me, context: r.ctx };
      })
      .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || (b.total ?? -1) - (a.total ?? -1) || a.subject.name.localeCompare(b.subject.name));
    const mine = at.get(me);
    const myRow = rows.find((r) => r.m === me);
    const models = new Set(rows.map((r) => r.model));
    const notes: string[] = [];
    if (pos.normalization === "raw") notes.push(`Too few peers to rank (${ranked.length} of ${MIN_RANKED} needed). The scores are shown side by side, without a rank or a percentile.`);
    else if (pos.normalization === "percentile") notes.push("A z-score needs at least 8 people, so only the rank and the percentile are shown.");
    if (models.size > 1) notes.push(`These people were scored with different models (${[...models].sort().join(", ")}), so the totals are not strictly like for like.`);
    if (tooShort > 0) notes.push(`${tooShort} ${tooShort === 1 ? "person has" : "people have"} been in the role for less than ${minTenureDays} days and ${tooShort === 1 ? "is" : "are"} left out.`);
    if (noScore > 0) notes.push(`${noScore} ${noScore === 1 ? "person has" : "people have"} not enough data for a score and ${noScore === 1 ? "is" : "are"} left out.`);
    notes.push("Tenure, team size and workload are shown beside the scores, not applied to them: a comparison is a conversation starter, not a verdict.");
    return {
      ...base, cohortSize: ranked.length, excluded: { insufficient: noScore, tenure: tooShort }, normalization: pos.normalization, notes,
      you: myRow ? { rank: mine?.rank ?? null, of: ranked.length, percentile: mine?.percentile ?? null, zScore: mine?.zScore ?? null, total: myRow.total } : null,
      entries, hiddenCount: rows.length - entries.length, canSeeNames,
    };
  }

  /** Why two people's totals differ, part by part. Needs `performance.compare` and the right to see both people's parts. */
  difference(auth: AuthContext, requestId: string, caps: Capabilities, q: { periodId: string; a: string; b: string }): Difference {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const period = w.cards.period(q.periodId);
    if (!period) throw notFound();
    const scope = caps.scope("performance.compare");
    const part = (m: string) => {
      const ok = w.names.has(m) && (m === ctx.membershipId || ((scope.all || scope.members.has(m)) && scoreAccess(caps, ctx.membershipId, m).components));
      if (!ok) throw notFound();
      const card = w.cards.scorecardFor(`m:${m}`, period.id);
      const s = card?.latest_score_id ? w.cards.score(card.latest_score_id) : undefined;
      if (!s) throw notFound();
      return { id: m, name: w.names.get(m)!, total: s.total_score, parts: w.cards.componentsOf(s.id).map((c) => ({ key: c.component_key, label: c.label, score: c.normalized_score, points: c.contribution_points })) };
    };
    if (q.a === q.b) throw new HttpError(400, "same_person", "Pick two different people.");
    const a = part(q.a);
    const b = part(q.b);
    // same family only
    const collector = new Collector(w.tdb, { id: period.id, start: period.start_date, end: period.end_date, open: period.status === "open" }, w.today);
    const fa = collector.roleFamilyOn(a.id);
    if (fa === null || fa !== collector.roleFamilyOn(b.id)) throw new HttpError(422, "cohort_mismatch", "These people do not share a role family, so they cannot be compared.");
    return { period: { id: period.id, name: period.name }, a: { id: a.id, name: a.name, total: a.total }, b: { id: b.id, name: b.name, total: b.total }, totalDifference: a.total !== null && b.total !== null ? Math.round((a.total - b.total) * 10) / 10 : null, parts: explainDifference(a.parts, b.parts) };
  }

  // ---------- saved comparisons (snapshots) ----------

  save(auth: AuthContext, requestId: string, caps: Capabilities, input: CompareQuery & { name: string }): SavedComparisonDetail {
    if (!caps.has("performance.compare")) throw new HttpError(403, "permission_denied", "You cannot run comparisons.");
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const name = (input.name ?? "").replace(/\s+/g, " ").trim();
    if (name.length < 1 || name.length > 80) throw new HttpError(400, "invalid_title", "A comparison name is 1 to 80 characters.");
    const result = this.build(ctx, w, caps, input);
    const id = newId();
    this.o.store.transaction(() => {
      w.cards.insertComparison({ id, name, periodId: result.period.id, cohortJson: JSON.stringify({ roleFamily: result.roleFamily, ...result.filters }), normalization: result.normalization, cohortSize: result.cohortSize, resultsJson: JSON.stringify(result), by: ctx.membershipId, now: this.now() });
      this.o.audit.record(w.tdb, ctx, { action: "performance.comparison_save", entityType: "performance_comparison", entityId: id, summary: `Saved the comparison "${name}" (${result.roleFamily?.name ?? "no role family"}, ${result.period.name}, ${result.cohortSize} ${result.cohortSize === 1 ? "person" : "people"})`, after: { period: result.period.name, roleFamily: result.roleFamily?.name ?? null, cohortSize: result.cohortSize } });
    });
    return this.detail(w, caps, ctx.membershipId, w.cards.comparison(id)!)!;
  }
  private visible(caps: Capabilities, me: string, createdBy: string): boolean {
    return caps.has("performance.compare") && (createdBy === me || caps.scope("performance.compare").all);
  }
  private summaryOf(w: ReturnType<ComparisonService["world"]>, c: { id: string; name: string; period_id: string; created_by_membership_id: string; created_at: string; cohort_size: number; normalization_method: string }): SavedComparison {
    return { id: c.id, name: c.name, periodId: c.period_id, createdBy: { id: c.created_by_membership_id, name: w.names.get(c.created_by_membership_id) ?? "Former member" }, createdAt: c.created_at, cohortSize: c.cohort_size, normalization: c.normalization_method };
  }
  private detail(w: ReturnType<ComparisonService["world"]>, caps: Capabilities, me: string, c: ComparisonRow): SavedComparisonDetail | undefined {
    if (!this.visible(caps, me, c.created_by_membership_id)) return undefined;
    const result = JSON.parse(c.results_json) as CompareResult;
    // "you" is about the viewer, who may not be the person who saved it
    return { ...this.summaryOf(w, c), result: { ...result, you: null, entries: result.entries.map((e) => ({ ...e, isYou: e.subject.id === me })) } };
  }
  list(auth: AuthContext, requestId: string, caps: Capabilities): SavedComparison[] {
    if (!caps.has("performance.compare")) throw new HttpError(403, "permission_denied", "Not allowed");
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    return w.cards.comparisons().filter((c) => this.visible(caps, ctx.membershipId, c.created_by_membership_id)).map((c) => this.summaryOf(w, c));
  }
  get(auth: AuthContext, requestId: string, caps: Capabilities, id: string): SavedComparisonDetail {
    if (!caps.has("performance.compare")) throw new HttpError(403, "permission_denied", "Not allowed");
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const c = w.cards.comparison(id);
    const d = c ? this.detail(w, caps, ctx.membershipId, c) : undefined;
    if (!d) throw notFound();
    return d;
  }
}
