import { api, ApiError } from "./api";

export interface Me {
  user: { id: string; email: string; name: string };
  organization: { id: string; name: string; slug: string; timezone: string } | null;
  membership: { id: string; displayName: string } | null;
  roles: { key: string; name: string }[];
  /** `{ permissionKey: [scope modes] }`. Only used to choose screens; the server decides access. */
  capabilities: Record<string, string[]>;
  baseline: string[];
  needsOnboarding: boolean;
}

export const getMe = (signal?: AbortSignal) => api<Me>("/api/auth/me", { signal });
export const login = (body: { email: string; password: string }) => api<Me>("/api/auth/login", { method: "POST", body });
export const register = (body: { email: string; name: string; password: string; registrationCode: string }) =>
  api<{ registered: true; message: string }>("/api/auth/register", { method: "POST", body });
export const logout = () => api<{ loggedOut: true }>("/api/auth/logout", { method: "POST" });
export const createOrganization = (body: { name: string; timezone: string }) => api<Me>("/api/organizations", { method: "POST", body });

// ---------- stage 2.2: invitations, reset, change password ----------

export interface InvitationView {
  id: string;
  membershipId: string;
  email: string;
  displayName: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  invitedBy: string | null;
  roleName: string | null;
}
export interface IssuedInvitation {
  invitation: InvitationView;
  /** The secret. Shown to the administrator once; the server keeps only its hash. */
  code: string;
  expiresAt: string;
}
export interface MemberView {
  id: string;
  displayName: string;
  email: string | null;
  status: string;
  hasLogin: boolean;
  roles: { key: string; name: string }[];
  /** Active role assignments (to revoke one, or to show an end date). */
  assignments: { id: string; roleId: string; roleName: string; validTo: string | null; scopeType?: string; scopeName?: string | null }[];
  isYou: boolean;
}
export interface InvitationPreview {
  organizationName: string;
  email: string;
  displayName: string;
  expiresAt: string;
}

export const listInvitations = () => api<InvitationView[]>("/api/invitations");
export const createInvitation = (body: { email: string; name?: string; roleId?: string }) => api<IssuedInvitation>("/api/invitations", { method: "POST", body });
export const revokeInvitation = (id: string) => api<InvitationView>(`/api/invitations/${id}/revoke`, { method: "POST" });
export const regenerateInvitation = (id: string) => api<IssuedInvitation>(`/api/invitations/${id}/regenerate`, { method: "POST" });
export const listMembers = () => api<MemberView[]>("/api/organization/members");
export const createResetLink = (membershipId: string) =>
  api<{ token: string; expiresAt: string; displayName: string }>(`/api/people/${membershipId}/reset-link`, { method: "POST" });

export const previewInvitation = (code: string) => api<InvitationPreview>("/api/auth/invitation-preview", { method: "POST", body: { code } });
export const acceptInvitation = (body: { code: string; name?: string; email?: string; password?: string }) =>
  api<Me>("/api/auth/accept-invitation", { method: "POST", body });
export const forgotPassword = (email: string) => api<{ accepted: true; message: string }>("/api/auth/forgot-password", { method: "POST", body: { email } });
export const resetPassword = (token: string, password: string) => api<{ reset: true }>("/api/auth/reset-password", { method: "POST", body: { token, password } });
export const changePassword = (currentPassword: string, newPassword: string) =>
  api<{ changed: true }>("/api/auth/change-password", { method: "POST", body: { currentPassword, newPassword } });

