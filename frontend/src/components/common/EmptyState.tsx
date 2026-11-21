import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** What a brand-new organization sees: what this page is for, why it is empty, and what to do next. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 rounded-lg border border-dashed bg-card px-6 py-12 text-center", className)}>
      {Icon && (
        <span className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Icon aria-hidden="true" className="size-5" />
        </span>
      )}
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <div className="max-w-prose text-sm text-muted-foreground">{children}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
