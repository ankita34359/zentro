import { AlertTriangle, RotateCw } from "lucide-react";
import { ApiError } from "@/services/api";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

/** Shows what went wrong in plain words, the request id (so a log line can be found) and a retry button. */
export function ErrorState({
  title = "Something went wrong",
  error,
  onRetry,
  className,
}: {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const api = error instanceof ApiError ? error : null;
  const message = api ? api.message : error instanceof Error ? "An unexpected error occurred." : undefined;
  return (
    <div role="alert" className={cn("flex flex-col items-center gap-3 rounded-lg border border-destructive/40 bg-destructive-soft px-6 py-10 text-center", className)}>
      <AlertTriangle aria-hidden="true" className="size-6 text-destructive" />
      <h2 className="text-lg font-semibold">{title}</h2>
      {message && <p className="max-w-prose text-sm text-foreground/80">{message}</p>}
      {api?.requestId && (
        <p className="text-xs text-muted-foreground">
          Request id: <code className="font-mono">{api.requestId}</code>
        </p>
      )}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw aria-hidden="true" /> Try again
        </Button>
      )}
    </div>
  );
}
