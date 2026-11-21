import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Loading placeholder with a soft shimmer (it only runs while something is loading; static under reduced motion). */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("skeleton rounded-md", className)} {...props} />;
}
