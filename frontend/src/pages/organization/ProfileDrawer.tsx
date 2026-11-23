import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowRightLeft, Building2, History, Network, Pencil, Plus, RotateCcw, Users, X } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { ErrorState } from "@/components/common/ErrorState";
import { FormAlert, FormNotice } from "@/components/common/FormField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SheetRight } from "@/components/ui/sheet";
import { problemText } from "@/lib/authForm";
import { ApiError } from "@/services/api";
import { getStructure } from "@/services/structure";
import {
  addDepartmentMember, addReporting, addTeamMember, archivePerson, changeDepartmentMember, changeTeamMember, DEPT_ROLE_LABEL, EMPLOYMENT_LABEL, endReporting, getHistory, getPerson, initials,
  LINE_LABEL, listPeople, movePerson, restorePerson, setDesignation, TEAM_ROLE_LABEL, updatePerson, type HistoryEntry, type PersonProfile,
} from "@/services/people";

const field = "h-10 w-full rounded-lg border border-input bg-card px-3 text-body text-foreground shadow-xs";
const today = () => new Date().toISOString().slice(0, 10);
const since = (d: string) => (d > today() ? `from ${d}` : `since ${d}`);

function Labeled({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-label font-medium">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

/** The right-hand panel with one person's profile. `id` null = closed. */
export function ProfileDrawer({ id, onClose, onOpenPerson }: { id: string | null; onClose: () => void; onOpenPerson: (id: string) => void }) {
  return (
    <SheetRight open={id !== null} onOpenChange={(o) => !o && onClose()} title="Person profile" description="Details, reporting lines, teams and history of one person.">
      {id && <ProfileBody key={id} id={id} onOpenPerson={onOpenPerson} />}
    </SheetRight>
  );
}

type Tab = "overview" | "manage" | "history";

function ProfileBody({ id, onOpenPerson }: { id: string; onOpenPerson: (id: string) => void }) {
  const q = useQuery({ queryKey: ["person", id], queryFn: () => getPerson(id), retry: false });
  const [tab, setTab] = useState<Tab>("overview");
  if (q.isPending) {
    return (
      <div className="space-y-4 p-6" aria-busy="true">
        <Skeleton className="h-12 w-3/4" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (q.isError) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="p-6">
        <ErrorState title={gone ? "This person is not in your view" : "The profile could not be loaded"} error={gone ? undefined : q.error} onRetry={gone ? undefined : () => void q.refetch()} />
        <Dialog.Close asChild>
          <Button variant="outline" className="mt-4">Close</Button>
        </Dialog.Close>
      </div>
    );
  }
  const p = q.data;
  const canManage = p.can.edit || p.can.manageHierarchy || p.can.archive || p.can.restore;
  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: "overview", label: "Overview", show: true },
    { key: "manage", label: "Manage", show: canManage },
    { key: "history", label: "History", show: true },
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start gap-4 border-b p-5">
        <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-gradient-brand-strong text-label font-semibold text-on-gradient">
          {initials(p.displayName)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-heading font-semibold">{p.displayName}</h2>
          <p className="truncate text-label text-muted-foreground">{p.designation ? p.designation.name : "No designation"}{p.roleFamily ? ` · ${p.roleFamily.name}` : ""}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {p.isDemo && <Badge variant="dashed">Demo data</Badge>}
            {p.archived && <Badge variant="atRisk">Archived</Badge>}
            {p.status === "invited" && <Badge variant="dashed">Invited, not joined yet</Badge>}
            {!p.hasLogin && p.status === "active" && <Badge variant="dashed" title="In the directory; has no login">No login</Badge>}
          </div>
        </div>
        <Dialog.Close asChild>
          <Button variant="ghost" size="icon" aria-label="Close profile">
            <X aria-hidden="true" />
          </Button>
        </Dialog.Close>
      </header>
      <div role="tablist" aria-label="Profile sections" className="flex gap-1 border-b px-5">
        {tabs.filter((t) => t.show).map((t) => (
          <button
            key={t.key}
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`panel-${t.key}`}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2.5 text-label font-medium ${tab === t.key ? "border-primary text-primary-ink" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="flex-1 space-y-6 p-5">
        {tab === "overview" && <Overview p={p} onOpenPerson={onOpenPerson} />}
        {tab === "manage" && <Manage p={p} />}
        {tab === "history" && <HistoryTab id={id} />}
      </div>
    </div>
  );
}

// ---------- overview ----------

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-caption font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-body">{children}</dd>
    </div>
  );
}

function Overview({ p, onOpenPerson }: { p: PersonProfile; onOpenPerson: (id: string) => void }) {
  const none = <span className="text-muted-foreground">None</span>;
  return (
    <>
      <dl className="grid gap-4 sm:grid-cols-2">
        <Fact label="Reports to">
          {p.managerRows.length === 0 ? none : (
            <ul className="space-y-1">
              {p.managerRows.map((m) => (
                <li key={m.rowId}>
                  <button type="button" onClick={() => onOpenPerson(m.manager.id)} className="font-medium text-primary-ink underline-offset-2 hover:underline">
                    {m.manager.name}
                  </button>{" "}
                  <span className="text-caption text-muted-foreground">
                    {LINE_LABEL[m.type] ?? m.type}, {since(m.startDate)}
                    {m.endDate ? `, ends ${m.endDate}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Fact>
        <Fact label="Direct reports">
          {p.directReports.length === 0 ? none : (
            <ul className="flex flex-wrap gap-1.5">
              {p.directReports.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => onOpenPerson(r.id)} className="rounded-full border bg-card px-2.5 py-0.5 text-caption font-medium hover:bg-muted">
                    {r.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Fact>
        <Fact label="Departments">
          {p.departmentRows.length === 0 ? none : (
            <ul className="space-y-1">
              {p.departmentRows.map((d) => (
                <li key={d.rowId}>
                  {d.department.name} <span className="text-caption text-muted-foreground">{d.type !== "member" ? `${DEPT_ROLE_LABEL[d.type] ?? d.type}, ` : ""}{since(d.startDate)}</span>
                </li>
              ))}
            </ul>
          )}
        </Fact>
        <Fact label="Teams">
          {p.teamRows.length === 0 ? none : (
            <ul className="space-y-1">
              {p.teamRows.map((t) => (
                <li key={t.rowId}>
                  {t.team.name}{" "}
                  <span className="text-caption text-muted-foreground">
                    {t.type !== "member" ? `${TEAM_ROLE_LABEL[t.type] ?? t.type}, ` : ""}
                    {t.allocationPct}%, {since(t.startDate)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Fact>
      </dl>
      {p.employment ? (
        <section aria-label="Employment details">
          <h3 className="mb-3 text-label font-semibold">Employment</h3>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Fact label="Email">{p.email ?? none}</Fact>
            <Fact label="Employee code">{p.employment.employeeCode ?? none}</Fact>
            <Fact label="Type">{p.employment.employmentType ? EMPLOYMENT_LABEL[p.employment.employmentType] ?? p.employment.employmentType : none}</Fact>
            <Fact label="Started">{p.employment.startDate ?? none}</Fact>
            {p.employment.endDate && <Fact label="Ends">{p.employment.endDate}</Fact>}
          </dl>
        </section>
      ) : (
        <p className="text-caption text-muted-foreground">Employment details are visible to the person themselves and to people who manage them.</p>
      )}
    </>
  );
}

// ---------- history ----------

function HistoryTab({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["history", id], queryFn: () => getHistory(id), retry: false });
  if (q.isPending) return <Skeleton className="h-40 w-full" />;
  if (q.isError) return <ErrorState title="The history could not be loaded" error={q.error} onRetry={() => void q.refetch()} />;
  const groups: { title: string; rows: HistoryEntry[] }[] = [
    { title: "Designations", rows: q.data.designations },
    { title: "Managers", rows: q.data.managers },
    { title: "Teams", rows: q.data.teams },
    { title: "Departments", rows: q.data.departments },
    { title: "People who reported to them", rows: q.data.reports },
  ];
  if (groups.every((g) => g.rows.length === 0)) return <p className="text-body text-muted-foreground">Nothing has been recorded for this person yet.</p>;
  return (
    <div className="space-y-6">
      {groups.filter((g) => g.rows.length > 0).map((g) => (
        <section key={g.title} aria-label={g.title}>
          <h3 className="mb-2 text-label font-semibold">{g.title}</h3>
          <ul className="divide-y rounded-lg border">
            {g.rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                <span>
                  <span className="text-body font-medium">{r.label}</span>
                  {r.detail && <span className="text-caption text-muted-foreground"> · {r.detail.replace("_", " ")}</span>}
                </span>
                <span className="text-caption text-muted-foreground">
                  {r.startDate} → {r.endDate ?? "now"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------- manage ----------

type Panel = null | "details" | "designation" | "manager" | "team" | "department" | "move" | "archive";

function Manage({ p }: { p: PersonProfile }) {
  const client = useQueryClient();
  const [panel, setPanel] = useState<Panel>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const structure = useQuery({ queryKey: ["structure"], queryFn: getStructure, retry: false });
  const people = useQuery({ queryKey: ["people", "all"], queryFn: () => listPeople({ limit: 500 }), retry: false });

  const refresh = () => {
    for (const key of ["person", "history", "people", "tree", "structure", "audit", "members"]) void client.invalidateQueries({ queryKey: [key] });
  };
  /** Runs one change; the server's refusal is shown in its own words and the form stays open. */
  const run = useMutation({
    mutationFn: (v: { fn: () => Promise<unknown>; done: string }) => v.fn().then(() => v.done),
    onSuccess: (done) => {
      setProblem(null);
      setNotice(done);
      setPanel(null);
      refresh();
    },
    onError: (e) => {
      setNotice(null);
      setProblem(problemText(e));
    },
  });
  const act = (fn: () => Promise<unknown>, done: string) => run.mutate({ fn, done });
  const open = (next: Panel) => {
    setProblem(null);
    setNotice(null);
    setPanel(panel === next ? null : next);
  };
  const s = structure.data;
  const departments = (s?.departments ?? []).filter((d) => !d.archived);
  const teams = (s?.teams ?? []).filter((t) => !t.archived);
  const designations = (s?.designations ?? []).filter((d) => !d.archived);
  const others = (people.data?.people ?? []).filter((x) => x.id !== p.id && !x.archived);
  const busy = run.isPending;

  return (
    <div className="space-y-5">
      {notice && <FormNotice>{notice}</FormNotice>}
      {problem && <FormAlert>{problem}</FormAlert>}

      <div className="flex flex-wrap gap-2">
        {p.can.edit && (
          <Button size="sm" variant="outline" onClick={() => open("details")} aria-pressed={panel === "details"}>
            <Pencil aria-hidden="true" /> Edit details
          </Button>
        )}
        {p.can.edit && (
          <Button size="sm" variant="outline" onClick={() => open("designation")} aria-pressed={panel === "designation"}>
            <Building2 aria-hidden="true" /> Change designation
          </Button>
        )}
        {p.can.manageHierarchy && (
          <>
            <Button size="sm" variant="outline" onClick={() => open("manager")} aria-pressed={panel === "manager"}>
              <Network aria-hidden="true" /> Add manager
            </Button>
            <Button size="sm" variant="outline" onClick={() => open("team")} aria-pressed={panel === "team"}>
              <Users aria-hidden="true" /> Add to team
            </Button>
            <Button size="sm" variant="outline" onClick={() => open("department")} aria-pressed={panel === "department"}>
              <Plus aria-hidden="true" /> Add to department
            </Button>
            <Button size="sm" variant="outline" onClick={() => open("move")} aria-pressed={panel === "move"}>
              <ArrowRightLeft aria-hidden="true" /> Move
            </Button>
          </>
        )}
      </div>

      {panel === "details" && <DetailsForm p={p} busy={busy} onSubmit={(b) => act(() => updatePerson(p.id, b), "Details saved.")} onCancel={() => setPanel(null)} />}
      {panel === "designation" && (
        <DesignationForm
          current={p.designation?.id}
          options={designations}
          busy={busy}
          onSubmit={(b) => act(() => setDesignation(p.id, b), "Designation changed. The old one is kept in the history.")}
          onCancel={() => setPanel(null)}
        />
      )}
      {panel === "manager" && (
        <ManagerForm people={others} busy={busy} onSubmit={(b) => act(() => addReporting({ subordinateId: p.id, ...b }).then((r) => r), b.type === "primary" ? "Primary manager set. A previous primary manager is ended on that day." : "Reporting line added.")} onCancel={() => setPanel(null)} />
      )}
      {panel === "team" && <PlaceForm kind="team" options={teams.map((t) => ({ id: t.id, name: t.name }))} roles={TEAM_ROLE_LABEL} busy={busy} onSubmit={(b) => act(() => addTeamMember(b.id, { membershipId: p.id, type: b.type, startDate: b.startDate }), "Added to the team.")} onCancel={() => setPanel(null)} />}
      {panel === "department" && <PlaceForm kind="department" options={departments.map((d) => ({ id: d.id, name: d.name }))} roles={DEPT_ROLE_LABEL} busy={busy} onSubmit={(b) => act(() => addDepartmentMember(b.id, { membershipId: p.id, type: b.type, startDate: b.startDate }), "Added to the department.")} onCancel={() => setPanel(null)} />}
      {panel === "move" && <MoveForm teams={teams} departments={departments} busy={busy} onSubmit={(b) => act(() => movePerson({ membershipId: p.id, ...b }), "Moved. Old team and department rows end on that day; the history keeps them.")} onCancel={() => setPanel(null)} />}

      <Rows title="Managers" empty="No reporting lines.">
        {p.managerRows.map((m) => (
          <EndableRow
            key={m.rowId}
            label={`${m.manager.name} · ${LINE_LABEL[m.type] ?? m.type}`}
            sub={`${since(m.startDate)}${m.endDate ? `, ends ${m.endDate}` : ""}`}
            canEnd={p.can.manageHierarchy && m.endDate === null}
            endLabel={`End reporting line to ${m.manager.name}`}
            busy={busy}
            onEnd={() => act(() => endReporting(m.rowId), "Reporting line ended. It stays in the history.")}
          />
        ))}
      </Rows>
      <Rows title="Teams" empty="Not in a team.">
        {p.teamRows.map((t) => (
          <EndableRow
            key={t.rowId}
            label={t.team.name}
            sub={`${since(t.startDate)}, ${t.allocationPct}%`}
            canEnd={p.can.manageHierarchy && t.endDate === null}
            endLabel={`Remove ${p.displayName} from ${t.team.name}`}
            busy={busy}
            onEnd={() => act(() => changeTeamMember(t.team.id, t.rowId, { endDate: today() }), "Left the team. It stays in the history.")}
            role={p.can.manageHierarchy && t.endDate === null ? { value: t.type, options: TEAM_ROLE_LABEL, label: `Role in ${t.team.name}`, onChange: (type) => act(() => changeTeamMember(t.team.id, t.rowId, { type }), type === "lead" ? "Now the team lead. A previous lead stays on as a member." : "Role changed.") } : undefined}
          />
        ))}
      </Rows>
      <Rows title="Departments" empty="Not in a department.">
        {p.departmentRows.map((d) => (
          <EndableRow
            key={d.rowId}
            label={d.department.name}
            sub={since(d.startDate)}
            canEnd={p.can.manageHierarchy && d.endDate === null}
            endLabel={`Remove ${p.displayName} from ${d.department.name}`}
            busy={busy}
            onEnd={() => act(() => changeDepartmentMember(d.department.id, d.rowId, { endDate: today() }), "Left the department. It stays in the history.")}
            role={p.can.manageHierarchy && d.endDate === null ? { value: d.type, options: DEPT_ROLE_LABEL, label: `Role in ${d.department.name}`, onChange: (type) => act(() => changeDepartmentMember(d.department.id, d.rowId, { type }), type === "head" ? "Now the department head. A previous head stays on as a member." : "Role changed.") } : undefined}
          />
        ))}
      </Rows>

      {p.can.archive && (
        <section aria-label="Archive" className="rounded-lg border p-4">
          {panel === "archive" ? (
            <div className="space-y-3">
              <p className="text-label">
                Archive {p.displayName}? Their teams and reporting lines end today and they leave the directory. Nothing is deleted, and you can restore them later.
              </p>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={() => act(() => archivePerson(p.id), "Archived.")}>
                  Confirm archive
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => open("archive")}>
              <Archive aria-hidden="true" /> Archive this person…
            </Button>
          )}
        </section>
      )}
      {p.can.restore && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => restorePerson(p.id), "Restored. Place them in a team again.")}>
          <RotateCcw aria-hidden="true" /> Restore {p.displayName}
        </Button>
      )}
    </div>
  );
}

function Rows({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-2 text-label font-semibold">{title}</h3>
      {children.length === 0 ? <p className="text-caption text-muted-foreground">{empty}</p> : <ul className="divide-y rounded-lg border">{children}</ul>}
    </section>
  );
}

function EndableRow({ label, sub, canEnd, endLabel, onEnd, busy, role }: { label: string; sub: string; canEnd: boolean; endLabel: string; onEnd: () => void; busy: boolean; role?: { value: string; options: Record<string, string>; label: string; onChange: (v: string) => void } }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-body font-medium">{label}</p>
        <p className="text-caption text-muted-foreground">{sub}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {role && (
          <select aria-label={role.label} value={role.value} disabled={busy} onChange={(e) => role.onChange(e.target.value)} className="h-8 rounded-lg border border-input bg-card px-2 text-label shadow-xs">
            {Object.entries(role.options).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
        {canEnd &&
          (confirm ? (
            <>
              <Button size="sm" variant="outline" disabled={busy} aria-label={`Confirm: ${endLabel}`} onClick={onEnd}>
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" aria-label={endLabel} onClick={() => setConfirm(true)}>
              End
            </Button>
          ))}
      </div>
    </li>
  );
}

// ---------- forms ----------

const Actions = ({ busy, label, onCancel }: { busy: boolean; label: string; onCancel: () => void }) => (
  <div className="flex gap-2 pt-1">
    <Button type="submit" size="sm" disabled={busy}>
      {busy ? "Saving…" : label}
    </Button>
    <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
      Cancel
    </Button>
  </div>
);
const formClass = "grid gap-3 rounded-lg border bg-muted/40 p-4 sm:grid-cols-2";

function DetailsForm({ p, busy, onSubmit, onCancel }: { p: PersonProfile; busy: boolean; onSubmit: (b: { name?: string; workEmail: string | null; employeeCode: string | null; employmentType: string | null; startDate: string | null; endDate: string | null }) => void; onCancel: () => void }) {
  const [name, setName] = useState(p.displayName);
  const [email, setEmail] = useState(p.email ?? "");
  const [code, setCode] = useState(p.employment?.employeeCode ?? "");
  const [type, setType] = useState(p.employment?.employmentType ?? "");
  const [start, setStart] = useState(p.employment?.startDate ?? "");
  const [end, setEnd] = useState(p.employment?.endDate ?? "");
  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit({ ...(p.hasLogin ? {} : { name }), workEmail: email.trim() || null, employeeCode: code.trim() || null, employmentType: type || null, startDate: start || null, endDate: end || null });
  }
  return (
    <form onSubmit={submit} noValidate aria-label="Edit details" className={formClass}>
      <Labeled label="Name">{(id) => <input id={id} className={field} value={name} onChange={(e) => setName(e.target.value)} disabled={p.hasLogin} />}</Labeled>
      <Labeled label="Work email">{(id) => <input id={id} type="email" className={field} value={email} onChange={(e) => setEmail(e.target.value)} />}</Labeled>
      <Labeled label="Employee code">{(id) => <input id={id} className={field} value={code} onChange={(e) => setCode(e.target.value)} />}</Labeled>
      <Labeled label="Employment type">
        {(id) => (
          <select id={id} className={field} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Not set</option>
            {Object.entries(EMPLOYMENT_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
      </Labeled>
      <Labeled label="Start date">{(id) => <input id={id} type="date" className={field} value={start} onChange={(e) => setStart(e.target.value)} />}</Labeled>
      <Labeled label="End date">{(id) => <input id={id} type="date" className={field} value={end} onChange={(e) => setEnd(e.target.value)} />}</Labeled>
      {p.hasLogin && <p className="text-caption text-muted-foreground sm:col-span-2">This person signed up with their own name; they change it themselves.</p>}
      <div className="sm:col-span-2">
        <Actions busy={busy} label="Save details" onCancel={onCancel} />
      </div>
    </form>
  );
}

function DesignationForm({ current, options, busy, onSubmit, onCancel }: { current?: string; options: { id: string; name: string }[]; busy: boolean; onSubmit: (b: { designationId: string; startDate?: string; reason?: string }) => void; onCancel: () => void }) {
  const [designationId, setDesignationId] = useState("");
  const [startDate, setStartDate] = useState(today());
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!designationId) return setErr("Choose a designation");
    setErr(null);
    onSubmit({ designationId, startDate: startDate || undefined, reason: reason.trim() || undefined });
  }
  return (
    <form onSubmit={submit} noValidate aria-label="Change designation" className={formClass}>
      {err && <div className="sm:col-span-2"><FormAlert>{err}</FormAlert></div>}
      <Labeled label="New designation">
        {(id) => (
          <select id={id} className={field} value={designationId} onChange={(e) => setDesignationId(e.target.value)}>
            <option value="">Choose a designation</option>
            {options.filter((o) => o.id !== current).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
      </Labeled>
      <Labeled label="From">{(id) => <input id={id} type="date" className={field} value={startDate} max={today()} onChange={(e) => setStartDate(e.target.value)} />}</Labeled>
      <div className="sm:col-span-2">
        <Labeled label="Reason (optional)">{(id) => <input id={id} className={field} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />}</Labeled>
      </div>
      <div className="sm:col-span-2">
        <Actions busy={busy} label="Change designation" onCancel={onCancel} />
      </div>
    </form>
  );
}

function ManagerForm({ people, busy, onSubmit, onCancel }: { people: { id: string; displayName: string }[]; busy: boolean; onSubmit: (b: { managerId: string; type: string; startDate?: string; reason?: string }) => void; onCancel: () => void }) {
  const [managerId, setManagerId] = useState("");
  const [type, setType] = useState("primary");
  const [startDate, setStartDate] = useState(today());
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!managerId) return setErr("Choose the manager");
    setErr(null);
    onSubmit({ managerId, type, startDate: startDate || undefined, reason: reason.trim() || undefined });
  }
  return (
    <form onSubmit={submit} noValidate aria-label="Add manager" className={formClass}>
      {err && <div className="sm:col-span-2"><FormAlert>{err}</FormAlert></div>}
      <Labeled label="Manager">
        {(id) => (
          <select id={id} className={field} value={managerId} onChange={(e) => setManagerId(e.target.value)}>
            <option value="">Choose a person</option>
            {people.map((o) => (
              <option key={o.id} value={o.id}>
                {o.displayName}
              </option>
            ))}
          </select>
        )}
      </Labeled>
      <Labeled label="Kind of line">
        {(id) => (
          <select id={id} className={field} value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(LINE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
      </Labeled>
      <Labeled label="From">{(id) => <input id={id} type="date" className={field} value={startDate} onChange={(e) => setStartDate(e.target.value)} />}</Labeled>
      <Labeled label="Reason (optional)">{(id) => <input id={id} className={field} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />}</Labeled>
      <p className="text-caption text-muted-foreground sm:col-span-2">A person has one primary manager at a time. A new primary manager ends the old one on the day you choose. Secondary lines also give a manager sight of this person; dotted and project lines are for the chart only.</p>
      <div className="sm:col-span-2">
        <Actions busy={busy} label="Add reporting line" onCancel={onCancel} />
      </div>
    </form>
  );
}

function PlaceForm({ kind, options, roles, busy, onSubmit, onCancel }: { kind: "team" | "department"; options: { id: string; name: string }[]; roles: Record<string, string>; busy: boolean; onSubmit: (b: { id: string; type: string; startDate?: string }) => void; onCancel: () => void }) {
  const [target, setTarget] = useState("");
  const [type, setType] = useState("member");
  const [startDate, setStartDate] = useState(today());
  const [err, setErr] = useState<string | null>(null);
  const noun = kind === "team" ? "team" : "department";
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!target) return setErr(`Choose the ${noun}`);
    setErr(null);
    onSubmit({ id: target, type, startDate: startDate || undefined });
  }
  return (
    <form onSubmit={submit} noValidate aria-label={`Add to ${noun}`} className={formClass}>
      {err && <div className="sm:col-span-2"><FormAlert>{err}</FormAlert></div>}
      <Labeled label={kind === "team" ? "Team" : "Department"}>
        {(id) => (
          <select id={id} className={field} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Choose a {noun}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
      </Labeled>
      <Labeled label="Role">
        {(id) => (
          <select id={id} className={field} value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(roles).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
      </Labeled>
      <Labeled label="From">{(id) => <input id={id} type="date" className={field} value={startDate} onChange={(e) => setStartDate(e.target.value)} />}</Labeled>
      <div className="sm:col-span-2">
        <Actions busy={busy} label={`Add to ${noun}`} onCancel={onCancel} />
      </div>
    </form>
  );
}

function MoveForm({ teams, departments, busy, onSubmit, onCancel }: { teams: { id: string; name: string; departmentId: string }[]; departments: { id: string; name: string }[]; busy: boolean; onSubmit: (b: { toTeamId?: string; toDepartmentId?: string; effectiveDate?: string; reason?: string }) => void; onCancel: () => void }) {
  const [to, setTo] = useState(""); // "team:<id>" or "department:<id>"
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!to) return setErr("Choose where to move them");
    setErr(null);
    const [kind, id] = to.split(":") as ["team" | "department", string];
    onSubmit({ ...(kind === "team" ? { toTeamId: id } : { toDepartmentId: id }), effectiveDate: effectiveDate || undefined, reason: reason.trim() || undefined });
  }
  return (
    <form onSubmit={submit} noValidate aria-label="Move person" className={formClass}>
      {err && <div className="sm:col-span-2"><FormAlert>{err}</FormAlert></div>}
      <Labeled label="Move to">
        {(id) => (
          <select id={id} className={field} value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose a team or department</option>
            <optgroup label="Teams">
              {teams.map((t) => (
                <option key={t.id} value={`team:${t.id}`}>
                  {t.name} ({deptName.get(t.departmentId) ?? "department"})
                </option>
              ))}
            </optgroup>
            <optgroup label="Departments (no team)">
              {departments.map((d) => (
                <option key={d.id} value={`department:${d.id}`}>
                  {d.name}
                </option>
              ))}
            </optgroup>
          </select>
        )}
      </Labeled>
      <Labeled label="On">{(id) => <input id={id} type="date" className={field} value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />}</Labeled>
      <div className="sm:col-span-2">
        <Labeled label="Reason (optional)">{(id) => <input id={id} className={field} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />}</Labeled>
      </div>
      <p className="text-caption text-muted-foreground sm:col-span-2">
        <History aria-hidden="true" className="mr-1 inline size-3.5" />
        Their current teams and departments end on that day and the new ones start. Their reporting lines do not change. A date in the future schedules the move.
      </p>
      <div className="sm:col-span-2">
        <Actions busy={busy} label="Move" onCancel={onCancel} />
      </div>
    </form>
  );
}
