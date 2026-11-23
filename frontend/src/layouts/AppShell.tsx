import { Menu } from "lucide-react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { Brand } from "@/components/common/Brand";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { DemoBanner } from "@/components/common/DemoBanner";
import { NotificationBell } from "@/components/common/NotificationBell";
import { StatusPill } from "@/components/common/StatusPill";
import { ThemeToggle } from "@/components/common/ThemeToggle";
import { UserMenu } from "@/components/common/UserMenu";
import { Button } from "@/components/ui/button";
import { publicConfig } from "@/config/public";
import { prefetchWhenIdle } from "@/lib/preload";
import { titleFor } from "@/routes/navigation";
import { PREFETCH_PAGES } from "@/routes/pages";
import { PageTransition } from "@/motion/PageTransition";
import { SidebarNav } from "./SidebarNav";

// The phone menu (Radix Dialog) is its own small chunk: desktop never downloads it, and narrow screens fetch it
// while idle, so the first paint stays light.
// It is NOT React.lazy on purpose: a suspended boundary makes React wait up to 300 ms before revealing it, which
// would delay the menu after a tap. Instead the component is held in state once its chunk has arrived.
const loadSheet = () => import("@/components/ui/sheet");
type SheetComponent = (typeof import("@/components/ui/sheet"))["SheetLeft"];

/** Fixed sidebar from 1024 px up; a slide-in sheet below that. Header, skip link and the main landmark. */
export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [Sheet, setSheet] = useState<SheetComponent | null>(null);
  const fetchSheet = useCallback(() => void loadSheet().then((m) => setSheet(() => m.SheetLeft)), []);
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const firstRender = useRef(true);

  // Phone menu: start fetching it right after the first paint (not when idle), because it is the first thing a phone
  // user taps. Page chunks wait for the browser to be idle after the first load, one at a time, so they never
  // compete with the first paint.
  useEffect(() => {
    const narrow = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 1023px)").matches;
    let frame2 = 0;
    // Two animation frames: the first lets the browser paint the page, the second runs right after that paint.
    const frame1 = narrow ? window.requestAnimationFrame(() => (frame2 = window.requestAnimationFrame(fetchSheet))) : 0;
    const cancel = prefetchWhenIdle(PREFETCH_PAGES.map((page) => () => page.preload()));
    return () => {
      window.cancelAnimationFrame(frame1);
      window.cancelAnimationFrame(frame2);
      cancel();
    };
  }, [fetchSheet]);

  useEffect(() => {
    setMenuOpen(false);
    document.title = `${titleFor(pathname)} · ${publicConfig.appName}`;
    // After a navigation, move keyboard and screen-reader focus to the new page (not on the first load).
    if (firstRender.current) firstRender.current = false;
    else mainRef.current?.focus();
  }, [pathname]);

  return (
    <div className="min-h-screen overflow-x-clip text-foreground">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-primary px-3 py-2 text-label font-medium text-primary-foreground shadow-md focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[var(--sidebar-width)] border-r bg-sidebar lg:block">
        <SidebarNav />
      </aside>

      {Sheet && (
        <Sheet
          open={menuOpen}
          onOpenChange={setMenuOpen}
          title="Navigation"
          description="Main navigation for Zentro"
          onCloseAutoFocus={(e) => {
            // Closed with Escape or the backdrop: put focus back on the menu button. After choosing a page the new
            // page already holds focus, so leave it there.
            e.preventDefault();
            if (document.activeElement !== mainRef.current) menuButtonRef.current?.focus();
          }}
        >
          <SidebarNav onNavigate={() => setMenuOpen(false)} />
        </Sheet>
      )}

      <div className="lg:pl-[var(--sidebar-width)]">
        <DemoBanner />
        <header className="sticky top-0 z-20 flex h-[var(--header-height)] items-center gap-2 border-b border-border/70 bg-header px-4 backdrop-blur-md backdrop-saturate-150 sm:px-6">
          <Button
            ref={menuButtonRef}
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open navigation menu"
            onClick={() => {
              if (!Sheet) fetchSheet(); // tapped before the idle prefetch finished: the menu opens as soon as it arrives
              setMenuOpen(true);
            }}
          >
            <Menu aria-hidden="true" />
          </Button>
          <div className="lg:hidden">
            <Brand />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <StatusPill />
            <NotificationBell />
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        <main id="main" ref={mainRef} tabIndex={-1} className="mx-auto w-full max-w-[var(--page-max-width)] px-4 py-8 outline-none sm:px-6 lg:px-8">
          <Suspense fallback={<PageSkeleton />}>
            <PageTransition key={pathname.split("/")[1] ?? ""}>
              <Outlet />
            </PageTransition>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
