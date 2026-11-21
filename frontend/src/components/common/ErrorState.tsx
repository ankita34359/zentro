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
    <div role="alert" className={cn("flex flex-col items-center gap-3 rounded-xl border border-off-track/30 bg-off-track-soft px-6 py-10 text-center", className)}>
      <span className="flex size-10 items-center justify-center rounded-full bg-card text-off-track-ink shadow-xs">
        <AlertTriangle aria-hidden="true" className="size-5" />
      </span>
      <h2 className="text-heading font-semibold text-off-track-ink">{title}</h2>
      {message && <p className="max-w-prose text-body text-foreground/80">{message}</p>}
      {api?.requestId && (
        <p className="text-caption text-foreground/70">
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
