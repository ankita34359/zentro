import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { ApiError, setUnauthenticatedHandler } from "@/services/api";
import { acceptInvitation as acceptInvitationRequest, createOrganization as createOrganizationRequest, getMe, login as loginRequest, logout as logoutRequest, type Me } from "@/services/auth";

/** loading: not known yet · signedOut: no session · needsOnboarding: signed in, no organization · ready: signed in with an organization */
export type AuthStatus = "loading" | "signedOut" | "needsOnboarding" | "ready" | "error";

interface AuthValue {
  status: AuthStatus;
  me: Me | null;
  error: unknown;
  login: (email: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  createOrganization: (name: string, timezone: string) => Promise<Me>;
  acceptInvitation: (body: { code: string; name?: string; email?: string; password?: string }) => Promise<Me>;
  retry: () => void;
}

const ME_KEY = ["auth", "me"] as const;
const AuthContext = createContext<AuthValue | null>(null);

/**
 * Who is signed in, from the server (GET /api/auth/me). The browser never decides access: this only chooses which
 * screen to show; the server refuses everything else. A 401 anywhere turns the state into "signed out".
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ME_KEY,
    queryFn: async ({ signal }): Promise<Me | null> => {
      try {
        return await getMe(signal);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    setUnauthenticatedHandler(() => client.setQueryData(ME_KEY, null));
    return () => setUnauthenticatedHandler(null);
  }, [client]);

  const login = useCallback(
    async (email: string, password: string) => {
      const me = await loginRequest({ email, password });
      client.setQueryData(ME_KEY, me);
      return me;
    },
    [client],
  );

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      // Whatever the server said, this browser forgets the person and everything loaded for them.
      client.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] });
      client.setQueryData(ME_KEY, null);
    }
  }, [client]);

  const createOrganization = useCallback(
    async (name: string, timezone: string) => {
      const me = await createOrganizationRequest({ name, timezone });
      client.setQueryData(ME_KEY, me);
      return me;
    },
    [client],
  );

  const acceptInvitation = useCallback(
    async (body: { code: string; name?: string; email?: string; password?: string }) => {
      const me = await acceptInvitationRequest(body);
      client.setQueryData(ME_KEY, me);
      return me;
    },
    [client],
  );

  const value = useMemo<AuthValue>(() => {
    const me = query.data ?? null;
    const status: AuthStatus = query.isPending ? "loading" : query.isError ? "error" : !me ? "signedOut" : me.needsOnboarding ? "needsOnboarding" : "ready";
    return { status, me, error: query.error, login, logout, createOrganization, acceptInvitation, retry: () => void query.refetch() };
  }, [query, login, logout, createOrganization, acceptInvitation]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
