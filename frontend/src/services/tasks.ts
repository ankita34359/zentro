import { api } from "@/services/api";

export interface Ref { id: string; name: string }
export interface Assignee { assignmentId: string; kind: "person" | "team"; id: string; name: string; role: string }
export interface TaskSummary {
  id: string;
  title: string;
  status: string;
  priority: string;
  importanceWeight: number;
  progressPct: number;
  startDate: string | null;
  dueAt: string | null;
  overdue: boolean;
  estimatedMinutes: number | null;
  actualMinutes: number;
  blockedReason: string | null;
  team: Ref | null;
  createdBy: Ref;
  assignees: Assignee[];
  completedAt: string | null;
  isDemo: boolean;
}
export interface TaskDetail extends TaskSummary {
  description: string;
  parentTaskId: string | null;
  createdAt: string;
  updatedAt: string;
  can: { edit: boolean; editEstimate: boolean; update: boolean; assign: boolean; comment: boolean };
  nextStatuses: string[];
}
export interface TaskList { tasks: TaskSummary[]; total: number; limit: number; offset: number }
export interface UpdateEntry { id: string; type: string; author: Ref; fromStatus: string | null; toStatus: string | null; progressPct: number | null; minutesLogged: number | null; body: string | null; createdAt: string }
export interface CommentEntry { id: string; author: Ref; body: string; edited: boolean; createdAt: string; mine: boolean }
export interface MyWork {
  today: string;
  counts: { open: number; overdue: number; dueToday: number; blocked: number; completedRecently: number };
  overdue: TaskSummary[];
  dueToday: TaskSummary[];
  upcoming: TaskSummary[];
  blocked: TaskSummary[];
  inProgress: TaskSummary[];
  unscheduled: TaskSummary[];
  suggested: { task: TaskSummary; score: number; reasons: string[] }[];
  achievements: TaskSummary[];
  dailyUpdate: { date: string; summary: string; blockers: string | null; submittedAt: string } | null;
}
export interface NotificationEntry { id: string; type: string; title: string; body: string | null; severity: string; entityType: string | null; entityId: string | null; read: boolean; createdAt: string }
export interface Inbox { notifications: NotificationEntry[]; unreadCount: number; nextCursor: string | null }
export interface PrefType { type: string; label: string; description: string; inApp: boolean }

export type TaskQuery = { status?: string; priority?: string; overdue?: boolean; blocked?: boolean; mine?: boolean; search?: string; assigneeId?: string; teamId?: string; limit?: number; offset?: number };
const qs = (o: Record<string, string | number | boolean | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "" && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
type Body = Record<string, unknown>;
const post = <T>(path: string, body?: Body) => api<T>(path, { method: "POST", body });

export const listTasks = (q: TaskQuery = {}) => api<TaskList>(`/api/tasks${qs(q)}`);
export const getTask = (id: string) => api<TaskDetail>(`/api/tasks/${id}`);
export const getUpdates = (id: string) => api<UpdateEntry[]>(`/api/tasks/${id}/updates`);
export const getComments = (id: string) => api<CommentEntry[]>(`/api/tasks/${id}/comments`);
export interface NewTask { title: string; description?: string; priority?: string; importanceWeight?: number; startDate?: string; dueAt?: string; estimatedMinutes?: number; teamId?: string; assigneeIds?: string[]; assigneeTeamId?: string }
export const createTask = (b: NewTask) => post<TaskDetail>("/api/tasks", { ...b });
export const updateTask = (id: string, b: { title?: string; description?: string; priority?: string; importanceWeight?: number; startDate?: string | null; dueAt?: string | null; estimatedMinutes?: number | null }) => api<TaskDetail>(`/api/tasks/${id}`, { method: "PATCH", body: b });
export const addTaskUpdate = (id: string, b: { type: "status_change" | "progress" | "time_log" | "blocker"; toStatus?: string; progressPct?: number; minutesLogged?: number; note?: string }) => post<TaskDetail>(`/api/tasks/${id}/updates`, b);
export const assignTask = (id: string, b: { assigneeId?: string; teamId?: string; role?: string }) => post<TaskDetail>(`/api/tasks/${id}/assignments`, b);
export const unassignTask = (id: string, assignmentId: string) => post<TaskDetail>(`/api/tasks/${id}/assignments/${assignmentId}/end`);
export const addComment = (id: string, body: string) => post<CommentEntry>(`/api/tasks/${id}/comments`, { body });
export const deleteComment = (id: string, commentId: string) => api<{ deleted: true }>(`/api/tasks/${id}/comments/${commentId}`, { method: "DELETE" });

export const getMyWork = () => api<MyWork>("/api/my-work");
export const sendDailyUpdate = (b: { summary: string; blockers?: string | null; date?: string }) => post<{ date: string; summary: string; blockers: string | null; replaced: boolean }>("/api/daily-updates", { ...b });

export const getInbox = (q: { unread?: boolean; limit?: number; cursor?: string } = {}) => api<Inbox>(`/api/notifications${qs(q)}`);
export const markRead = (id: string) => post<{ unreadCount: number }>(`/api/notifications/${id}/read`);
export const markAllRead = () => post<{ marked: number; unreadCount: number }>("/api/notifications/read-all");
export const getPreferences = () => api<{ types: PrefType[] }>("/api/preferences");
export const savePreferences = (types: { type: string; inApp: boolean }[]) => api<{ types: PrefType[] }>("/api/preferences", { method: "PUT", body: { types } });

export const STATUS_LABEL: Record<string, string> = { not_started: "Not started", in_progress: "In progress", blocked: "Blocked", under_review: "Under review", completed: "Completed", cancelled: "Cancelled" };
export const PRIORITY_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };
export const minutesLabel = (m: number): string => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);
