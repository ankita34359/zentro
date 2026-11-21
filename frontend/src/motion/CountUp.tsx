import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { duration, ease } from "@/lib/motion";

// The CSS ease-out curve (--ease-out) evaluated at t, so the count-up matches the other motion.
const [x1, y1, x2, y2] = ease.out;
function easeOut(t: number): number {
  const bez = (a: number, b: number, u: number) => 3 * a * (1 - u) ** 2 * u + 3 * b * (1 - u) * u ** 2 + u ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (bez(x1, x2, mid) < t) lo = mid;
    else hi = mid;
  }
  return bez(y1, y2, (lo + hi) / 2);
}

/**
 * A number that counts up to its value. Tabular digits so the width does not jitter. With reduced motion it simply
 * shows the final value. Screen readers get the final value only (never the in-between numbers).
 */
export function CountUp({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  seconds = duration.data,
  className,
  locale,
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  seconds?: number;
  className?: string;
  locale?: string;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  const from = useRef(reduced ? value : 0);

  useEffect(() => {
    if (reduced) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = from.current;
    const t0 = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - t0) / (seconds * 1000));
      const v = start + (value - start) * easeOut(t);
      from.current = v;
      setShown(v);
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [value, reduced, seconds]);

  const fmt = new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (
    <span className={className}>
      <span aria-hidden="true" className="tabular-nums" data-testid="countup-visual">
        {prefix}
        {fmt.format(shown)}
        {suffix}
      </span>
      <span className="sr-only">
        {prefix}
        {fmt.format(value)}
        {suffix}
      </span>
    </span>
  );
}
