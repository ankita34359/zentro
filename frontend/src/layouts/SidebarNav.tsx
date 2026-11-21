import { NavLink } from "react-router";
import { cn } from "@/lib/cn";
import { useHealth } from "@/hooks/useHealth";
import { Brand } from "@/components/common/Brand";
import { NAV_ITEMS } from "@/routes/navigation";

/** The sidebar content, used both in the fixed desktop sidebar and inside the phone sheet. */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { data } = useHealth();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center border-b px-5">
        <Brand />
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => (
            <li key={item.key}>
              <NavLink
                to={item.path}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted",
                    isActive ? "bg-accent font-medium text-accent-foreground hover:bg-accent" : "text-foreground/80",
                  )
                }
              >
                <item.icon aria-hidden="true" className="size-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="shrink-0 border-t px-5 py-3 text-xs text-muted-foreground">
        {data?.version ? <>Version <span className="font-mono">{data.version}</span></> : "Zentro"}
      </div>
    </div>
  );
}
