import { CountUp } from "@/motion/CountUp";
import { cn } from "@/lib/cn";

/** A hero metric: tiny uppercase label over a big bold tabular number in the brand gradient (counts up on mount). */
export function Metric({
  label,
  value,
  decimals,
  prefix,
  suffix,
  className,
}: {
  label: string;
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="eyebrow mb-1.5 text-muted-foreground">{label}</p>
      <p className="text-hero font-bold tabular-nums">
        <CountUp value={value} decimals={decimals} prefix={prefix} suffix={suffix} className="text-gradient" />
      </p>
    </div>
  );
}
