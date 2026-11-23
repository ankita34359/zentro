import { useId, type ComponentProps } from "react";
import { cn } from "@/lib/cn";

/** A label and a native select wired together with htmlFor (so a screen reader announces just the label, not every option). */
export function SelectField({ label, className, children, ...select }: { label: string } & ComponentProps<"select">) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-label font-medium">
        {label}
      </label>
      <select id={id} className={cn("h-10 w-full rounded-lg border border-input bg-card px-3 text-body text-foreground shadow-xs", className)} {...select}>
        {children}
      </select>
    </div>
  );
}
