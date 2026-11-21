import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Placeholder block shown while data loads. Decorative: the surrounding region carries the "loading" announcement. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}
