import { LazyMotion, MotionConfig } from "motion/react";
import { useSyncExternalStore, type ReactNode } from "react";

/**
 * `motion` with LazyMotion: the first paint only carries the tiny `m` components; the animation features arrive in a
 * separate chunk that starts loading immediately. Until it has arrived, animated components simply render in their
 * final state (no entrance), so a slow or failed chunk can never hide content or leave anything half-animated.
 *
 * reducedMotion="user": when the operating system asks for reduced motion, movement (transforms) is switched off
 * and only fades remain. Components that animate other properties (width, numbers) also check useReducedMotion().
 */
let ready = false;
const listeners = new Set<() => void>();

const featuresPromise = import("./features").then((mod) => {
  ready = true;
  listeners.forEach((l) => l());
  return mod.default;
});

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** True once the animation features have loaded. Read it ONCE at mount to decide whether to play an entrance. */
export function useMotionReady(): boolean {
  return useSyncExternalStore(subscribe, () => ready, () => false);
}

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={() => featuresPromise} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  );
}
