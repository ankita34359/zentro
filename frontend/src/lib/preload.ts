import { lazy, type ComponentType, type LazyExoticComponent } from "react";

export type PreloadableLazy<T extends ComponentType<any>> = LazyExoticComponent<T> & { preload: () => Promise<unknown> };

/**
 * React.lazy with a `preload()` that shares the same download. Preloading before the first visit means the page is
 * already in memory when the router asks for it, so the first visit to a section does not wait on the network.
 * A failed download is forgotten so the real navigation can try again.
 */
export function lazyWithPreload<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>): PreloadableLazy<T> {
  let started: Promise<{ default: T }> | undefined;
  const load = () => {
    started ??= factory().catch((err: unknown) => {
      started = undefined;
      throw err;
    });
    return started;
  };
  const Component = lazy(load) as PreloadableLazy<T>;
  Component.preload = load;
  return Component;
}

type IdleScheduler = (cb: () => void) => void;

const idleSchedule: IdleScheduler = (cb) => {
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => cb(), { timeout: 4000 });
  else window.setTimeout(cb, 1500);
};

/**
 * Runs the given loaders one after another once the browser has finished the first load and is idle, so they never
 * compete with the first paint or with the page's own requests. Errors are swallowed (a prefetch is a hint).
 * Returns a function that cancels anything not yet started.
 */
export function prefetchWhenIdle(loaders: Array<() => Promise<unknown>>, schedule: IdleScheduler = idleSchedule): () => void {
  let cancelled = false;
  const queue = [...loaders];
  const next = () => {
    if (cancelled) return;
    const load = queue.shift();
    if (!load) return;
    void load()
      .catch(() => undefined)
      .then(() => schedule(next));
  };
  const start = () => schedule(next);
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener("load", start);
  };
}
