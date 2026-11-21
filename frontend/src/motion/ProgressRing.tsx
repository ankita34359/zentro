import { m, useReducedMotion } from "motion/react";
import { useId, useRef, type ReactNode } from "react";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { useMotionReady } from "./MotionProvider";

/**
 * A ring that fills to value/max. The arc animates once on mount (instantly with reduced motion). An empty ring
 * (0) draws only the track, never a stray dot. `children` sits in the middle.
 */
export function ProgressRing({
  value,
  max,
  label,
  size = 96,
  strokeWidth = 8,
  children,
  className,
}: {
  value: number;
  max: number;
  /** Spoken description, for example "Getting started steps done". */
  label: string;
  size?: number;
  strokeWidth?: number;
  children?: ReactNode;
  className?: string;
}) {
  const id = useId();
  const reduced = useReducedMotion();
  const ready = useMotionReady();
  // Reduced motion: start at the final value, so nothing animates at all.
  const play = useRef(ready && !reduced).current;
  const fraction = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const r = (size - strokeWidth) / 2;
  const c = size / 2;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value} of ${max}`}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--primary)" />
            <stop offset="100%" stopColor="var(--accent)" />
          </linearGradient>
        </defs>
        <circle cx={c} cy={c} r={r} fill="none" strokeWidth={strokeWidth} className="stroke-muted" />
        {fraction > 0 && (
          <m.circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            stroke={`url(#${id})`}
            initial={play ? { pathLength: 0 } : false}
            animate={{ pathLength: fraction }}
            transition={{ duration: reduced ? 0 : duration.data, ease: ease.out, delay: reduced ? 0 : 0.1 }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}
