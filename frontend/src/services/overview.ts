import { api } from "@/services/api";

export interface ChecklistItem { key: string; label: string; to: string; done: boolean; stage: string | null }
export interface Overview {
  today: string;
  preset: "personal" | "team" | "executive";
  personal: { open: number; overdue: number; dueToday: number; blocked: number; completedRecently: number; unreadNotifications: number; next: { id: string; title: string; reasons: string[] } | null };
  team: null | { label: string; people: number; openTasks: number; overdueTasks: number; blockedTasks: number; completedRecently: number; needsAttention: { id: string; name: string; overdue: number; blocked: number }[] };
  organization: null | {
    people: number;
    departments: number;
    teams: number;
    tasksByStatus: Record<string, number>;
    overdueTasks: number;
    openTasks: number;
    completedByDay: { date: string; count: number }[];
    departmentLoad: { id: string; name: string; people: number; open: number; overdue: number }[];
  };
  checklist: ChecklistItem[];
  flags: { demoLoaded: boolean; canManageDemo: boolean; canSetUp: boolean };
}
export const getOverview = () => api<Overview>("/api/overview");
