import { api } from "./api";

export interface AiStatus {
  connected: boolean; reason: string | null; keyConfigured: boolean; enabledForOrganization: boolean; canUse: boolean; canConfigure: boolean;
  limits: { perUserPerDay: number; perOrganizationPerDay: number; maxQuestionChars: number };
  usedToday: { you: number; organization: number };
}
export interface AiAnswer {
  aiGenerated: true; answer: string; basedOn: string; model: string;
  citations: { ref: string; type: string; id: string; label: string; to: string }[];
  unmatchedNumbers: string[];
  sent: { instructions: string; records: string; question: string; recordList: { ref: string; type: string; id: string; label: string }[]; characters: number; neverSent: string[] };
  usedToday: { you: number; organization: number };
}
export const getAiStatus = () => api<AiStatus>("/api/ai/status");
export const setAiEnabled = (enabled: boolean) => api<AiStatus>("/api/ai/settings", { method: "PUT", body: { enabled } });
export const askAi = (question: string) => api<AiAnswer>("/api/ai/ask", { method: "POST", body: { question } });
