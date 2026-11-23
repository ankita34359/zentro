import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ErrorState } from "@/components/common/ErrorState";
import { FormAlert, FormField, FormNotice } from "@/components/common/FormField";
import { SelectField } from "@/components/common/SelectField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SheetRight } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { problemText } from "@/lib/authForm";
import { ApiError } from "@/services/api";
import {
  AGGREGATION_LABEL, archiveKpi, assignKpi, CATEGORY_LABEL, COMPARATOR_LABEL, DIRECTION_LABEL, endAssignment, FREQUENCY_LABEL, getKpi, LEVEL_LABEL, setThresholds, SUBJECT_LABEL, thresholdText, updateKpi,
  type KpiDetail,
} from "@/services/kpi";
import { listPeople } from "@/services/people";
import { getStructure } from "@/services/structure";
import { aggregationText, CategoryBadge, kpiSentence } from "./kpiUi";
import { MeasurementsSection } from "./MeasurementsSection";

const REFRESH = ["kpis", "kpi", "kpi-history", "kpi-overview", "audit", "overview"];

/** The right-hand panel with one KPI. `id` null = closed. */
export function KpiDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  return (
    <SheetRight open={id !== null} onOpenChange={(o) => !o && onClose()} title="KPI" description="Definition, targets, thresholds and measurements of one KPI." className="w-[38rem]">
      {id && <Body key={id} id={id} />}
    </SheetRight>
  );
}

function Body({ id }: { id: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["kpi", id], queryFn: () => getKpi(id), retry: false });
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (v: { fn: () => Promise<unknown>; done: string }) => v.fn().then(() => v.done),
    onSuccess: (done) => {
      setProblem(null);
      setNotice(done);
      for (const k of REFRESH) void client.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => {
      setNotice(null);
      setProblem(problemText(e));
    },
  });
  const act = (fn: () => Promise<unknown>, done: string) => run.mutate({ fn, done });

  if (q.isPending) {
    return (
      <div className="space-y-4 p-6" aria-busy="true">
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (q.isError) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="p-6">
        <ErrorState title={gone ? "This KPI is not in your view" : "The KPI could not be loaded"} error={gone ? undefined : q.error} onRetry={gone ? undefined : () => void q.refetch()} />
        <Dialog.Close asChild>
          <Button variant="outline" className="mt-4">Close</Button>
        </Dialog.Close>
      </div>
    );
  }
  const k = q.data;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start gap-3 border-b p-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-heading font-semibold">{k.name}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CategoryBadge category={k.category} />
            <Badge variant="neutral">{FREQUENCY_LABEL[k.frequency]}</Badge>
            {k.archived && <Badge variant="dashed">Archived</Badge>}
            {k.isDemo && <Badge variant="dashed">Demo data</Badge>}
          </div>
        </div>
        <Dialog.Close asChild>
          <Button variant="ghost" size="icon" aria-label="Close KPI">
            <X aria-hidden="true" />
          </Button>
        </Dialog.Close>
      </header>
      <div className="flex-1 space-y-6 p-5">
        {notice && <FormNotice>{notice}</FormNotice>}
        {problem && <FormAlert>{problem}</FormAlert>}
        <p className="text-label text-muted-foreground">{kpiSentence(k)} · several values in one period: {aggregationText(k.aggregation).toLowerCase()}</p>
        {k.description && <p className="whitespace-pre-wrap text-body">{k.description}</p>}
        <MeasurementsSection k={k} />
        <Targets k={k} busy={run.isPending} act={act} />
        <Thresholds k={k} busy={run.isPending} act={act} />
        {k.can.configure && !k.archived && <Manage k={k} busy={run.isPending} act={act} />}
      </div>
    </div>
  );
}

type Act = (fn: () => Promise<unknown>, done: string) => void;

// ---------- who has this KPI, with which target ----------

