import { Network, Plus, Users } from "lucide-react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { useState } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/cn";
import { OrgChart } from "./OrgChart";
import { PeopleList } from "./PeopleList";
import { ProfileDrawer } from "./ProfileDrawer";

/**
 * Organization (stages 2.6 and 2.7): the chart, and the people list. Clicking a person anywhere opens their profile in the
 * panel on the right (the address keeps `?person=` so a link opens the same profile). Departments and teams themselves are
 * edited in Settings → Organization structure.
 */
export default function OrganizationPage() {
  const { can } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const onPeople = pathname.replace(/\/+$/, "").endsWith("/people");
  const personId = params.get("person");
  const canAdd = can("people.manage");

  const openPerson = (id: string) => setParams((p) => { const n = new URLSearchParams(p); n.set("person", id); return n; });
  const closePerson = () => setParams((p) => { const n = new URLSearchParams(p); n.delete("person"); return n; }, { replace: true });
  const addPerson = () => {
    setAdding(true);
    if (!onPeople) navigate("/organization/people");
  };

  const tab = (to: string, label: string, active: boolean, Icon: typeof Users) => (
    <Link
      to={{ pathname: to, search: params.toString() ? `?${params.toString()}` : "" }}
      role="tab"
      aria-selected={active}
      className={cn("-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-label font-medium", active ? "border-primary text-primary-ink" : "border-transparent text-muted-foreground hover:text-foreground")}
    >
      <Icon aria-hidden="true" className="size-4" /> {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        eyebrow="Strategy"
        title="Organization"
        description="Who is in the organization, where they work and who they report to."
        actions={
          <>
            {can("org.manage") && (
              <Button asChild variant="outline" size="sm">
                <Link to="/settings/structure">Edit structure</Link>
              </Button>
            )}
            {canAdd && (
              <Button size="sm" onClick={addPerson}>
                <Plus aria-hidden="true" /> Add person
              </Button>
            )}
          </>
        }
      />
      <div role="tablist" aria-label="Organization views" className="mb-5 flex border-b">
        {tab("/organization", "Chart", !onPeople, Network)}
        {tab("/organization/people", "People", onPeople, Users)}
      </div>
      {onPeople ? <PeopleList onOpenPerson={openPerson} canAdd={canAdd} adding={adding} setAdding={setAdding} /> : <OrgChart onOpenPerson={openPerson} canAdd={canAdd} onAdd={addPerson} />}
      <ProfileDrawer id={personId} onClose={closePerson} onOpenPerson={openPerson} />
    </>
  );
}
