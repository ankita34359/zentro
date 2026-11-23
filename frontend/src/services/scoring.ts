import { api } from "@/services/api";

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
  bands: { min: number; label: string }[];
  components: ComponentView[];
  weightTotal: number;
  isDemo: boolean;
  problems: string[];
}
export interface TemplateView { key: string; name: string; description: string; components: { label: string; weight: number; providerKey: string }[] }
export type DataState = "ok" | "insufficient" | "missing";
export interface Contributor { ref: { type: string; id: string }; label: string; value: number | null; target?: number | null; weight: number; note?: string }
export interface ComponentResult { key: string; label: string; providerKey: string; weight: number; state: DataState; score: number | null; rawValue: number | null; effectiveWeight: number; points: number | null; sampleSize: number; minSample: number; coverage: number; contributors: Contributor[]; notes: string[] }
export interface Explanation {
  formula: string;
  status: "final" | "provisional" | "insufficient";
  band: string | null;
  confidence: { value: number; label: "high" | "medium" | "low"; parts: { coverage: number; sample: number; evidence: number } };
  components: { key: string; label: string; state: DataState; score: number | null; weight: number; effectiveWeight: number; points: number | null; stateText: string; topContributors: Contributor[]; gaps: Contributor[] }[];
  reasons: string[];
  dataQuality: string[];
  whatWouldChangeThis: string[];
  rounding: string | null;
}
export interface PreviewResult { total: number | null; status: "final" | "provisional" | "insufficient"; weightCoverage: number; confidence: number; components: ComponentResult[]; explanation: Explanation }

export const listModels = (includeRetired = false) => api<ModelView[]>(`/api/performance/models${includeRetired ? "?includeRetired=true" : ""}`);
export const getModel = (id: string) => api<ModelView>(`/api/performance/models/${id}`);
export const getTemplates = () => api<TemplateView[]>("/api/performance/models/templates");
export const createModel = (b: { templateKey: string; name?: string }) => api<ModelView>("/api/performance/models", { method: "POST", body: b });
export const updateModel = (id: string, b: { name?: string; roleFamilyId?: string | null; designationId?: string | null; isDefault?: boolean; minWeightCoverage?: number; minConfidenceForFinal?: number; components?: { key: string; label: string; weight: number; providerKey: string; minSample?: number; config?: Record<string, unknown> }[] }) => api<ModelView>(`/api/performance/models/${id}`, { method: "PATCH", body: b });
export const activateModel = (id: string) => api<ModelView>(`/api/performance/models/${id}/activate`, { method: "POST" });
export const previewModel = (b: { modelId: string; values: Record<string, number | null>; periodClosed?: boolean }) => api<PreviewResult>("/api/performance/models/preview", { method: "POST", body: b });

export const STATUS_WORD: Record<string, string> = { final: "Final", provisional: "Provisional", insufficient: "Not enough data" };
export const STATE_WORD: Record<string, string> = { ok: "Enough data", insufficient: "Not enough data", missing: "No data recorded" };

// ---------- periods and scorecards (stage 5.2) ----------
export interface PeriodView { id: string; name: string; periodType: string; startDate: string; endDate: string; status: "open" | "closed" | "locked"; closedAt: string | null; isDemo: boolean; scorecards: number }
export interface ScoreSummary { scoreId: string; runNumber: number; status: "final" | "provisional" | "insufficient"; total: number | null; band: string | null; confidence: number; confidenceLabel: string; weightCoverage: number; modelName: string; modelVersion: number; computedAt: string; trigger: string }
export interface ScorecardSummary extends ScoreSummary { scorecardId: string; subject: { id: string; name: string }; periodId: string; isDemo: boolean }
export interface ScoreComponent { key: string; label: string; providerKey: string; state: DataState; score: number | null; weight: number; effectiveWeight: number; points: number | null; sampleSize: number; minSample: number; coverage: number; stateText: string; contributors: Contributor[]; notes: string[] }
export interface ScoreDetail extends ScoreSummary {
  scorecardId: string;
  subject: { id: string; name: string };
  period: { id: string; name: string; startDate: string; endDate: string; status: string };
  componentsHidden: boolean;
  components: ScoreComponent[];
  explanation: Explanation | null;
  engineVersion: string;
  isLatest: boolean;
}
export interface ScorecardDetail { scorecardId: string; subject: { id: string; name: string }; period: PeriodView; latest: ScoreDetail | null; runs: ScoreSummary[]; can: { recalculate: boolean; components: boolean } }
export interface VerifyResult { matches: boolean; expected: { total: number | null; status: string }; actual: { total: number | null; status: string }; engineVersion: string; modelVersion: number; mismatches: string[] }
export interface RecalcResult { periodId: string; scored: number; unchanged: number; skipped: number }

