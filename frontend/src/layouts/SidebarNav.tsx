import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { cn } from "@/lib/cn";
import { useHealth } from "@/hooks/useHealth";
import { Brand } from "@/components/common/Brand";
import { NAV_GROUP_LABELS, NAV_ITEMS, type NavGroup } from "@/routes/navigation";

const GROUP_ORDER: NavGroup[] = ["home", "strategy", "execution", "insight", "system"];

/**
 * The sidebar content, used both in the fixed desktop sidebar and inside the phone sheet. Items are grouped; one
 * indicator element slides to the active item (CSS transform transition, instant under reduced motion).
 */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { data } = useHealth();
  const { pathname } = useLocation();
  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);
  const [animated, setAnimated] = useState(false);

  // Measure after every navigation and on resize; the first placement is instant, later ones slide.
  useLayoutEffect(() => {
    const place = () => {
      const active = listRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
      setIndicator(active ? { top: active.offsetTop, height: active.offsetHeight } : null);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [pathname]);
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[var(--header-height)] shrink-0 items-center border-b px-5">
        <Brand />
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
        <div ref={listRef} className="relative space-y-5">
          <span
            aria-hidden="true"
            data-testid="nav-indicator"
            className="nav-indicator"
            style={{
              height: indicator?.height ?? 0,
              transform: `translateY(${indicator?.top ?? 0}px)`,
              opacity: indicator ? 1 : 0,
              transitionDuration: animated ? undefined : "0s",
            }}
          />
          {GROUP_ORDER.map((group) => {
            const label = NAV_GROUP_LABELS[group];
            const items = NAV_ITEMS.filter((i) => i.group === group);
            return (
              <div key={group}>
                {label && (
                  <p id={`nav-group-${group}`} className="mb-1.5 px-3 text-overline font-semibold uppercase text-muted-foreground">
                    {label}
                  </p>
                )}
                <ul aria-labelledby={label ? `nav-group-${group}` : undefined} className="space-y-0.5">
                  {items.map((item) => (
                    <li key={item.key}>
                      <NavLink
                        to={item.path}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          cn(
                            "relative z-10 flex items-center gap-3 rounded-md px-3 py-2 text-label transition-colors duration-[var(--duration-fast)]",
                            isActive ? "font-semibold text-selected-foreground" : "text-foreground/80 hover:bg-muted/70 hover:text-foreground",
                          )
                        }
                      >
                        <item.icon aria-hidden="true" className="size-[1.05rem] shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </nav>
      <div className="shrink-0 border-t px-5 py-3 text-caption text-muted-foreground">
        {data?.version ? (
          <>
            Version <span className="font-mono">{data.version}</span>
          </>
        ) : (
          "Zentro"
        )}
      </div>
    </div>
  );
}
