import { api } from "@/services/api";

export interface KpiView {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  unit: string | null;
  valueType: string;
  direction: "higher_is_better" | "lower_is_better" | "target_range";
  frequency: "daily" | "weekly" | "monthly" | "quarterly" | "annual";
  aggregation: string;
  defaultTarget: number | null;
  defaultTargetMax: number | null;
  archived: boolean;
  isDemo: boolean;
  assignmentCount: number;
}
export interface SubjectRef { kind: "person" | "team" | "department" | "designation" | "role_family"; id: string; name: string }
export interface AssignmentView { id: string; subject: SubjectRef; targetValue: number; targetMax: number | null; weight: number; effectiveFrom: string; effectiveTo: string | null; active: boolean; appliesTo: number }
export interface ThresholdView { id: string; level: "excellent" | "warning" | "critical"; comparator: "lt" | "lte" | "gt" | "gte"; basis: "absolute" | "percent_of_target"; value: number; notify: boolean }
export interface KpiDetail extends KpiView { assignments: AssignmentView[]; thresholds: ThresholdView[]; can: { configure: boolean; assign: boolean; record: boolean } }
export interface NewKpi { name: string; description?: string; category?: string; unit?: string | null; direction?: string; frequency?: string; aggregation?: string; defaultTarget?: number | null; defaultTargetMax?: number | null }

const qs = (o: Record<string, string | boolean | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "" && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
export const listKpis = (q: { category?: string; frequency?: string; search?: string; assignedToMe?: boolean } = {}) => api<KpiView[]>(`/api/kpis${qs(q)}`);
export const getKpi = (id: string) => api<KpiDetail>(`/api/kpis/${id}`);
export const createKpi = (b: NewKpi) => api<KpiDetail>("/api/kpis", { method: "POST", body: { ...b } });
export const updateKpi = (id: string, b: Partial<NewKpi>) => api<KpiDetail>(`/api/kpis/${id}`, { method: "PATCH", body: b });
export const archiveKpi = (id: string) => api<{ archived: true }>(`/api/kpis/${id}/archive`, { method: "POST" });
export const assignKpi = (id: string, b: { assigneeId?: string; teamId?: string; departmentId?: string; designationId?: string; roleFamilyId?: string; targetValue?: number; targetMax?: number | null; weight?: number }) => api<KpiDetail>(`/api/kpis/${id}/assignments`, { method: "POST", body: b });
export const updateAssignment = (id: string, aid: string, b: { targetValue?: number; targetMax?: number | null; weight?: number }) => api<KpiDetail>(`/api/kpis/${id}/assignments/${aid}`, { method: "PATCH", body: b });
export const endAssignment = (id: string, aid: string) => api<KpiDetail>(`/api/kpis/${id}/assignments/${aid}`, { method: "DELETE" });
export const setThresholds = (id: string, thresholds: { level: string; comparator: string; basis: string; value: number; notify?: boolean }[]) => api<KpiDetail>(`/api/kpis/${id}/thresholds`, { method: "PUT", body: { thresholds } });

export const CATEGORY_LABEL: Record<string, string> = { delivery: "Delivery", quality: "Quality", impact: "Impact", financial: "Financial", growth: "Growth", people: "People", health: "Health" };
export const FREQUENCY_LABEL: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", annual: "Yearly" };
export const DIRECTION_LABEL: Record<string, string> = { higher_is_better: "Higher is better", lower_is_better: "Lower is better", target_range: "Stay inside a range" };
export const AGGREGATION_LABEL: Record<string, string> = { sum: "Add up", avg: "Average", last: "Latest value", min: "Lowest", max: "Highest" };
export const LEVEL_LABEL: Record<string, string> = { excellent: "Excellent", warning: "Warning", critical: "Critical" };
export const COMPARATOR_LABEL: Record<string, string> = { lt: "is below", lte: "is at or below", gt: "is above", gte: "is at or above" };
export const SUBJECT_LABEL: Record<string, string> = { person: "Person", team: "Team", department: "Department", designation: "Designation", role_family: "Role family" };
export const thresholdText = (t: Pick<ThresholdView, "comparator" | "basis" | "value">, unit: string | null): string => `${COMPARATOR_LABEL[t.comparator]} ${t.value}${t.basis === "percent_of_target" ? "% of the target" : unit ? ` ${unit}` : ""}`;
