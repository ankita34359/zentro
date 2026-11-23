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
