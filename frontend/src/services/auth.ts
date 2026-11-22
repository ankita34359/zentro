import { api } from "./api";

export interface Me {
  user: { id: string; email: string; name: string };
  organization: { id: string; name: string; slug: string; timezone: string } | null;
  membership: { id: string; displayName: string } | null;
  roles: string[];
  capabilities: string[];
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
  roles: string[];
  isYou: boolean;
}
export interface InvitationPreview {
  organizationName: string;
  email: string;
  displayName: string;
  expiresAt: string;
}

export const listInvitations = () => api<InvitationView[]>("/api/invitations");
export const createInvitation = (body: { email: string; name?: string }) => api<IssuedInvitation>("/api/invitations", { method: "POST", body });
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
