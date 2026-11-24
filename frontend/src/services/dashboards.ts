import { api } from "@/services/api";

export interface ObjectiveLine { id: string; title: string; health: string | null; attainmentPct: number | null; elapsedPct: number; dataState: string }
export interface MemberScore { total: number | null; status: string; confidence: number; confidenceLabel: string; scoreId: string; scorecardId: string }
export interface TeamCard {
  id: string; name: string; department: string | null; memberCount: number;
  members: { id: string; name: string; role: string; score: MemberScore | null }[]; hiddenMembers: number;
  average: null | { value: number; n: number; of: number; note: string | null };
  mentoring: null | { pairs: number; activePairs: number; sessions: number; menteesMeasured: number; averageImprovement: number | null; caveat: string };
  objectives: ObjectiveLine[] | null;
  kpis: null | { series: number; byStatus: Record<string, number>; missingPeriods: number; items: { kpiId: string; name: string; subject: string; status: string; missing: number }[] };
  tasks: null | { open: number; overdue: number; done: number; blocked: number };
}
export interface TeamComparison { department: string; teams: { id: string; name: string; average: number | null; n: number; eligible: boolean; rank: number | null }[]; note: string }
export interface TeamPerformance { today: string; period: { id: string; name: string; status: string } | null; periods: { id: string; name: string; status: string }[]; teams: TeamCard[]; comparisons: TeamComparison[] }
export interface ContributionLine { id: string; title: string; level: string; department: string | null; owner: string | null; health: string | null; attainmentPct: number | null; contributionPct: number | null }
export interface TrendPoint { date: string; value: number | null }
export interface DrillPerson { id: string; name: string; score: MemberScore | null }
export interface DrillTeam { id: string; name: string; people: number; average: number | null; n: number; objectives: ObjectiveLine[]; members: DrillPerson[] }
export interface DrillDepartment { id: string; name: string; people: number; average: number | null; n: number; objectives: ObjectiveLine[]; teams: DrillTeam[] }
export interface LeadershipView {
  today: string;
  range: { preset: string; from: string; to: string; days: number };
  period: { id: string; name: string; status: string } | null;
  summary: string[];
  executiveKpis: { kpiId: string; name: string; unit: string | null; status: string; label: string; target: number | null; missing: number; trend: TrendPoint[]; change: number | null }[];
  departments: DrillDepartment[];
  groupedRisks: { kind: "behind_pace" | "overdue" | "no_data"; level: string; count: number; items: { id: string; title: string; reason: string }[] }[];
  objectives: { id: string; title: string; health: string | null; attainmentPct: number | null; elapsedPct: number; dataState: string; owner: string | null; contributors: ContributionLine[]; trend: TrendPoint[]; change: number | null }[];
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
export const getTeamPerformance = (periodId?: string) => api<TeamPerformance>(`/api/team-performance${periodId ? `?periodId=${periodId}` : ""}`);
export const getLeadership = (q: { range?: string; from?: string; to?: string } = {}) => api<LeadershipView>(`/api/leadership/overview${q.from && q.to ? `?from=${q.from}&to=${q.to}` : q.range ? `?range=${q.range}` : ""}`);
export const getInsights = () => api<InsightsView>("/api/ai/insights");
export const getIntegrations = () => api<IntegrationsView>("/api/integrations/status");
