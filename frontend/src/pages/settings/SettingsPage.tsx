import { ChevronRight, ShieldCheck, UserCog, Users } from "lucide-react";
import { Link } from "react-router";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";

const ITEMS: { to: string; title: string; body: string; icon: typeof Users; any?: string[] }[] = [
  { to: "/settings/users", title: "Users and invitations", body: "Invite people into a role, copy their link, revoke it, and generate password-reset links.", icon: Users, any: ["invitations.manage", "people.manage"] },
  { to: "/settings/roles", title: "Roles", body: "The organization's roles and what each one allows.", icon: ShieldCheck, any: ["roles.view"] },
  { to: "/settings/profile", title: "Profile", body: "Your account details, your password, and deleting your account.", icon: UserCog },
];

/** The Settings index. Roles, scoring, the audit log and the rest arrive with the stages that build them. */
export default function SettingsPage() {
  const { can } = useAuth();
  const items = ITEMS.filter((i) => !i.any || i.any.some(can)); // a convenience: the server enforces access
  return (
    <>
      <PageHeader eyebrow="System" title="Settings" description="Organization, people and account settings. More arrive with the features they control (the role editor in stage 2.4)." />
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
