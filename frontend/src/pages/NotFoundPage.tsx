import { Link } from "react-router";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  return (
    <EmptyState
      illustration="compass"
      title="Page not found"
      action={
        <Button asChild>
          <Link to="/overview">Go to Overview</Link>
        </Button>
      }
      className="mt-8"
    >
      <p>There is nothing at this address. It may have moved, or the link may be wrong.</p>
    </EmptyState>
  );
}
