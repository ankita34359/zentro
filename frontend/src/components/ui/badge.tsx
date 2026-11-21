import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-caption font-medium whitespace-nowrap [&_svg]:size-3.5",
  {
    variants: {
      variant: {
        neutral: "border-transparent bg-muted text-muted-foreground",
        outline: "bg-transparent text-muted-foreground",
        primary: "border-transparent bg-primary-soft text-primary-soft-foreground",
        // Status colours have one fixed meaning each (docs/frontend-structure.md section 11).
        onTrack: "border-transparent bg-on-track-soft text-on-track-ink",
        atRisk: "border-transparent bg-at-risk-soft text-at-risk-ink",
        offTrack: "border-transparent bg-off-track-soft text-off-track-ink",
        info: "border-transparent bg-info-soft text-info-ink",
        dashed: "border-dashed bg-transparent text-muted-foreground",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
