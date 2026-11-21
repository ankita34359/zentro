import { m, useReducedMotion } from "motion/react";
import { useRef, type ReactNode } from "react";
import { duration, ease, riseDistance, staggerStep } from "@/lib/motion";
import { useMotionReady } from "./MotionProvider";

const container = { hidden: {}, show: { transition: { staggerChildren: staggerStep } } };
const show = { opacity: 1, y: 0, transition: { duration: duration.slow, ease: ease.out } };
const itemRise = { hidden: { opacity: 0, y: riseDistance * 1.5 }, show };
const itemFade = { hidden: { opacity: 0 }, show }; // reduced motion: fade only, no offset at any frame

/** Children wrapped in <StaggerItem> enter one after another (50 ms apart). Pass `replayKey` to replay on demand. */
export function Stagger({ children, className, replayKey }: { children: ReactNode; className?: string; replayKey?: number }) {
  const ready = useMotionReady();
  const play = useRef(ready).current;
  return (
    <m.div key={replayKey} className={className} variants={container} initial={play || replayKey ? "hidden" : false} animate="show">
      {children}
    </m.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <m.div className={className} variants={reduced ? itemFade : itemRise}>
      {children}
    </m.div>
  );
}
