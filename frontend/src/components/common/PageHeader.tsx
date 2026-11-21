import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The one page header: a tiny uppercase section label (eyebrow), a bold tight title, a one-line description and
 * optional actions. The brand-gradient glow behind it is on by default (`glow={false}` to turn it off).
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  glow = true,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  glow?: boolean;
}) {
  return (
    <div className={cn("relative isolate mb-8 flex flex-wrap items-start justify-between gap-3", glow && "heading-glow")}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2 text-primary-ink">{eyebrow}</p>}
        <h1 className="text-title font-bold">{title}</h1>
        {description && <p className="mt-2 max-w-prose text-body text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
