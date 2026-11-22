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