/** The links the administrator copies. The secret is in the fragment (#), which browsers never send to any server. */
export const invitationLink = (code: string, origin = window.location.origin) => `${origin}/accept-invite#code=${encodeURIComponent(code)}`;
export const resetLinkUrl = (token: string, origin = window.location.origin) => `${origin}/reset-password#token=${encodeURIComponent(token)}`;
/** Reads `key=value` out of a URL fragment such as "#code=abc". */
export const fragmentParam = (hash: string, key: string): string | null => new URLSearchParams(hash.replace(/^#/, "")).get(key);

// ---------- stage 2.3: roles (read only) and delete my account ----------

export interface RoleView {
  id: string;
  key: string;
  name: string;
  description: string;
  kind: string;
  /** Protected roles (the Owner role) are view only. */
  isProtected: boolean;
  permissionCount: number;
  holderCount: number;
}
export interface RolePermission {
  key: string;
  module: string;
  description: string;
  sensitive: boolean;
  modes: string[];
  allowedModes: string[];
}
export interface RoleDetail extends RoleView {
  permissions: RolePermission[];
}
export const listRoles = () => api<RoleView[]>("/api/roles");
export const getRole = (id: string) => api<RoleDetail>(`/api/roles/${id}`);

export interface DeletionPreview {
  mode: "account_only" | "account_and_organization" | "blocked";
  organizationName: string | null;
  others: number;
  pendingInvitations: number;
  reason: "last_admin" | "pending_invitations" | null;
}
export const deletionPreview = () => api<DeletionPreview>("/api/auth/delete-account/preview");
export const deleteAccountRequest = (body: { password: string; confirmEmail: string; confirmOrganizationName?: string }) =>
  api<{ deleted: true; organizationDeleted: boolean }>("/api/auth/delete-account", { method: "POST", body });

// ---------- stage 2.4: editing roles, assigning them, removing people, the audit log ----------

export interface CatalogPermission {
  key: string;
  module: string;
  description: string;
  modes: string[];
  sensitive: boolean;
}
export const listPermissions = () => api<CatalogPermission[]>("/api/permissions");
export const createRole = (body: { name: string; description?: string; copyFromRoleId?: string }) => api<RoleDetail>("/api/roles", { method: "POST", body });
export const updateRole = (id: string, body: { name?: string; description?: string }) => api<RoleDetail>(`/api/roles/${id}`, { method: "PATCH", body });
export const setRolePermissions = (id: string, body: { grants: { permission: string; mode: string }[]; confirmSensitive?: boolean }) =>
  api<RoleDetail>(`/api/roles/${id}/permissions`, { method: "PUT", body });
export const archiveRole = (id: string) => api<{ archived: true }>(`/api/roles/${id}/archive`, { method: "POST" });

export interface AssignmentView {
  id: string;
  membershipId: string;
  roleId: string;
  roleName: string;
  scopeType: string;
  validFrom: string;
  validTo: string | null;
  revokedAt: string | null;
  grantedBy: string | null;
  state: "active" | "revoked" | "ended" | "scheduled";
}
export const assignRole = (body: { membershipId: string; roleId: string; scopeType?: string; scopeId?: string; validFrom?: string; validTo?: string | null }) =>
  api<AssignmentView>("/api/role-assignments", { method: "POST", body });
export const revokeAssignment = (id: string) => api<AssignmentView>(`/api/role-assignments/${id}/revoke`, { method: "POST" });
export const removePerson = (membershipId: string) => api<{ removed: true }>(`/api/people/${membershipId}/remove`, { method: "POST" });

export interface AuditEntry {
  id: string;
  createdAt: string;
  actor: { membershipId: string | null; name: string | null; type: string };
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  before: unknown;
  after: unknown;
}
export interface AuditPage {
  entries: AuditEntry[];
  nextCursor: string | null;
}
/** The audit log, newest first. `api()` returns `data` only, so the cursor is read from the response meta here. */
export async function listAudit(params: { action?: string; from?: string; to?: string; cursor?: string; limit?: number }): Promise<AuditPage> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  const res = await fetch(`/api/audit-logs${q.size ? `?${q}` : ""}`, { credentials: "same-origin", headers: { Accept: "application/json" } });
  const json = (await res.json().catch(() => null)) as { data?: AuditEntry[]; meta?: { page?: { nextCursor?: string | null } }; error?: { code?: string; message?: string } } | null;
  if (!res.ok || !json?.data) throw new ApiError("api", res.status, json?.error?.code ?? "bad_response", json?.error?.message ?? "The audit log could not be read");
  return { entries: json.data, nextCursor: json.meta?.page?.nextCursor ?? null };
}

/** Can the signed-in person GIVE this permission in this mode? (A convenience for the editor; the server enforces it.) */
export function canGrantMode(capabilities: Record<string, string[]>, permission: string, mode: string): boolean {
  const held = capabilities[permission];
  if (!held) return false;
  return held.includes("all_in_scope") || held.includes(mode) || (mode === "own" && (held.includes("reports") || held.includes("my_teams")));
}
