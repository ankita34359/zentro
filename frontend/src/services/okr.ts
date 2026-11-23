import { api } from "@/services/api";

export interface Ref { id: string; name: string }
export type Health = "not_started" | "on_track" | "at_risk" | "delayed" | "completed" | "no_data";
export interface KeyResult {
  id: string;
  title: string;
  description: string;
  measurementType: string;
  unit: string | null;
  direction: "increase" | "decrease";
  method: "linear" | "binary" | "manual";
  startValue: number;
  targetValue: number;
  currentValue: number | null;
  currentAsOf: string | null;
  weight: number;
  owner: Ref | null;
  dueDate: string | null;
  /** null = nothing recorded yet (never shown as 0). */
  attainmentPct: number | null;
  regressed: boolean;
  capped: boolean;
  degenerate: boolean;
  isDemo: boolean;
}
export interface ObjectiveSummary {
  id: string;
  title: string;
  level: "company" | "department" | "team" | "individual";
  objectiveType: string;
  priority: string;
  lifecycle: "draft" | "active" | "completed" | "cancelled";
  visibility: string;
  published: boolean;
  startDate: string;
  endDate: string;
  weight: number;
  owner: Ref | null;
  department: Ref | null;
  team: Ref | null;
  keyResultCount: number;
  attainmentPct: number | null;
  dataState: "ok" | "insufficient" | "none";
  coveragePct: number;
  elapsedPct: number;
  health: Health | null;
  healthReason: string;
  archived: boolean;
  isDemo: boolean;
}
export interface ObjectiveDetail extends ObjectiveSummary {
  description: string;
  createdBy: Ref;
  keyResults: KeyResult[];
  can: { edit: boolean; updateProgress: boolean; publish: boolean; archive: boolean; addKeyResults: boolean };
  nextLifecycles: string[];
  tasks: { total: number; open: number };
}
export interface HistoryEntry { id: string; keyResultId: string | null; keyResultTitle: string | null; recordedAt: string; value: number | null; attainmentPct: number | null; source: string; note: string | null; by: Ref | null }
export interface Linkable { id: string; title: string; level: string; keyResults: { id: string; title: string }[] }

export interface KeyResultInput { title: string; measurementType?: string; unit?: string | null; direction?: "increase" | "decrease"; method?: "linear" | "binary" | "manual"; startValue?: number; targetValue: number; weight?: number; ownerId?: string | null; dueDate?: string | null }
export interface NewObjective { level: string; title: string; description?: string; objectiveType?: string; startDate: string; endDate: string; priority?: string; departmentId?: string | null; teamId?: string | null; ownerId?: string | null; lifecycle?: "draft" | "active"; keyResults?: KeyResultInput[] }

