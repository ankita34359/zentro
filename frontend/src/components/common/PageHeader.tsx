import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** The one page header: title, one-line description, optional actions. `glow` adds the soft gradient behind it. */
export function PageHeader({ title, description, actions, glow = false }: { title: string; description?: string; actions?: ReactNode; glow?: boolean }) {
  return (
    <div className={cn("relative isolate mb-8 flex flex-wrap items-start justify-between gap-3", glow && "heading-glow")}>
      <div className="min-w-0">
        <h1 className="text-title font-semibold">{title}</h1>
        {description && <p className="mt-1.5 max-w-prose text-body text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
