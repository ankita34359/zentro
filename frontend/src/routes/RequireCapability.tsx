import { Outlet } from "react-router";
import { EmptyState } from "@/components/common/EmptyState";
import { PageHeader } from "@/components/common/PageHeader";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Shows the page only to people who hold at least one of the permissions. This only chooses the screen: the server
 * refuses the data whatever the browser does. (Signed-out and no-organization cases are handled by RequireAuth above.)
 */
export function RequireCapability({ any }: { any: string[] }) {
  const { can } = useAuth();
  if (any.some(can)) return <Outlet />;
  return (
    <>
      <PageHeader eyebrow="Settings" title="Not available" description="Your roles do not allow this page." />
      <EmptyState illustration="settings" title="You do not have access to this page">
        <p>Ask an administrator of your organization if you think you should.</p>
      </EmptyState>
    </>
  );
}
