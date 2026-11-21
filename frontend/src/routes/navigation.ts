import {
  BarChart3,
  Brain,
  Building2,
  CheckSquare,
  Crown,
  Gauge,
  LayoutDashboard,
  Plug,
  Settings,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavGroup = "home" | "strategy" | "execution" | "insight" | "system";

/** Group headings in the sidebar ("home" has none). The eleven items keep the master section 18 order across groups. */
export const NAV_GROUP_LABELS: Record<NavGroup, string | null> = {
  home: null,
  strategy: "Strategy",
  execution: "Execution",
  insight: "Insight",
  system: "System",
};

export interface NavItem {
  key: string;
  group: NavGroup;
  label: string;
  path: string;
  icon: LucideIcon;
  /** One line shown under the page title. */
  description: string;
  /**
   * Permission key that will gate this item once sessions and roles exist (stages 2.1 and 2.3).
   * Until then every item is shown. Hiding an item is a convenience only; the server enforces access.
   */
  requires?: string;
}

/** The eleven sidebar items, in the order of master section 18. */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: "overview", group: "home", label: "Overview", path: "/overview", icon: LayoutDashboard, description: "How the organization is doing, adapted to what you are allowed to see." },
  { key: "organization", group: "strategy", label: "Organization", path: "/organization", icon: Building2, description: "Departments, teams, people and who reports to whom.", requires: "org.view" },
  { key: "okrs", group: "strategy", label: "OKRs & Goals", path: "/okrs", icon: Target, description: "Objectives and key results, aligned from the company down to each person." },
  { key: "kpis", group: "strategy", label: "KPIs", path: "/kpis", icon: BarChart3, description: "Indicators, targets and their measurement history.", requires: "kpi.view" },
  { key: "my-work", group: "execution", label: "My Work", path: "/my-work", icon: CheckSquare, description: "Your tasks, updates and priorities for today." },
  { key: "team-performance", group: "execution", label: "Team Performance", path: "/team-performance", icon: Users, description: "How teams you lead or belong to are progressing." },
  { key: "performance", group: "insight", label: "Performance Intelligence", path: "/performance", icon: Gauge, description: "Explainable scorecards, trends and comparisons." },
  { key: "ai", group: "insight", label: "AI Intelligence", path: "/ai", icon: Brain, description: "Questions, insights and risk alerts over your own data.", requires: "ai.use" },
  { key: "leadership", group: "insight", label: "Leadership", path: "/leadership", icon: Crown, description: "Company-level strategy, contribution and risks.", requires: "leadership.view" },
  { key: "integrations", group: "system", label: "Integrations", path: "/integrations", icon: Plug, description: "Connected apps and automations.", requires: "integrations.view" },
  { key: "settings", group: "system", label: "Settings", path: "/settings", icon: Settings, description: "Organization, roles, scoring and system settings." },
];

export const DEFAULT_PATH = "/overview";

/** Pages that exist but are deliberately not in the sidebar. */
const UNLISTED_TITLES: Record<string, string> = { "/design": "Design system" };

/** The page title for the browser tab and the screen-reader announcement. */
export function titleFor(pathname: string): string {
  const unlisted = UNLISTED_TITLES[pathname];
  if (unlisted) return unlisted;
  const item = NAV_ITEMS.find((i) => pathname === i.path || pathname.startsWith(`${i.path}/`));
  return item ? item.label : "Page not found";
}
