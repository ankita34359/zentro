import { Navigate, Outlet, useLocation } from "react-router";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { ErrorState } from "@/components/common/ErrorState";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Route guard. Signed out goes to /login (and comes back to the page afterwards); signed in without an organization
 * goes to /onboarding. This only chooses the screen: the server refuses the data either way.
 */
export function RequireAuth() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === "loading") return <PageSkeleton />;
  if (auth.status === "error") return <ErrorState title="Could not check your sign-in" error={auth.error} onRetry={auth.retry} />;
  if (auth.status === "signedOut") return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (auth.status === "needsOnboarding") return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}
