import { api } from "@/services/api";

export interface Ref { id: string; name: string }
export type Placed = Ref & { type: string };

export interface PersonSummary {
  id: string;
  displayName: string;
  status: string;
  hasLogin: boolean;
  archived: boolean;
  isDemo?: boolean;
  designation: Ref | null;
  departments: Placed[];
  teams: Placed[];
  managers: Placed[];
  email: string | null;
}
export interface PeopleList { people: PersonSummary[]; total: number; limit: number; offset: number }

export interface PersonProfile extends PersonSummary {
  roleFamily: Ref | null;
  departmentRows: { rowId: string; department: Ref; type: string; startDate: string; endDate: string | null }[];
  teamRows: { rowId: string; team: Ref; departmentId: string; type: string; allocationPct: number; startDate: string; endDate: string | null }[];
  managerRows: { rowId: string; manager: Ref; type: string; startDate: string; endDate: string | null; reason: string | null }[];
  directReports: Placed[];
  employment: { employeeCode: string | null; employmentType: string | null; startDate: string | null; endDate: string | null } | null;
  can: { edit: boolean; manageHierarchy: boolean; archive: boolean; restore: boolean };
}
export interface HistoryEntry { id: string; label: string; detail: string | null; startDate: string; endDate: string | null }
export interface PersonHistory { designations: HistoryEntry[]; departments: HistoryEntry[]; teams: HistoryEntry[]; managers: HistoryEntry[]; reports: HistoryEntry[] }

export interface TreeNode {
  kind: "person" | "department" | "team";
  id: string;
  name: string;
  subtitle: string | null;
  childCount: number;
  children: TreeNode[] | null;
  detail?: string | null;
  isDemo?: boolean;
}
export interface Tree { view: string; asOf: string; nodes: TreeNode[]; partial: boolean }

export type ListQuery = { search?: string; departmentId?: string; teamId?: string; designationId?: string; includeArchived?: boolean; limit?: number; offset?: number };
const qs = (o: Record<string, string | number | boolean | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "" && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const listPeople = (q: ListQuery = {}) => api<PeopleList>(`/api/employees${qs(q)}`);
export const getPerson = (id: string) => api<PersonProfile>(`/api/employees/${id}`);
export const getHistory = (id: string) => api<PersonHistory>(`/api/employees/${id}/history`);
export const getTree = (q: { view: "reporting" | "organization"; root?: string; rootKind?: "department" | "team"; depth?: number }) => api<Tree>(`/api/hierarchy/tree${qs(q)}`);

type Body = Record<string, unknown>;
const post = <T>(path: string, body?: Body) => api<T>(path, { method: "POST", body });
const patch = <T>(path: string, body: Body) => api<T>(path, { method: "PATCH", body });

export interface NewPerson { name: string; workEmail?: string; employeeCode?: string; employmentType?: string; startDate?: string; designationId?: string; departmentId?: string; teamId?: string; managerId?: string }
export const createPerson = (b: NewPerson) => post<{ id: string }>("/api/employees", { ...b });
export const updatePerson = (id: string, b: { name?: string; workEmail?: string | null; employeeCode?: string | null; employmentType?: string | null; startDate?: string | null; endDate?: string | null }) => patch<{ id: string }>(`/api/employees/${id}`, b);
export const setDesignation = (id: string, b: { designationId: string; startDate?: string; reason?: string }) => post<{ id: string }>(`/api/employees/${id}/designation`, b);
export const archivePerson = (id: string) => post<{ archived: true }>(`/api/employees/${id}/archive`);
export const restorePerson = (id: string) => post<{ id: string }>(`/api/employees/${id}/restore`);

export const addReporting = (b: { subordinateId: string; managerId: string; type?: string; startDate?: string; reason?: string }) => post<{ id: string; endedPrimary: string | null }>("/api/hierarchy/reporting", b);
export const endReporting = (id: string, b: { endDate?: string; reason?: string } = {}) => patch<{ id: string }>(`/api/hierarchy/reporting/${id}`, b);
export const movePerson = (b: { membershipId: string; toTeamId?: string; toDepartmentId?: string; effectiveDate?: string; reason?: string }) => post<{ moved: true }>("/api/hierarchy/move", b);
export const addTeamMember = (teamId: string, b: { membershipId: string; type?: string; allocationPct?: number; startDate?: string }) => post<{ id: string }>(`/api/teams/${teamId}/members`, b);
export const changeTeamMember = (teamId: string, rowId: string, b: { type?: string; allocationPct?: number; endDate?: string; effectiveDate?: string }) => patch<{ id: string }>(`/api/teams/${teamId}/members/${rowId}`, b);
export const addDepartmentMember = (deptId: string, b: { membershipId: string; type?: string; startDate?: string }) => post<{ id: string }>(`/api/departments/${deptId}/members`, b);
export const changeDepartmentMember = (deptId: string, rowId: string, b: { type?: string; endDate?: string; effectiveDate?: string }) => patch<{ id: string }>(`/api/departments/${deptId}/members/${rowId}`, b);

export const EMPLOYMENT_LABEL: Record<string, string> = { full_time: "Full time", part_time: "Part time", contractor: "Contractor", internship: "Internship" };
export const TEAM_ROLE_LABEL: Record<string, string> = { lead: "Lead", deputy_lead: "Deputy lead", member: "Member" };
export const DEPT_ROLE_LABEL: Record<string, string> = { head: "Head", deputy: "Deputy", member: "Member" };
export const LINE_LABEL: Record<string, string> = { primary: "Primary", secondary: "Secondary", dotted: "Dotted line", project: "Project" };
export const initials = (name: string): string => (name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?");
