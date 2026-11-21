import { Skeleton } from "@/components/ui/skeleton";

/** Page-level loading state (skeletons, not spinners). Announced politely to screen readers. */
export function PageSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-6">
      <span className="sr-only">Loading</span>
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-56 w-full" />
    </div>
  );
}
