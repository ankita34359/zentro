import { m, useReducedMotion } from "motion/react";
import { useRef, type ReactNode } from "react";
import { duration, ease, riseDistance } from "@/lib/motion";
import { useMotionReady } from "./MotionProvider";

/** Short fade and rise when a page appears. No exit animation, so navigation is never delayed. */
export function PageTransition({ children }: { children: ReactNode }) {
  const ready = useMotionReady();
  const reduced = useReducedMotion();
  const play = useRef(ready).current; // decided at mount: skip the entrance if the engine has not loaded yet
  return (
    <m.div
      // Reduced motion: a plain fade; no offset is ever applied, not even for one frame.
      initial={play ? (reduced ? { opacity: 0 } : { opacity: 0, y: riseDistance }) : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.base, ease: ease.out }}
    >
      {children}
    </m.div>
  );
}
