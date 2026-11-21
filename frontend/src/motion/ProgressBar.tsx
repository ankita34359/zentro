import { m, useReducedMotion } from "motion/react";
import { useRef } from "react";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { useMotionReady } from "./MotionProvider";

export type Tone = "primary" | "on-track" | "at-risk" | "off-track" | "info";
const TONE: Record<Tone, string> = {
  primary: "bg-primary",
  "on-track": "bg-on-track",
  "at-risk": "bg-at-risk",
  "off-track": "bg-off-track",
  info: "bg-info",
};

/** A horizontal bar that fills to value/max (0 to 1 of the track). The fill animates once, instantly with reduced motion. */
export function ProgressBar({
  value,
  max = 1,
  label,
  tone = "primary",
  className,
}: {
  value: number;
  max?: number;
  label: string;
  tone?: Tone;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const ready = useMotionReady();
  // Reduced motion: start at the final value, so nothing animates at all.
  const play = useRef(ready && !reduced).current;
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <m.div
        className={cn("h-full rounded-full", TONE[tone])}
        initial={play ? { width: "0%" } : false}
        animate={{ width: `${pct}%` }}
        transition={{ duration: reduced ? 0 : duration.data, ease: ease.out }}
      />
    </div>
  );
}
