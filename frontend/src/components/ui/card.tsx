import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Fine border, soft shadow, gentle hover lift (no movement under reduced motion). `lift={false}` for dense containers. */
export function Card({ className, lift = true, ...props }: HTMLAttributes<HTMLDivElement> & { lift?: boolean }) {
  return <div className={cn("card-surface", lift && "card-lift", className)} {...props} />;
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
