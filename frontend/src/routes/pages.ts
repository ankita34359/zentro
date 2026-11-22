import { lazyWithPreload } from "@/lib/preload";

// Pages load on demand (one small chunk each), so the first paint only pays for the shell. Each one can also be
// preloaded (see AppShell), so by the time someone opens a section its chunk is usually already in memory.
export const OverviewPage = lazyWithPreload(() => import("@/pages/OverviewPage"));
export const SectionPage = lazyWithPreload(() => import("@/pages/SectionPage"));
export const NotFoundPage = lazyWithPreload(() => import("@/pages/NotFoundPage"));
export const DesignPage = lazyWithPreload(() => import("@/pages/DesignPage"));

/** Every page a visitor can reach from the sidebar. The unlisted /design style guide is left out on purpose. */
export const PREFETCH_PAGES = [OverviewPage, SectionPage, NotFoundPage];
