import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, Users } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { FormAlert, FormField, FormNotice } from "@/components/common/FormField";
import { PageHeader } from "@/components/common/PageHeader";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { problemText } from "@/lib/authForm";
import { descendantsOf, indexStructure, levelOf, type StructureIndex } from "@/lib/structureTree";
import {
  archiveDepartment, archiveDesignation, archiveRoleFamily, archiveTeam, createDepartment, createDesignation, createRoleFamily, createTeam, getStructure,
  renameOrganization, restoreDepartment, restoreDesignation, restoreRoleFamily, restoreTeam, updateDepartment, updateDesignation, updateRoleFamily, updateTeam,
  type DepartmentItem, type DesignationItem, type RoleFamilyItem, type Structure, type TeamItem,
} from "@/services/structure";

type Kind = "department" | "team" | "roleFamily" | "designation";
type Verb = "add" | "rename" | "move" | "archive";
/** One open form at a time. `anchor` is the node it opens under ("root" for the section's own Add button); `subject` is the item it acts on. */
interface Panel { kind: Kind; verb: Verb; anchor: string; subject?: string }

const LABEL: Record<Kind, string> = { department: "department", team: "team", roleFamily: "role family", designation: "designation" };
const selectClass = "h-10 w-full rounded-lg border border-input bg-card px-3 text-body text-foreground shadow-xs";

/**
 * Settings → Organization structure (stage 2.5): the department → team → sub-team tree, role families and designations.
 * People with `org.manage` add, rename, move, archive and restore; everyone else with `org.view` sees it read only (a
 * scoped viewer sees just their part). Nothing is deleted, only archived. The server enforces every rule again and its
 * refusals (a name already used, an item with active children, too deep) are shown in its own words.
 */
