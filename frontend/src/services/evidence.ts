import { api } from "@/services/api";

export interface EvidenceView {
  id: string; type: string; title: string; description: string; externalRef: string | null;
  about: { id: string; name: string } | null; submittedBy: { id: string; name: string }; occurredOn: string;
  verification: { status: string; by: { id: string; name: string } | null; at: string | null; note: string | null };
  confidentiality: string; file: { filename: string; contentType: string; sizeBytes: number } | null;
  links: { type: string; id: string }[]; isDemo: boolean; can: { verify: boolean; attachFile: boolean };
}
export const EVIDENCE_TYPE_LABEL: Record<string, string> = { task_completion: "Task completion", milestone: "Milestone", pull_request: "Pull request", deployment: "Deployment", sales_record: "Sales record", crm_update: "CRM update", customer_feedback: "Customer feedback", document: "Document", report: "Report", meeting_outcome: "Meeting outcome", delivery_record: "Delivery record", kpi_measurement: "KPI measurement", manager_feedback: "Manager feedback", other: "Other" };
export const CONFIDENTIALITY_LABEL: Record<string, string> = { organization: "Everyone with evidence access", scope: "People who look after them", restricted: "Restricted" };
export const VERIFICATION_LABEL: Record<string, string> = { unverified: "Not verified yet", verified: "Verified", rejected: "Rejected", needs_info: "Needs more information" };
export const listEvidence = (targetType: string, targetId: string) => api<EvidenceView[]>(`/api/evidence?targetType=${targetType}&targetId=${targetId}`);
export const createEvidence = (b: { title: string; evidenceType?: string; description?: string; externalRef?: string | null; confidentiality?: string; links: { type: string; id: string }[] }) => api<EvidenceView>("/api/evidence", { method: "POST", body: b });
export const verifyEvidence = (id: string, b: { status: string; note?: string }) => api<EvidenceView>(`/api/evidence/${id}/verify`, { method: "POST", body: b });
export const attachEvidenceFile = (id: string, b: { filename: string; dataBase64: string }) => api<EvidenceView>(`/api/evidence/${id}/file`, { method: "POST", body: b });
export const evidenceFileUrl = (id: string) => `/api/evidence/${id}/file`;
export const readFileAsBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
  r.onerror = () => reject(new Error("The file could not be read."));
  r.readAsDataURL(file);
});
