import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Illustration, type IllustrationName } from "@/components/illustrations";

/** What a brand-new organization sees: a small illustration, what the page is for, why it is empty, what to do next. */
export function EmptyState({
  illustration,
  title,
  children,
  action,
  className,
}: {
  illustration?: IllustrationName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card/60 px-6 py-12 text-center", className)}>
      {illustration && <Illustration name={illustration} />}
      <h2 className="text-heading font-semibold">{title}</h2>
      {children && <div className="max-w-prose text-body text-muted-foreground">{children}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
