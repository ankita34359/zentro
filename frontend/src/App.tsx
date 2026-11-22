import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { MotionProvider } from "@/motion/MotionProvider";
import { AppShell } from "@/layouts/AppShell";
import { ApiError } from "@/services/api";
import { DEFAULT_PATH, NAV_ITEMS } from "@/routes/navigation";

import { PageSkeleton } from "@/components/common/PageSkeleton";
import { AuthProvider } from "@/contexts/AuthContext";
import { RequireAuth } from "@/routes/RequireAuth";
import { RequireCapability } from "@/routes/RequireCapability";
import {
  AcceptInvitePage,
  DesignPage,
  ForgotPasswordPage,
  LoginPage,
  NotFoundPage,
  OnboardingPage,
  OverviewPage,
  ProfilePage,
  RegisterPage,
  ResetPasswordPage,
  RolesPage,
  SectionPage,
  SettingsPage,
  UsersPage,
} from "@/routes/pages";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // A 4xx will not get better by asking again; network and server errors are retried once.
        retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 1,
      },
    },
  });
}

export function AppProviders({ children, client }: { children: ReactNode; client?: QueryClient }) {
  return (
    <QueryClientProvider client={client ?? createQueryClient()}>
      <ThemeProvider>
        <MotionProvider>
          <AuthProvider>{children}</AuthProvider>
        </MotionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      {/* Public pages: reachable when signed out. */}
      <Route path="/login" element={<Suspense fallback={<PageSkeleton />}><LoginPage /></Suspense>} />
      <Route path="/register" element={<Suspense fallback={<PageSkeleton />}><RegisterPage /></Suspense>} />
      <Route path="/onboarding" element={<Suspense fallback={<PageSkeleton />}><OnboardingPage /></Suspense>} />
      <Route path="/forgot-password" element={<Suspense fallback={<PageSkeleton />}><ForgotPasswordPage /></Suspense>} />
      <Route path="/reset-password" element={<Suspense fallback={<PageSkeleton />}><ResetPasswordPage /></Suspense>} />
      <Route path="/accept-invite" element={<Suspense fallback={<PageSkeleton />}><AcceptInvitePage /></Suspense>} />
      <Route element={<AppShell />}>
        {/* Unlisted style guide: deliberately not in the sidebar, and open to everyone. */}
        <Route path="/design" element={<DesignPage />} />
        <Route element={<RequireAuth />}>
          <Route index element={<Navigate to={DEFAULT_PATH} replace />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route element={<RequireCapability any={["invitations.manage", "people.manage"]} />}>
            <Route path="/settings/users" element={<UsersPage />} />
          </Route>
          <Route element={<RequireCapability any={["roles.view"]} />}>
            <Route path="/settings/roles" element={<RolesPage />} />
          </Route>
          <Route path="/settings/profile" element={<ProfilePage />} />
          {NAV_ITEMS.filter((n) => n.key !== "overview" && n.key !== "settings").map((n) => (
            <Route key={n.key} path={`${n.path}/*`} element={<SectionPage sectionKey={n.key} />} />
          ))}
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  );
}
