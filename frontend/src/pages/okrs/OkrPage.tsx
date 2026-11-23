import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListTree, Plus, SearchCheck, Target, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { FormAlert, FormField } from "@/components/common/FormField";
import { PageHeader } from "@/components/common/PageHeader";
import { SelectField } from "@/components/common/SelectField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { problemText } from "@/lib/authForm";
import { createObjective, LEVEL_LABEL, listObjectives, type KeyResultInput } from "@/services/okr";
import { listPeople } from "@/services/people";
import { getStructure } from "@/services/structure";
import { ObjectiveDrawer } from "./ObjectiveDrawer";
import { AlignmentTree, GapsReport } from "./AlignmentViews";
import { Attainment, HealthBadge, LifecycleBadge, whereText } from "./okrUi";

const area = "w-full rounded-lg border border-input bg-card px-3 py-2 text-body text-foreground shadow-xs";
const selectCls = "h-10 w-full rounded-lg border border-input bg-card px-3 text-body text-foreground shadow-xs";

/**
 * Objectives and key results (stage 3.1). Progress is computed from the actual values recorded on key results, never from
 * counting finished tasks. Opening an objective shows it in the panel on the right (`?objective=<id>` in the address).
 */
export default function OkrPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [level, setLevel] = useState("");
  const [lifecycle, setLifecycle] = useState("");
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState("");
  const filters = { level: level || undefined, lifecycle: lifecycle || undefined, mine, search: search.trim() || undefined };
  const q = useQuery({ queryKey: ["objectives", filters], queryFn: () => listObjectives(filters), retry: false, placeholderData: (p) => p });
  const view = params.get("view") === "tree" ? "tree" : params.get("view") === "gaps" ? "gaps" : "list";
  const openId = params.get("objective");
  const tab = (v: "list" | "tree" | "gaps", label: string, Icon: typeof Target) => (
    <Link to={{ search: (() => { const n = new URLSearchParams(params); if (v === "list") n.delete("view"); else n.set("view", v); return n.toString() ? `?${n.toString()}` : ""; })() }} role="tab" aria-selected={view === v} className={cn("-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-label font-medium", view === v ? "border-primary text-primary-ink" : "border-transparent text-muted-foreground hover:text-foreground")}>
      <Icon aria-hidden="true" className="size-4" /> {label}
    </Link>
  );
  const open = (id: string) => setParams((p) => { const n = new URLSearchParams(p); n.set("objective", id); return n; });
  const close = () => setParams((p) => { const n = new URLSearchParams(p); n.delete("objective"); return n; }, { replace: true });
  const canCreate = can("okr.create");
  const filtered = Boolean(filters.level || filters.lifecycle || mine || filters.search);

  return (
    <>
      <PageHeader
        eyebrow="Strategy"
        title="OKRs & Goals"
        description="What the organization is aiming for, from the company down to each person, and how far each goal has really come."
        actions={canCreate ? <Button size="sm" onClick={() => setAdding(true)}><Plus aria-hidden="true" /> New objective</Button> : undefined}
      />
      {adding && canCreate && <NewObjectiveForm onDone={() => setAdding(false)} onCreated={(id) => { setAdding(false); open(id); }} />}
      <div role="tablist" aria-label="OKR views" className="mb-5 flex overflow-x-auto border-b">
        {tab("list", "Objectives", Target)}
        {tab("tree", "Alignment", ListTree)}
        {tab("gaps", "Gaps", SearchCheck)}
      </div>
      {view === "tree" && <AlignmentTree onOpen={open} />}
      {view === "gaps" && <GapsReport onOpen={open} />}
      {view === "list" && <section aria-label="Objectives" className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <input aria-label="Search objectives" type="search" placeholder="Search by title" value={search} onChange={(e) => setSearch(e.target.value)} className={selectCls} />
          <select aria-label="Level" value={level} onChange={(e) => setLevel(e.target.value)} className={selectCls}>
            <option value="">Any level</option>
            {Object.entries(LEVEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select aria-label="State" value={lifecycle} onChange={(e) => setLifecycle(e.target.value)} className={selectCls}>
            <option value="">Any state</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <label className="flex items-center gap-2 text-label"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only objectives I own</label>
        </div>
        {q.isPending ? (
          <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
        ) : q.isError ? (
          <ErrorState title="The objectives could not be loaded" error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data.length === 0 ? (
          <EmptyState illustration="target" title={filtered ? "No objectives match" : "No objectives yet"} action={!filtered && canCreate ? <Button size="sm" onClick={() => setAdding(true)}><Plus aria-hidden="true" /> New objective</Button> : undefined}>
            {filtered ? "Change the search or the filters." : "An objective says what you want to achieve; its key results say how you will measure it. Create the first one, or load demo data in Settings to see how it looks."}
          </EmptyState>
        ) : (
          <ul aria-label="Objective list" className="grid gap-3 lg:grid-cols-2">
            {q.data.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => open(o.id)} aria-label={`Open objective: ${o.title}`} className="flex h-full w-full flex-col gap-3 rounded-xl border bg-card p-4 text-left hover:bg-muted/50">
                  <span className="flex flex-wrap items-center gap-2">
                    <Target aria-hidden="true" className="size-4 shrink-0 text-primary-ink" />
                    <span className="min-w-0 flex-1 text-body font-semibold">{o.title}</span>
                    <LifecycleBadge lifecycle={o.lifecycle} />
                    <HealthBadge health={o.health} />
                  </span>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
                    <span>{whereText(o)}</span>
                    <span>{o.startDate} to {o.endDate}</span>
                    <span>{o.keyResultCount} key {o.keyResultCount === 1 ? "result" : "results"}</span>
                    {o.owner && o.level !== "individual" && <span>Owner: {o.owner.name}</span>}
                    {o.published && <Badge variant="info">Published</Badge>}
                    {o.isDemo && <Badge variant="dashed">Demo data</Badge>}
                  </span>
                  <Attainment pct={o.attainmentPct} dataState={o.dataState} coveragePct={o.coveragePct} elapsedPct={o.elapsedPct} label={`Progress of ${o.title}`} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>}
      <ObjectiveDrawer id={openId} onClose={close} />
    </>
  );
}

// ---------- new objective ----------

interface KrRow { title: string; direction: "increase" | "decrease"; start: string; target: string; unit: string }
const emptyKr = (): KrRow => ({ title: "", direction: "increase", start: "0", target: "", unit: "" });
const yearStart = (): string => `${new Date().getUTCFullYear()}-01-01`;
const yearEnd = (): string => `${new Date().getUTCFullYear()}-12-31`;

function NewObjectiveForm({ onDone, onCreated }: { onDone: () => void; onCreated: (id: string) => void }) {
  const client = useQueryClient();
  const structure = useQuery({ queryKey: ["structure"], queryFn: getStructure, retry: false });
  const people = useQuery({ queryKey: ["people", "all"], queryFn: () => listPeople({ limit: 500 }), retry: false });
  const [level, setLevel] = useState("team");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState(yearStart());
  const [endDate, setEndDate] = useState(yearEnd());
  const [departmentId, setDepartmentId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [krs, setKrs] = useState<KrRow[]>([emptyKr()]);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | undefined>();
  const create = useMutation({
    mutationFn: createObjective,
    onSuccess: (o) => {
      for (const k of ["objectives", "overview", "audit", "linkable"]) void client.invalidateQueries({ queryKey: [k] });
      onCreated(o.id);
    },
    onError: (e) => setError(problemText(e)),
  });
  const setKr = (i: number, patch: Partial<KrRow>) => setKrs((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setTitleError("Give the objective a title");
    setTitleError(undefined);
    if (level === "department" && !departmentId) return setError("Choose the department");
    if (level === "team" && !teamId) return setError("Choose the team");
    const keyResults: KeyResultInput[] = [];
    for (const [i, r] of krs.entries()) {
      if (!r.title.trim() && r.target === "") continue; // an untouched row
      const start = Number(r.start === "" ? "0" : r.start);
      const target = Number(r.target);
      if (!r.title.trim()) return setError(`Give key result ${i + 1} a title`);
      if (r.target === "" || !Number.isFinite(target) || !Number.isFinite(start)) return setError(`Key result ${i + 1} needs a start and a target that are numbers`);
      keyResults.push({ title: r.title.trim(), direction: r.direction, startValue: start, targetValue: target, ...(r.unit.trim() ? { unit: r.unit.trim() } : {}) });
    }
    setError(null);
    create.mutate({
      level,
      title: title.trim(),
      startDate,
      endDate,
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(level === "department" ? { departmentId } : {}),
      ...(level === "team" ? { teamId } : {}),
      ...(level === "individual" && ownerId ? { ownerId } : {}),
      keyResults,
    });
  }

  const departments = (structure.data?.departments ?? []).filter((d) => !d.archived);
  const teams = (structure.data?.teams ?? []).filter((t) => !t.archived);
  return (
    <Card lift={false} className="mb-6">
      <CardHeader>
        <CardTitle>New objective</CardTitle>
        <p className="text-label text-muted-foreground">Say what you want to achieve, then how you will measure it. Progress comes from the values you record, not from finished tasks.</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate aria-label="New objective" className="grid gap-3 sm:grid-cols-2">
          {error && <div className="sm:col-span-2"><FormAlert>{error}</FormAlert></div>}
          <SelectField label="Level" value={level} onChange={(e) => setLevel(e.target.value)}>
            {Object.entries(LEVEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </SelectField>
          {level === "department" && (
            <SelectField label="Department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">Choose a department</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </SelectField>
          )}
          {level === "team" && (
            <SelectField label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">Choose a team</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </SelectField>
          )}
          {level === "individual" && (
            <SelectField label="Whose objective" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Mine</option>
              {(people.data?.people ?? []).filter((p) => !p.archived).map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
            </SelectField>
          )}
          <div className="sm:col-span-2"><FormField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} error={titleError} maxLength={160} autoComplete="off" /></div>
          <FormField label="Starts" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <FormField label="Ends" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          <label className="block space-y-1.5 text-label font-medium sm:col-span-2">
            Why it matters (optional)
            <textarea className={area} rows={2} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <fieldset className="space-y-3 sm:col-span-2">
            <legend className="text-label font-semibold">Key results</legend>
            {krs.map((r, i) => (
              <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-6">
                <div className="sm:col-span-6"><FormField label={`Key result ${i + 1}`} value={r.title} maxLength={160} placeholder="What will you measure?" onChange={(e) => setKr(i, { title: e.target.value })} /></div>
                <div className="sm:col-span-2">
                  <SelectField label="Should it" value={r.direction} onChange={(e) => setKr(i, { direction: e.target.value as "increase" | "decrease" })}>
                    <option value="increase">Go up</option>
                    <option value="decrease">Go down</option>
                  </SelectField>
                </div>
                <FormField label="From" type="number" inputMode="decimal" value={r.start} onChange={(e) => setKr(i, { start: e.target.value })} />
                <FormField label="To" type="number" inputMode="decimal" value={r.target} onChange={(e) => setKr(i, { target: e.target.value })} />
                <FormField label="Unit" value={r.unit} maxLength={20} placeholder="%, $, deals" onChange={(e) => setKr(i, { unit: e.target.value })} />
                {krs.length > 1 && (
                  <div className="flex items-end">
                    <Button type="button" size="sm" variant="ghost" aria-label={`Remove key result ${i + 1}`} onClick={() => setKrs((rows) => rows.filter((_, j) => j !== i))}>
                      <Trash2 aria-hidden="true" /> Remove
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {krs.length < 12 && <Button type="button" size="sm" variant="outline" onClick={() => setKrs((rows) => [...rows, emptyKr()])}><Plus aria-hidden="true" /> Add a key result</Button>}
          </fieldset>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={create.isPending}>Create objective</Button>
            <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
