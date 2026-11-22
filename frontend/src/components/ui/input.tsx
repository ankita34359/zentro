import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-lg border border-input bg-card px-3 text-body text-foreground shadow-xs transition-[border-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out)] placeholder:text-muted-foreground focus-visible:border-ring disabled:opacity-60 aria-[invalid=true]:border-off-track",
        className,
      )}
      {...props}
    />
  );
}
