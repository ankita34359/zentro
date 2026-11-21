import { Menu } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { Brand } from "@/components/common/Brand";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { StatusPill } from "@/components/common/StatusPill";
import { ThemeToggle } from "@/components/common/ThemeToggle";
import { Button } from "@/components/ui/button";
import { SheetLeft } from "@/components/ui/sheet";
import { publicConfig } from "@/config/public";
import { NAV_ITEMS } from "@/routes/navigation";
import { SidebarNav } from "./SidebarNav";

/** Fixed sidebar from 1024 px up; a slide-in sheet below that. Header, skip link and the main landmark. */
export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    setMenuOpen(false);
    const item = NAV_ITEMS.find((i) => pathname === i.path || pathname.startsWith(`${i.path}/`));
    document.title = `${item ? item.label : "Page not found"} · ${publicConfig.appName}`;
    // After a navigation, move keyboard and screen-reader focus to the new page (not on the first load).
    if (firstRender.current) firstRender.current = false;
    else mainRef.current?.focus();
  }, [pathname]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r bg-sidebar lg:block">
        <SidebarNav />
      </aside>

      <SheetLeft
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
      </SheetLeft>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
          <Button ref={menuButtonRef} variant="ghost" size="icon" className="lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open navigation menu">
            <Menu aria-hidden="true" />
          </Button>
          <div className="lg:hidden">
            <Brand />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <StatusPill />
            <ThemeToggle />
          </div>
        </header>

        <main id="main" ref={mainRef} tabIndex={-1} className="mx-auto w-full max-w-6xl px-4 py-6 outline-none sm:px-6 lg:px-8">
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