function Targets({ k, busy, act }: { k: KpiDetail; busy: boolean; act: Act }) {
  const people = useQuery({ queryKey: ["people", "all"], queryFn: () => listPeople({ limit: 500 }), enabled: k.can.assign, retry: false });
  const structure = useQuery({ queryKey: ["structure"], queryFn: getStructure, enabled: k.can.assign, retry: false });
  const [who, setWho] = useState("");
  const [target, setTarget] = useState("");
  const [max, setMax] = useState("");
  const [weight, setWeight] = useState("1");
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const unit = k.unit ? ` ${k.unit}` : "";
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!who) return setErr("Choose who the KPI is for");
    const t = target === "" ? undefined : Number(target);
    const m = max === "" ? undefined : Number(max);
    const w = Number(weight);
    if ((t !== undefined && !Number.isFinite(t)) || (m !== undefined && !Number.isFinite(m)) || !Number.isFinite(w) || w <= 0) return setErr("The target, the range end and the weight must be numbers (the weight more than 0)");
    if (t === undefined && k.defaultTarget === null) return setErr("Give a target: this KPI has no default target");
    setErr(null);
    const [kind, sid] = who.split(":") as [string, string];
    const subject = kind === "person" ? { assigneeId: sid } : kind === "team" ? { teamId: sid } : kind === "department" ? { departmentId: sid } : kind === "designation" ? { designationId: sid } : { roleFamilyId: sid };
    act(() => assignKpi(k.id, { ...subject, ...(t !== undefined ? { targetValue: t } : {}), ...(m !== undefined ? { targetMax: m } : {}), weight: w }), "Assigned.");
    setWho("");
    setTarget("");
    setMax("");
  }
  return (
    <section aria-label="Who has this KPI" className="space-y-3">
      <h3 className="text-label font-semibold">Who has this KPI</h3>
      {k.assignments.length === 0 ? <p className="text-label text-muted-foreground">Nobody you can see has been given this KPI yet.</p> : (
        <ul className="divide-y rounded-lg border">
          {k.assignments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 text-body">
                {a.subject.name} <span className="text-caption text-muted-foreground">{(SUBJECT_LABEL[a.subject.kind] ?? a.subject.kind).toLowerCase()}{a.subject.kind !== "person" ? ` · covers ${a.appliesTo} ${a.appliesTo === 1 ? "person" : "people"}` : ""}</span>
                <span className="block text-caption text-muted-foreground">
                  Target {a.targetValue}{a.targetMax !== null ? ` to ${a.targetMax}` : ""}{unit} · weight {a.weight} · from {a.effectiveFrom}{a.effectiveTo ? ` to ${a.effectiveTo}` : ""}{!a.active ? " (not active today)" : ""}
                </span>
              </span>
              {k.can.assign && a.active && (confirm === a.id ? (
                <span className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={busy} aria-label={`Confirm ending the KPI for ${a.subject.name}`} onClick={() => { act(() => endAssignment(k.id, a.id), "Ended. It stays in the history."); setConfirm(null); }}>Confirm</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
                </span>
              ) : (
                <Button size="sm" variant="ghost" aria-label={`End the KPI for ${a.subject.name}`} onClick={() => setConfirm(a.id)}>End</Button>
              ))}
            </li>
          ))}
        </ul>
      )}
      {k.can.assign && !k.archived && (
        <form noValidate aria-label="Assign this KPI" onSubmit={submit} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-4">
          {err && <div className="sm:col-span-4"><FormAlert>{err}</FormAlert></div>}
          <div className="sm:col-span-4">
            <SelectField label="Give it to" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">Choose a person, team, department, designation or role family</option>
              <optgroup label="Role families">{(structure.data?.roleFamilies ?? []).filter((f) => !f.archived).map((f) => <option key={f.id} value={`role_family:${f.id}`}>{f.name}</option>)}</optgroup>
              <optgroup label="Designations">{(structure.data?.designations ?? []).filter((d) => !d.archived).map((d) => <option key={d.id} value={`designation:${d.id}`}>{d.name}</option>)}</optgroup>
              <optgroup label="Departments">{(structure.data?.departments ?? []).filter((d) => !d.archived).map((d) => <option key={d.id} value={`department:${d.id}`}>{d.name}</option>)}</optgroup>
              <optgroup label="Teams">{(structure.data?.teams ?? []).filter((t) => !t.archived).map((t) => <option key={t.id} value={`team:${t.id}`}>{t.name}</option>)}</optgroup>
              <optgroup label="People">{(people.data?.people ?? []).filter((p) => !p.archived).map((p) => <option key={p.id} value={`person:${p.id}`}>{p.displayName}</option>)}</optgroup>
            </SelectField>
          </div>
          <FormField label={k.direction === "target_range" ? "Range from" : "Target"} type="number" inputMode="decimal" value={target} placeholder={k.defaultTarget === null ? "" : String(k.defaultTarget)} onChange={(e) => setTarget(e.target.value)} />
          {k.direction === "target_range" && <FormField label="Range to" type="number" inputMode="decimal" value={max} placeholder={k.defaultTargetMax === null ? "" : String(k.defaultTargetMax)} onChange={(e) => setMax(e.target.value)} />}
          <FormField label="Weight" type="number" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
          <div className="flex items-end"><Button type="submit" size="sm" variant="outline" disabled={busy}>Assign</Button></div>
        </form>
      )}
    </section>
  );
}

// ---------- thresholds ----------

const LEVELS = ["warning", "critical", "excellent"] as const;

