import { Bell, ChevronRight, FlaskConical, Gauge, Network, ScrollText, ServerCog, ShieldCheck, Sparkles, UserCog, Users } from "lucide-react";
import { Link } from "react-router";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";

const ITEMS: { to: string; title: string; body: string; icon: typeof Users; any?: string[] }[] = [
  { to: "/settings/users", title: "Users and invitations", body: "Invite people into a role, copy their link, revoke it, and generate password-reset links.", icon: Users, any: ["invitations.manage", "people.manage"] },
  { to: "/settings/roles", title: "Roles", body: "Create and change roles, and see what each one allows.", icon: ShieldCheck, any: ["roles.view"] },
  { to: "/settings/structure", title: "Organization structure", body: "Departments, teams and sub-teams, role families and designations; rename the organization.", icon: Network, any: ["org.view"] },
  { to: "/settings/audit", title: "Audit log", body: "Who changed what and when: roles, assignments, invitations and people.", icon: ScrollText, any: ["audit.view"] },
  { to: "/settings/scoring", title: "Scoring", body: "What each kind of role is measured on, how much each part counts, and a calculator to try it.", icon: Gauge, any: ["performance.view_components"] },
  { to: "/settings/system", title: "System", body: "App version, database size, the daily backup and the background jobs. Only administrators see this.", icon: ServerCog, any: ["org.settings"] },
  { to: "/settings/ai", title: "AI", body: "See whether AI is connected and switch it on or off for your organization. It is off until you do.", icon: Sparkles, any: ["ai.configure"] },
  { to: "/settings/demo", title: "Demo data", body: "Load a fictional company to see every page full, view as a demo person, and remove it all again.", icon: FlaskConical, any: ["demo.manage"] },
  { to: "/settings/notifications", title: "Notifications", body: "Choose which reminders and updates reach your bell.", icon: Bell },
  { to: "/settings/profile", title: "Profile", body: "Your account details, your password, and deleting your account.", icon: UserCog },
];

/** The Settings index. Roles, scoring, the audit log and the rest arrive with the stages that build them. */
export default function SettingsPage() {
  const { can } = useAuth();
  const items = ITEMS.filter((i) => !i.any || i.any.some(can)); // a convenience: the server enforces access
  return (
    <>
      <PageHeader eyebrow="System" title="Settings" description="Organization, people and account settings. More arrive with the features they control." />
      <ul className="grid gap-4 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.to}>
            <Card className="h-full">
              <Link to={i.to} className="flex h-full items-start gap-4 rounded-xl p-5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
                  <i.icon aria-hidden="true" className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-heading font-semibold">{i.title}</span>
                  <span className="mt-1 block text-label text-muted-foreground">{i.body}</span>
                </span>
                <ChevronRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" />
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
