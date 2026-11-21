import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { MotionProvider } from "@/motion/MotionProvider";
import { AppShell } from "@/layouts/AppShell";
import { ApiError } from "@/services/api";
import { DEFAULT_PATH, NAV_ITEMS } from "@/routes/navigation";

// Pages load on demand (one small chunk each), so the first paint only pays for the shell.
const OverviewPage = lazy(() => import("@/pages/OverviewPage"));
const SectionPage = lazy(() => import("@/pages/SectionPage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));
const DesignPage = lazy(() => import("@/pages/DesignPage"));

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
        <MotionProvider>{children}</MotionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to={DEFAULT_PATH} replace />} />
        <Route path="/overview" element={<OverviewPage />} />
        {/* Unlisted style guide: deliberately not in the sidebar. */}
        <Route path="/design" element={<DesignPage />} />
        {NAV_ITEMS.filter((n) => n.key !== "overview").map((n) => (
          <Route key={n.key} path={`${n.path}/*`} element={<SectionPage sectionKey={n.key} />} />
        ))}
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
