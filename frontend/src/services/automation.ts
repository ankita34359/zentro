import { api } from "./api";

export interface WebhookView {
  configured: boolean; enabled: boolean; host: string | null; secretSet: boolean; secretCreatedAt: string | null;
  events: { type: string; description: string; enabled: boolean }[];
  limits: { timeoutSeconds: number; maxPayloadBytes: number; maxAttempts: number; retryMinutes: number[] };
  signing: { header: string; algorithm: string; how: string };
  signingSecret?: string;
}
export interface DeliveryView { id: string; at: string; eventType: string; status: string; attempts: number; responseCode: number | null; error: string | null; isTest: boolean; nextAttemptAt: string | null }
export interface EndpointView { id: string; name: string; kind: string; path: string; tokenPrefix: string; createdAt: string; lastUsedAt: string | null; calls: number; kpiId: string | null }

export const getWebhook = () => api<WebhookView>("/api/integrations/webhooks");
export const saveWebhook = (b: { url?: string | null; enabled?: boolean; events?: Record<string, boolean> }) => api<WebhookView>("/api/integrations/webhooks", { method: "PUT", body: b });
export const rotateWebhookSecret = () => api<WebhookView>("/api/integrations/webhooks/rotate-secret", { method: "POST" });
export const sendTestEvent = () => api<DeliveryView>("/api/integrations/webhooks/test", { method: "POST" });
export const listDeliveries = () => api<DeliveryView[]>("/api/integrations/deliveries?limit=50");
export const listEndpoints = () => api<EndpointView[]>("/api/integrations/endpoints");
export const createEndpoint = (b: { name: string; kind: "task" | "kpi_value"; kpiId?: string; subject?: { type: "organization" } }) => api<EndpointView & { token: string }>("/api/integrations/endpoints", { method: "POST", body: b });
export const deleteEndpoint = (id: string) => api<{ deleted: true }>(`/api/integrations/endpoints/${id}`, { method: "DELETE" });
