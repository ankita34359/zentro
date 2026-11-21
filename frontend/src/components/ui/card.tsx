import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * Fine border, soft indigo-tinted shadow, a gentle hover lift and a gradient border glow on hover and keyboard focus (no
 * movement under reduced motion). `lift={false}` for dense containers; `raised` for the layer above a card.
 */
export function Card({ className, lift = true, raised = false, ...props }: HTMLAttributes<HTMLDivElement> & { lift?: boolean; raised?: boolean }) {
  return <div className={cn("card-surface", lift && "card-lift", raised && "card-raised", className)} {...props} />;
}
export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-5 pb-4", className)} {...props} />;
}
export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-heading font-semibold", className)} {...props} />;
}
export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-label text-muted-foreground", className)} {...props} />;
}
export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}