export const listPeriods = () => api<PeriodView[]>("/api/performance/periods");
export const createPeriod = (b: { name: string; periodType?: string; startDate: string; endDate: string }) => api<PeriodView>("/api/performance/periods", { method: "POST", body: b });
export const listScorecards = (periodId: string) => api<ScorecardSummary[]>(`/api/performance/scorecards?periodId=${encodeURIComponent(periodId)}`);
export const getScorecardFor = (periodId: string, subjectId?: string) => api<ScorecardDetail>(`/api/performance/scorecards/for?periodId=${encodeURIComponent(periodId)}${subjectId ? `&subjectId=${encodeURIComponent(subjectId)}` : ""}`);
export const recalculate = (b: { periodId: string; subjectId?: string }) => api<RecalcResult>("/api/performance/scorecards/recalculate", { method: "POST", body: b });
export const getScore = (id: string) => api<ScoreDetail>(`/api/performance/scores/${id}`);
export const verifyScore = (id: string) => api<VerifyResult>(`/api/performance/scores/${id}/verify`, { method: "POST" });
export const TRIGGER_WORD: Record<string, string> = { scheduled: "Nightly", manual: "Calculated by hand", period_close: "Period closed", recalculation: "Recalculated" };

// ---------- closing, trends (stage 5.3) ----------
export interface TrendComponent { key: string; label: string; state: DataState; score: number | null; delta: number | null }
export interface TrendPoint { periodId: string; periodName: string; startDate: string; endDate: string; periodStatus: string; scoreId: string; runNumber: number; status: "final" | "provisional" | "insufficient"; total: number | null; band: string | null; confidence: number; confidenceLabel: string; model: string; totalDelta: number | null; components: TrendComponent[] }
export interface Comparison {
  from: { periodId: string; name: string; total: number | null; status: string; model: string };
  to: { periodId: string; name: string; total: number | null; status: string; model: string };
  totalDelta: number | null;
  modelChanged: boolean;
  components: { key: string; label: string; from: number | null; to: number | null; delta: number | null; note: string | null }[];
}
export interface TrendResult { subject: { id: string; name: string }; componentsHidden: boolean; points: TrendPoint[]; comparison: Comparison | null }
export const closePeriod = (id: string) => api<PeriodView & { calculated: { scored: number; unchanged: number; skipped: number } }>(`/api/performance/periods/${id}/close`, { method: "POST" });
export const reopenPeriod = (id: string) => api<PeriodView>(`/api/performance/periods/${id}/reopen`, { method: "POST" });
export const lockPeriod = (id: string) => api<PeriodView>(`/api/performance/periods/${id}/lock`, { method: "POST" });
export const getTrends = (q: { subjectId?: string; from?: string; to?: string }) => {
  const p = new URLSearchParams();
  if (q.subjectId) p.set("subjectId", q.subjectId);
  if (q.from) p.set("from", q.from);
  if (q.to) p.set("to", q.to);
  return api<TrendResult>(`/api/performance/trends${p.toString() ? `?${p.toString()}` : ""}`);
};
/** "+20.0", "−3.5", "No change", or "No comparison" when either side had no data (never a drop to zero). */
export const deltaText = (d: number | null): string => (d === null ? "No comparison" : d === 0 ? "No change" : `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}`);
