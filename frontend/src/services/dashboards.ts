import { api } from "@/services/api";

export interface ObjectiveLine { id: string; title: string; health: string | null; attainmentPct: number | null; elapsedPct: number; dataState: string }
export interface TeamCard {
  id: string; name: string; department: string | null; memberCount: number;
  members: { id: string; name: string; role: string }[]; hiddenMembers: number;
  objectives: ObjectiveLine[] | null;
  kpis: null | { series: number; byStatus: Record<string, number>; missingPeriods: number; items: { kpiId: string; name: string; subject: string; status: string; missing: number }[] };
  tasks: null | { open: number; overdue: number; done: number; blocked: number };
}
export interface TeamPerformance { today: string; teams: TeamCard[] }
export interface ContributionLine { id: string; title: string; level: string; department: string | null; owner: string | null; health: string | null; attainmentPct: number | null; contributionPct: number | null }
export interface LeadershipView {
  today: string;
  objectives: { id: string; title: string; health: string | null; attainmentPct: number | null; elapsedPct: number; dataState: string; owner: string | null; contributors: ContributionLine[] }[];
  risks: { id: string; title: string; level: string; reason: string; kind: "behind_pace" | "overdue" | "no_data" }[];
  kpis: null | { series: number; byStatus: Record<string, number>; missingPeriods: number; attention: { kpiId: string; name: string; subject: string; status: string; label: string; missing: number }[] };
}
export interface Insight { key: string; severity: "attention" | "info"; title: string; summary: string; count: number; to: string; items: { label: string; detail: string; to: string }[] }
export interface InsightsView { today: string; insights: Insight[]; ask: { enabled: false; reason: string }; note: string }
export interface IntegrationsView {
  viaSocket: { connected: false; status: string; settings: { name: string; set: boolean }[] };
  events: { type: string; description: string; status: "recorded" | "planned"; last30Days: number | null }[];
  steps: string[];
  note: string;
}
export const getTeamPerformance = () => api<TeamPerformance>("/api/team-performance");
export const getLeadership = () => api<LeadershipView>("/api/leadership/overview");
export const getInsights = () => api<InsightsView>("/api/ai/insights");
export const getIntegrations = () => api<IntegrationsView>("/api/integrations/status");