export default function StructurePage() {
  const auth = useAuth();
  const client = useQueryClient();
  const canManage = auth.can("org.manage");
  const canRename = auth.can("org.settings");
  const q = useQuery({ queryKey: ["structure"], queryFn: getStructure, retry: false });
  const [panel, setPanel] = useState<Panel | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const done = () => {
    setPanel(null);
    setProblem(null);
    void client.invalidateQueries({ queryKey: ["structure"] });
    void client.invalidateQueries({ queryKey: ["audit"] });
  };
  /** Runs one change; the server's refusal is shown in its own words and the form stays open. */
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: done,
    onError: (e) => setProblem(problemText(e)),
  });
  const open = (p: Panel | null) => {
    setProblem(null);
    setPanel(p);
  };

  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState title="The structure could not be loaded" onRetry={() => void q.refetch()} />;
  const s = q.data;
  const idx = indexStructure(s, showArchived);
  const archivedCount = s.departments.filter((d) => d.archived).length + s.teams.filter((t) => t.archived).length + s.roleFamilies.filter((f) => f.archived).length + s.designations.filter((d) => d.archived).length;
  const ctx: Ctx = { s, idx, canManage, panel, open, act: (fn) => act.mutate(fn), busy: act.isPending, problem, showArchived };

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Organization structure"
        description="Departments, teams and sub-teams, and the role families and designations people hold. Nothing is deleted: archive what you no longer use and restore it later."
      />
      {canRename && <OrganizationName />}
      {s.partial && <p className="mb-4 rounded-lg border bg-muted px-3 py-2.5 text-label text-muted-foreground">You see the departments and teams in your scope. Someone with wider access sees all of them.</p>}
      {problem && !panel && <div className="mb-4"><FormAlert>{problem}</FormAlert></div>}

      <div className="space-y-6">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>Departments and teams</CardTitle>
              <CardDescription>
                Up to {s.limits.maxDepth} levels of departments, and up to {s.limits.maxDepth} levels of teams inside each department.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {archivedCount > 0 && (
                <label className="flex items-center gap-2 text-label">
                  <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                  Show archived ({archivedCount})
                </label>
              )}
              {canManage && (
                <Button size="sm" onClick={() => open({ kind: "department", verb: "add", anchor: "root" })}>
                  <Plus aria-hidden="true" /> Add department
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {panel?.anchor === "root" && panel.kind === "department" && <PanelForm ctx={ctx} className="mb-4" />}
            {idx.rootDepartments.length === 0 ? (
              <EmptyState illustration="org" title="No departments yet">
                {canManage ? "Start with the departments you have today, such as Engineering or Sales. Teams go inside them." : "Nothing is set up in your scope yet."}
              </EmptyState>
            ) : (
              <ul aria-label="Departments" className="space-y-3">
                {idx.rootDepartments.map((d) => (
                  <DepartmentNode key={d.id} d={d} level={1} ctx={ctx} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <FamiliesCard ctx={ctx} />
      </div>
    </>
  );
}

interface Ctx {
  s: Structure;
  idx: StructureIndex;
  canManage: boolean;
  panel: Panel | null;
  open: (p: Panel | null) => void;
  act: (fn: () => Promise<unknown>) => void;
  busy: boolean;
  problem: string | null;
  showArchived: boolean;
}

// ---------- the organization's own name ----------

function OrganizationName() {
  const auth = useAuth();
  const client = useQueryClient();
  const current = auth.me?.organization?.name ?? "";
  const [name, setName] = useState(current);
  const [saved, setSaved] = useState(false);
  const rename = useMutation({
    mutationFn: () => renameOrganization(name),
    onSuccess: (r) => {
      setName(r.name);
      setSaved(true);
      void client.invalidateQueries({ queryKey: ["auth", "me"] });
      void client.invalidateQueries({ queryKey: ["audit"] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    rename.mutate();
  };
  return (
    <Card className="mb-6">
      <CardContent className="pt-5">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3" aria-label="Organization name">
          <div className="min-w-0 flex-1 basis-64">
            <FormField label="Organization name" value={name} maxLength={80} onChange={(e) => { setName(e.target.value); setSaved(false); }} error={rename.isError ? problemText(rename.error) : undefined} />
          </div>
          <Button type="submit" variant="outline" disabled={rename.isPending || name.trim() === "" || name.trim() === current}>
            Save name
          </Button>
        </form>
        {saved && <div className="mt-3"><FormNotice>Organization name saved.</FormNotice></div>}
      </CardContent>
    </Card>
  );
}

// ---------- a row with its actions ----------

function Row({ title, description, archived, children, actions }: { title: string; description: string; archived: boolean; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <div className="min-w-0 flex-1 basis-48">
        <span className="font-medium">{title}</span> {children}
        {archived && <Badge variant="neutral">Archived</Badge>}
        {description && <span className="block text-label text-muted-foreground">{description}</span>}
      </div>
      {actions && <div className="flex flex-wrap gap-1">{actions}</div>}
    </div>
  );
}

function Act({ ctx, label, subject, kind, verb, anchor, children }: { ctx: Ctx; label: string; subject: string; kind: Kind; verb: Verb; anchor: string; children: ReactNode }) {
  return (
    <Button variant="ghost" size="sm" onClick={() => ctx.open({ kind, verb, anchor, subject })} aria-label={`${label} ${subject}`}>
      {children}
    </Button>
  );
}

function DepartmentNode({ d, level, ctx }: { d: DepartmentItem; level: number; ctx: Ctx }) {
  const subs = ctx.idx.subDepartments.get(d.id) ?? [];
  const teams = ctx.idx.topTeams.get(d.id) ?? [];
  const max = ctx.s.limits.maxDepth;
  const here = ctx.panel?.anchor === d.id;
  return (
    <li className="rounded-lg border bg-card p-3">
      <Row
        title={d.name}
        description={d.description}
        archived={d.archived}
        actions={
          ctx.canManage && (
            <>
              {d.archived ? (
                <Button variant="ghost" size="sm" disabled={ctx.busy} onClick={() => ctx.act(() => restoreDepartment(d.id))} aria-label={`Restore ${d.name}`}>Restore</Button>
              ) : (
                <>
                  <Button variant="ghost" size="sm" onClick={() => ctx.open({ kind: "team", verb: "add", anchor: d.id })} aria-label={`Add team to ${d.name}`}><Users aria-hidden="true" /> Add team</Button>
                  {level < max && <Button variant="ghost" size="sm" onClick={() => ctx.open({ kind: "department", verb: "add", anchor: d.id })} aria-label={`Add sub-department to ${d.name}`}><Building2 aria-hidden="true" /> Add sub-department</Button>}
                  <Act ctx={ctx} label="Rename" subject={d.name} kind="department" verb="rename" anchor={d.id}>Rename</Act>
                  <Act ctx={ctx} label="Move" subject={d.name} kind="department" verb="move" anchor={d.id}>Move</Act>
                  <Act ctx={ctx} label="Archive" subject={d.name} kind="department" verb="archive" anchor={d.id}>Archive…</Act>
                </>
              )}
            </>
          )
        }
      />
      {here && <PanelForm ctx={ctx} className="mt-3" department={d} />}
      {(teams.length > 0 || subs.length > 0) && (
        <ul className="mt-3 space-y-2 border-l pl-3 sm:pl-4">
          {teams.map((t) => (
            <TeamNode key={t.id} t={t} level={1} ctx={ctx} />
          ))}
          {subs.map((c) => (
            <DepartmentNode key={c.id} d={c} level={level + 1} ctx={ctx} />
          ))}
        </ul>
      )}
    </li>
  );
}

function TeamNode({ t, level, ctx }: { t: TeamItem; level: number; ctx: Ctx }) {
  const subs = ctx.idx.subTeams.get(t.id) ?? [];
  const max = ctx.s.limits.maxDepth;
  const here = ctx.panel?.anchor === t.id;
  return (
    <li>
      <Row
        title={t.name}
        description={t.description}
        archived={t.archived}
        actions={
          ctx.canManage && (
            <>
              {t.archived ? (
                <Button variant="ghost" size="sm" disabled={ctx.busy} onClick={() => ctx.act(() => restoreTeam(t.id))} aria-label={`Restore ${t.name}`}>Restore</Button>
              ) : (
                <>
                  {level < max && <Button variant="ghost" size="sm" onClick={() => ctx.open({ kind: "team", verb: "add", anchor: t.id })} aria-label={`Add sub-team to ${t.name}`}><Plus aria-hidden="true" /> Add sub-team</Button>}
                  <Act ctx={ctx} label="Rename" subject={t.name} kind="team" verb="rename" anchor={t.id}>Rename</Act>
                  <Act ctx={ctx} label="Move" subject={t.name} kind="team" verb="move" anchor={t.id}>Move</Act>
                  <Act ctx={ctx} label="Archive" subject={t.name} kind="team" verb="archive" anchor={t.id}>Archive…</Act>
                </>
              )}
            </>
          )
        }
      >
        <Badge variant="outline">{level === 1 ? "Team" : "Sub-team"}</Badge>
      </Row>
      {here && <PanelForm ctx={ctx} className="mt-2" team={t} />}
      {subs.length > 0 && (
        <ul className="mt-2 space-y-2 border-l pl-3 sm:pl-4">
          {subs.map((c) => (
            <TeamNode key={c.id} t={c} level={level + 1} ctx={ctx} />
          ))}
        </ul>
      )}
    </li>
  );
}

// ---------- role families and designations ----------

function FamiliesCard({ ctx }: { ctx: Ctx }) {
  const { s } = ctx;
  const families = s.roleFamilies.filter((f) => ctx.showArchived || !f.archived);
  const designationsOf = (id: string | null) => s.designations.filter((d) => d.roleFamilyId === id && (ctx.showArchived || !d.archived));
  const loose = designationsOf(null);
  const empty = families.length === 0 && loose.length === 0;
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Role families and designations</CardTitle>
          <CardDescription>A designation is a job title, such as &ldquo;Mentor&rdquo;. A role family groups designations that do similar work, so KPIs and comparisons can follow it later.</CardDescription>
        </div>
        {ctx.canManage && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => ctx.open({ kind: "roleFamily", verb: "add", anchor: "root" })}><Plus aria-hidden="true" /> Add role family</Button>
            <Button size="sm" variant="outline" onClick={() => ctx.open({ kind: "designation", verb: "add", anchor: "free" })}><Plus aria-hidden="true" /> Add designation</Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {ctx.panel?.anchor === "root" && ctx.panel.kind === "roleFamily" && <PanelForm ctx={ctx} />}
        {ctx.panel?.anchor === "free" && ctx.panel.kind === "designation" && <PanelForm ctx={ctx} />}
        {empty && <EmptyState illustration="org" title="No designations yet">{ctx.canManage ? "Add the job titles you use, for example Mentor, and group them in role families." : "Nothing is set up yet."}</EmptyState>}
        <ul aria-label="Role families" className="space-y-3">
          {families.map((f) => (
            <FamilyNode key={f.id} f={f} designations={designationsOf(f.id)} ctx={ctx} />
          ))}
        </ul>
        {loose.length > 0 && (
          <div>
            <h3 className="mb-2 text-label font-medium text-muted-foreground">Designations without a role family</h3>
            <ul className="space-y-2">
              {loose.map((d) => (
                <DesignationNode key={d.id} d={d} ctx={ctx} />
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FamilyNode({ f, designations, ctx }: { f: RoleFamilyItem; designations: DesignationItem[]; ctx: Ctx }) {
  return (
    <li className="rounded-lg border bg-card p-3">
      <Row
        title={f.name}
        description={f.description}
        archived={f.archived}
        actions={
          ctx.canManage && (
            <>
              {f.archived ? (
                <Button variant="ghost" size="sm" disabled={ctx.busy} onClick={() => ctx.act(() => restoreRoleFamily(f.id))} aria-label={`Restore ${f.name}`}>Restore</Button>
              ) : (
                <>
                  <Button variant="ghost" size="sm" onClick={() => ctx.open({ kind: "designation", verb: "add", anchor: f.id })} aria-label={`Add designation to ${f.name}`}><Plus aria-hidden="true" /> Add designation</Button>
                  <Act ctx={ctx} label="Rename" subject={f.name} kind="roleFamily" verb="rename" anchor={f.id}>Rename</Act>
                  <Act ctx={ctx} label="Archive" subject={f.name} kind="roleFamily" verb="archive" anchor={f.id}>Archive…</Act>
                </>
              )}
            </>
          )
        }
      >
        <Badge variant="outline">Role family</Badge>
      </Row>
      {ctx.panel?.anchor === f.id && <PanelForm ctx={ctx} className="mt-3" family={f} />}
      {designations.length > 0 && (
        <ul className="mt-3 space-y-2 border-l pl-3 sm:pl-4">
          {designations.map((d) => (
            <DesignationNode key={d.id} d={d} ctx={ctx} />
          ))}
        </ul>
      )}
    </li>
  );
}

function DesignationNode({ d, ctx }: { d: DesignationItem; ctx: Ctx }) {
  return (
    <li>
      <Row
        title={d.name}
        description={d.description}
        archived={d.archived}
        actions={
          ctx.canManage && (
            <>
              {d.archived ? (
                <Button variant="ghost" size="sm" disabled={ctx.busy} onClick={() => ctx.act(() => restoreDesignation(d.id))} aria-label={`Restore ${d.name}`}>Restore</Button>
              ) : (
                <>
                  <Act ctx={ctx} label="Rename" subject={d.name} kind="designation" verb="rename" anchor={d.id}>Rename</Act>
                  <Act ctx={ctx} label="Move" subject={d.name} kind="designation" verb="move" anchor={d.id}>Change family</Act>
                  <Act ctx={ctx} label="Archive" subject={d.name} kind="designation" verb="archive" anchor={d.id}>Archive…</Act>
                </>
              )}
            </>
          )
        }
      >
        <Badge variant="outline">Designation</Badge>
      </Row>
      {ctx.panel?.anchor === d.id && <PanelForm ctx={ctx} className="mt-2" designation={d} />}
    </li>
  );
}

// ---------- the one open form ----------

/** Add / rename / move / archive for whatever `ctx.panel` names. The nodes that own the panel pass their item in. */
function PanelForm({ ctx, className, department, team, family, designation }: { ctx: Ctx; className?: string; department?: DepartmentItem; team?: TeamItem; family?: RoleFamilyItem; designation?: DesignationItem }) {
  const p = ctx.panel!;
  const { s } = ctx;
  const item = department ?? team ?? family ?? designation;
  const [name, setName] = useState(p.verb === "rename" ? (item?.name ?? "") : "");
  const [description, setDescription] = useState(p.verb === "rename" ? (item?.description ?? "") : "");
  // move targets
  const [parentId, setParentId] = useState<string>(department?.parentId ?? "");
  const [departmentId, setDepartmentId] = useState<string>(team?.departmentId ?? "");
  const [parentTeamId, setParentTeamId] = useState<string>(team?.parentTeamId ?? "");
  const [familyId, setFamilyId] = useState<string>(designation?.roleFamilyId ?? (p.verb === "add" && p.kind === "designation" && p.anchor !== "free" ? p.anchor : ""));
  const cancel = () => ctx.open(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = { name, ...(description.trim() ? { description } : {}) };
    if (p.verb === "add") {
      if (p.kind === "department") return ctx.act(() => createDepartment({ ...text, parentId: p.anchor === "root" ? null : p.anchor }));
      if (p.kind === "roleFamily") return ctx.act(() => createRoleFamily(text));
      if (p.kind === "designation") return ctx.act(() => createDesignation({ ...text, roleFamilyId: familyId || null }));
      // a team: under a department, or a sub-team under a team
      const parentTeam = s.teams.find((t) => t.id === p.anchor);
      return ctx.act(() => createTeam({ ...text, departmentId: parentTeam ? parentTeam.departmentId : p.anchor, parentTeamId: parentTeam ? parentTeam.id : null }));
    }
    if (p.verb === "rename") {
      const body = { name, description };
      if (p.kind === "department") return ctx.act(() => updateDepartment(p.anchor, body));
      if (p.kind === "team") return ctx.act(() => updateTeam(p.anchor, body));
      if (p.kind === "roleFamily") return ctx.act(() => updateRoleFamily(p.anchor, body));
      return ctx.act(() => updateDesignation(p.anchor, body));
    }
    if (p.verb === "move") {
      if (p.kind === "department") return ctx.act(() => updateDepartment(p.anchor, { parentId: parentId || null }));
      if (p.kind === "team") return ctx.act(() => updateTeam(p.anchor, { departmentId, parentTeamId: parentTeamId || null }));
      return ctx.act(() => updateDesignation(p.anchor, { roleFamilyId: familyId || null }));
    }
  };
  const confirmArchive = () => {
    if (p.kind === "department") return ctx.act(() => archiveDepartment(p.anchor));
    if (p.kind === "team") return ctx.act(() => archiveTeam(p.anchor));
    if (p.kind === "roleFamily") return ctx.act(() => archiveRoleFamily(p.anchor));
    return ctx.act(() => archiveDesignation(p.anchor));
  };

  const box = `rounded-lg border bg-muted/40 p-3 ${className ?? ""}`;
  if (p.verb === "archive") {
    return (
      <div className={box} role="group" aria-label={`Archive ${item?.name ?? ""}`}>
        <p className="text-label">Archive &ldquo;{item?.name}&rdquo;? It disappears from the lists, nothing is deleted, and you can restore it later.</p>
        {ctx.problem && <div className="mt-2"><FormAlert>{ctx.problem}</FormAlert></div>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={confirmArchive} disabled={ctx.busy}>Confirm archive</Button>
          <Button size="sm" variant="ghost" onClick={cancel}>Cancel</Button>
        </div>
      </div>
    );
  }

  const deptOptions = (excluded: Set<string>) =>
    s.departments
      .filter((d) => !d.archived && !excluded.has(d.id))
      .map((d) => ({ id: d.id, label: `${"— ".repeat(levelOf(s.departments, (x) => x.parentId, d.id) - 1)}${d.name}` }));
  const teamOptions = (deptId: string, excluded: Set<string>) =>
    s.teams
      .filter((t) => !t.archived && t.departmentId === deptId && !excluded.has(t.id))
      .map((t) => ({ id: t.id, label: `${"— ".repeat(levelOf(s.teams, (x) => x.parentTeamId, t.id) - 1)}${t.name}` }));
  const familyOptions = s.roleFamilies.filter((f) => !f.archived);

  const heading =
    p.verb === "add"
      ? p.kind === "team" && s.teams.some((t) => t.id === p.anchor)
        ? "New sub-team"
        : p.kind === "department" && p.anchor !== "root"
          ? "New sub-department"
          : `New ${LABEL[p.kind]}`
      : p.verb === "rename"
        ? `Rename or describe ${item?.name ?? ""}`
        : `Move ${item?.name ?? ""}`;

  return (
    <form onSubmit={submit} className={box} aria-label={heading}>
      <h3 className="mb-2 text-label font-semibold">{heading}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {p.verb !== "move" && (
          <>
            <FormField label="Name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required autoFocus />
            <FormField label="Description (optional)" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
          </>
        )}
        {p.verb === "move" && p.kind === "department" && department && (
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="move-parent" className="text-label font-medium">New parent department</label>
            <select id="move-parent" className={selectClass} value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">Top level (no parent)</option>
              {deptOptions(new Set([department.id, ...descendantsOf(s.departments, (x) => x.parentId, department.id)])).map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>
        )}
        {p.verb === "move" && p.kind === "team" && team && (
          <>
            <div className="space-y-1.5">
              <label htmlFor="move-dept" className="text-label font-medium">Department</label>
              <select id="move-dept" className={selectClass} value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setParentTeamId(""); }}>
                {deptOptions(new Set()).map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="move-team" className="text-label font-medium">Parent team</label>
              <select id="move-team" className={selectClass} value={parentTeamId} onChange={(e) => setParentTeamId(e.target.value)}>
                <option value="">Directly under the department</option>
                {teamOptions(departmentId, new Set([team.id, ...descendantsOf(s.teams, (x) => x.parentTeamId, team.id)])).map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
          </>
        )}
        {((p.verb === "move" && p.kind === "designation") || (p.verb === "add" && p.kind === "designation")) && (
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="family" className="text-label font-medium">Role family</label>
            <select id="family" className={selectClass} value={familyId} onChange={(e) => setFamilyId(e.target.value)}>
              <option value="">No role family</option>
              {familyOptions.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      {ctx.problem && <div className="mt-3"><FormAlert>{ctx.problem}</FormAlert></div>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={ctx.busy || (p.verb !== "move" && name.trim() === "")}>
          {p.verb === "add" ? "Add" : p.verb === "rename" ? "Save" : "Move"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={cancel}>Cancel</Button>
      </div>
    </form>
  );
}