export type ObjectiveQuery = { level?: string; lifecycle?: string; mine?: boolean; search?: string };
const qs = (o: Record<string, string | boolean | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "" && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const listObjectives = (q: ObjectiveQuery = {}) => api<ObjectiveSummary[]>(`/api/objectives${qs(q)}`);
export const getObjective = (id: string) => api<ObjectiveDetail>(`/api/objectives/${id}`);
export const getObjectiveHistory = (id: string) => api<HistoryEntry[]>(`/api/objectives/${id}/history`);
export const getLinkable = () => api<Linkable[]>("/api/objectives/linkable");
export const createObjective = (b: NewObjective) => api<ObjectiveDetail>("/api/objectives", { method: "POST", body: { ...b } });
export const updateObjective = (id: string, b: { title?: string; description?: string; priority?: string; startDate?: string; endDate?: string; lifecycle?: string }) => api<ObjectiveDetail>(`/api/objectives/${id}`, { method: "PATCH", body: b });
export const archiveObjective = (id: string) => api<{ archived: true }>(`/api/objectives/${id}`, { method: "DELETE" });
export const publishObjective = (id: string, published: boolean) => api<ObjectiveDetail>(`/api/objectives/${id}/publish`, { method: "POST", body: { published } });
export const addKeyResult = (id: string, b: KeyResultInput) => api<ObjectiveDetail>(`/api/objectives/${id}/key-results`, { method: "POST", body: { ...b } });
export const updateKeyResult = (id: string, b: { title?: string; startValue?: number; targetValue?: number }) => api<ObjectiveDetail>(`/api/key-results/${id}`, { method: "PATCH", body: b });
export const recordProgress = (id: string, b: { value: number; note?: string }) => api<ObjectiveDetail>(`/api/key-results/${id}/progress`, { method: "POST", body: { ...b } });

export const LEVEL_LABEL: Record<string, string> = { company: "Company", department: "Department", team: "Team", individual: "Personal" };
export const LIFECYCLE_LABEL: Record<string, string> = { draft: "Draft", active: "Active", completed: "Completed", cancelled: "Cancelled" };
export const SOURCE_LABEL: Record<string, string> = { manual: "Recorded", task_outcome: "From a finished task", target_change: "Target changed", demo: "Demo data" };

/** "No data yet" is not 0%: the one place that decides how a missing number is written. */
export const pctText = (pct: number | null): string => (pct === null ? "No data yet" : `${pct}%`);
export const valueText = (k: Pick<KeyResult, "currentValue" | "unit" | "method">): string =>
  k.currentValue === null ? "Nothing recorded" : k.method === "binary" ? (k.currentValue >= 1 ? "Yes" : "No") : k.method === "manual" ? `${k.currentValue}%` : `${k.currentValue}${k.unit ? ` ${k.unit}` : ""}`;

export const HEALTH_LABEL: Record<string, string> = { not_started: "Not started", on_track: "On track", at_risk: "At risk", delayed: "Delayed", completed: "Completed", no_data: "No data" };

// ---------- alignment (stage 3.2) ----------
export interface LinkedObjective { id: string; title: string; level: string; lifecycle: string; health: Health | null; attainmentPct: number | null; dataState: string; owner: Ref | null }
export interface Alignment {
  parent: { relationshipId: string; weight: number; objective: LinkedObjective | null; hidden: boolean } | null;
  children: { relationshipId: string; weight: number; objective: LinkedObjective }[];
  hiddenChildren: number;
  assignments: { id: string; kind: "person" | "team" | "department"; id2: string; name: string; role: string; startDate: string }[];
  can: { assign: boolean };
}
export interface TreeNode extends LinkedObjective { weight: number | null; contributionPct: number | null; unaligned: boolean; hiddenChildren: number; children: TreeNode[] }
export interface GapItem { id: string; title: string; level: string; reason: string }
export interface Gaps { unaligned: GapItem[]; notBrokenDown: GapItem[]; unmeasurable: GapItem[]; noData: GapItem[]; behindPace: GapItem[]; overdue: GapItem[]; unalignedTasks: number }

export const getAlignment = (id: string) => api<Alignment>(`/api/objectives/${id}/alignment`);
export const setParent = (id: string, b: { parentId: string; weight?: number }) => api<Alignment>(`/api/objectives/${id}/parent`, { method: "PUT", body: b });
export const clearParent = (id: string) => api<Alignment>(`/api/objectives/${id}/parent`, { method: "DELETE" });
export const assignObjective = (id: string, b: { assigneeId?: string; teamId?: string; departmentId?: string; role?: string }) => api<Alignment>(`/api/objectives/${id}/assignments`, { method: "POST", body: b });
export const unassignObjective = (id: string, aid: string) => api<Alignment>(`/api/objectives/${id}/assignments/${aid}`, { method: "DELETE" });
export const getTree = (includeClosed = false) => api<{ roots: TreeNode[]; total: number }>(`/api/objectives/tree${includeClosed ? "?includeClosed=true" : ""}`);
export const getGaps = () => api<Gaps>("/api/objectives/alignment-gaps");