function Thresholds({ k, busy, act }: { k: KpiDetail; busy: boolean; act: Act }) {
  const current = Object.fromEntries(k.thresholds.map((t) => [t.level, t]));
  type Row = { on: boolean; comparator: string; basis: string; value: string };
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(LEVELS.map((l) => [l, { on: !!current[l], comparator: current[l]?.comparator ?? (l === "excellent" ? "gte" : "lt"), basis: current[l]?.basis ?? "percent_of_target", value: current[l] ? String(current[l]!.value) : "" } as Row])));
  const [err, setErr] = useState<string | null>(null);
  const set = (l: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [l]: { ...r[l]!, ...patch } }));
  return (
    <section aria-label="Thresholds" className="space-y-3">
      <h3 className="text-label font-semibold">Thresholds</h3>
      {k.thresholds.length === 0 ? <p className="text-label text-muted-foreground">No thresholds yet, so no value is flagged as a warning or critical.</p> : (
        <ul className="space-y-1 text-label">
          {k.thresholds.map((t) => (
            <li key={t.id}><strong>{LEVEL_LABEL[t.level]}</strong> when the value {thresholdText(t, k.unit)}.</li>
          ))}
        </ul>
      )}
      {k.can.configure && !k.archived && (
        <form
          noValidate
          aria-label="Set thresholds"
          className="space-y-3 rounded-lg border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const list: { level: string; comparator: string; basis: string; value: number }[] = [];
            for (const l of LEVELS) {
              const r = rows[l]!;
              if (!r.on) continue;
              const v = Number(r.value);
              if (r.value === "" || !Number.isFinite(v)) return setErr(`Give a number for the ${(LEVEL_LABEL[l] ?? l).toLowerCase()} threshold`);
              list.push({ level: l, comparator: r.comparator, basis: r.basis, value: v });
            }
            setErr(null);
            act(() => setThresholds(k.id, list), "Thresholds saved.");
          }}
        >
          {err && <FormAlert>{err}</FormAlert>}
          {LEVELS.map((l) => (
            <div key={l} className="grid gap-2 sm:grid-cols-[8rem_1fr_1fr_6rem] sm:items-end">
              <label className="flex items-center gap-2 text-label font-medium"><input type="checkbox" checked={rows[l]!.on} onChange={(e) => set(l, { on: e.target.checked })} /> {LEVEL_LABEL[l]}</label>
              <SelectField label={`${LEVEL_LABEL[l]} when the value`} value={rows[l]!.comparator} disabled={!rows[l]!.on} onChange={(e) => set(l, { comparator: e.target.value })}>
                {Object.entries(COMPARATOR_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </SelectField>
              <SelectField label={`${LEVEL_LABEL[l]} measured as`} value={rows[l]!.basis} disabled={!rows[l]!.on} onChange={(e) => set(l, { basis: e.target.value })}>
                <option value="percent_of_target">% of the target</option>
                <option value="absolute">The value itself</option>
              </SelectField>
              <FormField label={`${LEVEL_LABEL[l]} number`} type="number" inputMode="decimal" value={rows[l]!.value} disabled={!rows[l]!.on} onChange={(e) => set(l, { value: e.target.value })} />
            </div>
          ))}
          <Button type="submit" size="sm" variant="outline" disabled={busy}>Save thresholds</Button>
        </form>
      )}
    </section>
  );
}

// ---------- edit and archive ----------

function Manage({ k, busy, act }: { k: KpiDetail; busy: boolean; act: Act }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [name, setName] = useState(k.name);
  const [description, setDescription] = useState(k.description);
  const [target, setTarget] = useState(k.defaultTarget === null ? "" : String(k.defaultTarget));
  const [err, setErr] = useState<string | null>(null);
  return (
    <section aria-label="Manage this KPI" className="space-y-3 rounded-lg border p-4">
      <h3 className="text-label font-semibold">Manage</h3>
      <p className="text-caption text-muted-foreground">{CATEGORY_LABEL[k.category]} · {DIRECTION_LABEL[k.direction]} · {AGGREGATION_LABEL[k.aggregation]}. The key <code>{k.key}</code> never changes.</p>
      {open ? (
        <form
          noValidate
          aria-label="Edit the KPI"
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const t = target === "" ? null : Number(target);
            if (!name.trim()) return setErr("A KPI needs a name");
            if (t !== null && !Number.isFinite(t)) return setErr("The default target must be a number");
            setErr(null);
            act(() => updateKpi(k.id, { name: name.trim(), description: description.trim(), defaultTarget: t }), "Saved.");
            setOpen(false);
          }}
        >
          {err && <FormAlert>{err}</FormAlert>}
          <FormField label="Name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <FormField label="Description" value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} />
          <FormField label="Default target" type="number" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
          <div className="flex gap-2"><Button type="submit" size="sm" disabled={busy}>Save</Button><Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
        </form>
      ) : <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Edit the definition</Button>}
      {confirm ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-label">Archive this KPI? Its history is kept.</span>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => { act(() => archiveKpi(k.id), "Archived."); setConfirm(false); }}>Confirm archive</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
        </div>
      ) : <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>Archive…</Button>}
    </section>
  );
}
