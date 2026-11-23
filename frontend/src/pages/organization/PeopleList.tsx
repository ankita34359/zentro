import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { FormAlert, FormField } from "@/components/common/FormField";
import { SelectField } from "@/components/common/SelectField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { problemText } from "@/lib/authForm";
import { createPerson, EMPLOYMENT_LABEL, initials, listPeople, type NewPerson, type PersonSummary } from "@/services/people";
import { getStructure } from "@/services/structure";

const field = "h-10 w-full rounded-lg border border-input bg-card px-3 text-body text-foreground shadow-xs";

/** Everyone the caller may see, with search and filters. On a phone each person is a stacked card. */
export function PeopleList({ onOpenPerson, canAdd, adding, setAdding }: { onOpenPerson: (id: string) => void; canAdd: boolean; adding: boolean; setAdding: (v: boolean) => void }) {
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [archived, setArchived] = useState(false);
  const structure = useQuery({ queryKey: ["structure"], queryFn: getStructure, retry: false });
  const filters = { search: search.trim() || undefined, departmentId: departmentId || undefined, teamId: teamId || undefined, designationId: designationId || undefined, includeArchived: archived };
  const q = useQuery({ queryKey: ["people", filters], queryFn: () => listPeople(filters), retry: false, placeholderData: (prev) => prev });
  const s = structure.data;
  const shown = q.data?.people ?? [];
  const filtered = Boolean(filters.search || departmentId || teamId || designationId);

  return (
    <section aria-label="People" className="space-y-4">
      {adding && canAdd && <AddPersonForm onDone={() => setAdding(false)} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input aria-label="Search people" type="search" placeholder="Search by name, title or team" value={search} onChange={(e) => setSearch(e.target.value)} className={`${field} pl-9`} />
        </div>
        <select aria-label="Department" className={field} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
          <option value="">All departments</option>
          {(s?.departments ?? []).filter((d) => !d.archived).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select aria-label="Team" className={field} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">All teams</option>
          {(s?.teams ?? []).filter((t) => !t.archived).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select aria-label="Designation" className={field} value={designationId} onChange={(e) => setDesignationId(e.target.value)}>
          <option value="">All designations</option>
          {(s?.designations ?? []).filter((d) => !d.archived).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 text-label">
        <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Show archived people
      </label>

      {q.isPending ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState title="The people could not be loaded" error={q.error} onRetry={() => void q.refetch()} />
      ) : shown.length === 0 ? (
        <EmptyState illustration="team" title={filtered ? "No one matches" : "No people yet"} action={canAdd && !filtered ? <Button size="sm" onClick={() => setAdding(true)}>Add the first person</Button> : undefined}>
          {filtered ? "Change the search or the filters." : "Add the people in your organization here, then place them in teams and say who reports to whom."}
        </EmptyState>
      ) : (
        <>
          <ul aria-label="People list" className="divide-y rounded-xl border bg-card">
            {shown.map((p) => (
              <Row key={p.id} p={p} onOpen={() => onOpenPerson(p.id)} />
            ))}
          </ul>
          <p className="text-caption text-muted-foreground" role="status">
            Showing {shown.length} of {q.data!.total} {q.data!.total === 1 ? "person" : "people"}
            {q.data!.total > shown.length ? ". Search or filter to narrow the list." : "."}
          </p>
        </>
      )}
    </section>
  );
}

function Row({ p, onOpen }: { p: PersonSummary; onOpen: () => void }) {
  const place = [...p.teams.map((t) => t.name), ...p.departments.filter((d) => !p.teams.length).map((d) => d.name)].join(", ");
  return (
    <li>
      <button type="button" onClick={onOpen} aria-label={`Open profile of ${p.displayName}`} className="grid w-full items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-muted/60 sm:grid-cols-[2fr_1.5fr_1.5fr_1.5fr]">
        <span className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-brand-strong text-caption font-semibold text-on-gradient">
            {initials(p.displayName)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-body font-medium">{p.displayName}</span>
            <span className="flex flex-wrap gap-1">
              {p.archived && <Badge variant="atRisk">Archived</Badge>}
              {p.status === "invited" && <Badge variant="dashed">Invited</Badge>}
              {!p.hasLogin && p.status === "active" && !p.archived && <Badge variant="dashed">No login</Badge>}
            </span>
          </span>
        </span>
        <span className="truncate text-label sm:text-body">
          <span className="sm:hidden text-caption text-muted-foreground">Designation: </span>
          {p.designation ? p.designation.name : <span className="text-muted-foreground">No designation</span>}
        </span>
        <span className="truncate text-label sm:text-body">
          <span className="sm:hidden text-caption text-muted-foreground">Team: </span>
          {place || <span className="text-muted-foreground">No team</span>}
        </span>
        <span className="truncate text-label sm:text-body">
          <span className="sm:hidden text-caption text-muted-foreground">Reports to: </span>
          {p.managers.length ? p.managers.map((m) => m.name).join(", ") : <span className="text-muted-foreground">No manager</span>}
        </span>
      </button>
    </li>
  );
}

/** Adds a person who has no login. Optional placement and manager are created with them in one step. */
function AddPersonForm({ onDone }: { onDone: () => void }) {
  const client = useQueryClient();
  const structure = useQuery({ queryKey: ["structure"], queryFn: getStructure, retry: false });
  const people = useQuery({ queryKey: ["people", "all"], queryFn: () => listPeople({ limit: 500 }), retry: false });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [type, setType] = useState("");
  const [start, setStart] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [managerId, setManagerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const [added, setAdded] = useState<string | null>(null);
  const s = structure.data;
  const create = useMutation({
    mutationFn: (b: NewPerson) => createPerson(b),
    onSuccess: () => {
      setAdded(name.trim());
      setName("");
      setEmail("");
      setCode("");
      setStart("");
      setError(null);
      for (const k of ["people", "tree", "audit"]) void client.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => setError(problemText(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setAdded(null);
    if (!name.trim()) return setNameError("Enter the person's name");
    setNameError(undefined);
    setError(null);
    create.mutate({
      name: name.trim(),
      ...(email.trim() ? { workEmail: email.trim() } : {}),
      ...(code.trim() ? { employeeCode: code.trim() } : {}),
      ...(type ? { employmentType: type } : {}),
      ...(start ? { startDate: start } : {}),
      ...(designationId ? { designationId } : {}),
      ...(teamId ? { teamId } : departmentId ? { departmentId } : {}),
      ...(managerId ? { managerId } : {}),
    });
  }
  return (
    <Card lift={false}>
      <CardHeader>
        <CardTitle>Add a person</CardTitle>
        <p className="text-label text-muted-foreground">For people who do not need to sign in yet. To give someone a login, invite them from Settings → Users and invitations.</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate aria-label="Add a person" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {error && <div className="sm:col-span-2 lg:col-span-3"><FormAlert>{error}</FormAlert></div>}
          {added && <p role="status" className="rounded-lg border border-on-track/30 bg-on-track-soft px-3 py-2.5 text-label text-on-track-ink sm:col-span-2 lg:col-span-3">{added} was added. Add another, or close this form.</p>}
          <FormField label="Name" value={name} onChange={(e) => setName(e.target.value)} error={nameError} autoComplete="off" />
          <FormField label="Work email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          <FormField label="Employee code (optional)" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
          <SelectField label="Designation" value={designationId} onChange={(e) => setDesignationId(e.target.value)}>
              <option value="">None</option>
              {(s?.designations ?? []).filter((d) => !d.archived).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </SelectField>
          <SelectField label="Team" value={teamId} onChange={(e) => { setTeamId(e.target.value); if (e.target.value) setDepartmentId(""); }}>
              <option value="">None</option>
              {(s?.teams ?? []).filter((t) => !t.archived).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </SelectField>
          <SelectField label="Department (when no team)" value={departmentId} disabled={Boolean(teamId)} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">None</option>
              {(s?.departments ?? []).filter((d) => !d.archived).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </SelectField>
          <SelectField label="Reports to" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
              <option value="">No manager</option>
              {(people.data?.people ?? []).filter((p) => !p.archived).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
          </SelectField>
          <SelectField label="Employment type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Not set</option>
              {Object.entries(EMPLOYMENT_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </SelectField>
          <FormField label="Start date" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Adding…" : "Add person"}
            </Button>
            <Button type="button" variant="ghost" onClick={onDone}>
              Close
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
