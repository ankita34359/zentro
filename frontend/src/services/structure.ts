import { api } from "@/services/api";

export interface DepartmentItem { id: string; parentId: string | null; name: string; description: string; archived: boolean; archivedAt: string | null; isDemo?: boolean }
export interface TeamItem { id: string; departmentId: string; parentTeamId: string | null; name: string; description: string; archived: boolean; archivedAt: string | null; isDemo?: boolean }
export interface RoleFamilyItem { id: string; name: string; description: string; archived: boolean; archivedAt: string | null; isDemo?: boolean }
export interface DesignationItem { id: string; roleFamilyId: string | null; name: string; description: string; archived: boolean; archivedAt: string | null; isDemo?: boolean }
export interface Structure {
  departments: DepartmentItem[];
  teams: TeamItem[];
  roleFamilies: RoleFamilyItem[];
  designations: DesignationItem[];
  limits: { maxDepth: number };
  /** The caller's `org.view` is scoped, so only their part of the structure is shown. */
  partial: boolean;
}

export const getStructure = () => api<Structure>("/api/organization/structure");
export const renameOrganization = (name: string) => api<{ id: string; name: string }>("/api/organization", { method: "PATCH", body: { name } });

type Body = Record<string, unknown>;
const post = <T>(path: string, body?: Body) => api<T>(path, { method: "POST", body });
const patch = <T>(path: string, body: Body) => api<T>(path, { method: "PATCH", body });

export const createDepartment = (b: { name: string; description?: string; parentId?: string | null }) => post<DepartmentItem>("/api/departments", b);
export const updateDepartment = (id: string, b: { name?: string; description?: string; parentId?: string | null }) => patch<DepartmentItem>(`/api/departments/${id}`, b);
export const archiveDepartment = (id: string) => post<{ archived: true }>(`/api/departments/${id}/archive`);
export const restoreDepartment = (id: string) => post<DepartmentItem>(`/api/departments/${id}/restore`);

export const createTeam = (b: { name: string; description?: string; departmentId: string; parentTeamId?: string | null }) => post<TeamItem>("/api/teams", b);
export const updateTeam = (id: string, b: { name?: string; description?: string; departmentId?: string; parentTeamId?: string | null }) => patch<TeamItem>(`/api/teams/${id}`, b);
export const archiveTeam = (id: string) => post<{ archived: true }>(`/api/teams/${id}/archive`);
export const restoreTeam = (id: string) => post<TeamItem>(`/api/teams/${id}/restore`);

export const createRoleFamily = (b: { name: string; description?: string }) => post<RoleFamilyItem>("/api/role-families", b);
export const updateRoleFamily = (id: string, b: { name?: string; description?: string }) => patch<RoleFamilyItem>(`/api/role-families/${id}`, b);
export const archiveRoleFamily = (id: string) => post<{ archived: true }>(`/api/role-families/${id}/archive`);
export const restoreRoleFamily = (id: string) => post<RoleFamilyItem>(`/api/role-families/${id}/restore`);

export const createDesignation = (b: { name: string; description?: string; roleFamilyId?: string | null }) => post<DesignationItem>("/api/designations", b);
export const updateDesignation = (id: string, b: { name?: string; description?: string; roleFamilyId?: string | null }) => patch<DesignationItem>(`/api/designations/${id}`, b);
export const archiveDesignation = (id: string) => post<{ archived: true }>(`/api/designations/${id}/archive`);
export const restoreDesignation = (id: string) => post<DesignationItem>(`/api/designations/${id}/restore`);
