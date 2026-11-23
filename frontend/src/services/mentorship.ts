import { api } from "@/services/api";

export interface AssignmentView {
  id: string;
  mentor: { id: string; name: string };
  mentee: { id: string; name: string };
  startDate: string;
  endDate: string | null;
  status: "active" | "paused" | "ended";
  goals: string;
  cadenceDays: number;
  activityCount: number;
  lastActivityOn: string | null;
  isDemo: boolean;
  can: { manage: boolean; log: boolean };
}
export interface ActivityView { id: string; type: string; occurredOn: string; durationMinutes: number | null; summary: string; outcome: string | null; by: { id: string; name: string } }
export interface MenteeFactors {
  assignmentId: string;
  mentee: { id: string; name: string };
  overlapDays: number;
  durationFactor: number;
  mentorCount: number;
  creditShare: number;
  improvementIndex: number | null;
  detail: { baselineScore: number | null; currentScore: number | null; scoreDelta: number | null; deliveryDelta: number | null; qualityDelta: number | null; goalAchievement: number | null } | null;
  activities: number;
  expectedActivities: number;
  cadenceDays: number;
}
export interface Effectiveness {
  mentor: { id: string; name: string };
  development: { value: number | null; state: string; sampleSize: number; notes: string[] };
  activity: { value: number | null; state: string; sampleSize: number; notes: string[] };
  menteeCount: number;
  averageDays: number | null;
  mentees: MenteeFactors[];
}
export interface EffectivenessResult { period: { id: string; name: string; status: string }; settings: { minDays: number; k: number }; mentors: Effectiveness[]; caveats: string[] }

export const ACTIVITY_LABEL: Record<string, string> = { one_on_one: "One-to-one", feedback: "Feedback", review: "Review", unblock: "Unblocking", training: "Training", goal_setting: "Goal setting" };
export const listAssignments = () => api<AssignmentView[]>("/api/mentorship/assignments");
export const createAssignment = (b: { mentorId: string; menteeId: string; startDate?: string; goals?: string; cadenceDays?: number }) => api<AssignmentView>("/api/mentorship/assignments", { method: "POST", body: b });
export const updateAssignment = (id: string, b: { goals?: string; cadenceDays?: number; status?: "active" | "paused" | "ended"; endDate?: string }) => api<AssignmentView>(`/api/mentorship/assignments/${id}`, { method: "PATCH", body: b });
export const listActivities = (id: string) => api<ActivityView[]>(`/api/mentorship/assignments/${id}/activities`);
export const logActivity = (id: string, b: { type: string; occurredOn?: string; durationMinutes?: number | null; summary: string; outcome?: string | null }) => api<ActivityView>(`/api/mentorship/assignments/${id}/activities`, { method: "POST", body: b });
export const getEffectiveness = (periodId: string) => api<EffectivenessResult>(`/api/mentorship/effectiveness?periodId=${encodeURIComponent(periodId)}`);
