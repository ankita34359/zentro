import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
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
import { AGGREGATION_LABEL, CATEGORY_LABEL, createKpi, DIRECTION_LABEL, FREQUENCY_LABEL, listKpis } from "@/services/kpi";
import { KpiDrawer } from "./KpiDrawer";
import { CategoryBadge, kpiSentence } from "./kpiUi";

const selectCls = "h-10 w-full rounded-lg border border-input bg-card px-3 text-body text-foreground shadow-xs";

/**
 * KPIs (stages 3.3 and 3.4): the indicators the organization measures over and over, who has which target, and the
 * measurements recorded. Opening one shows it in the panel on the right (`?kpi=<id>` in the address).
 */
export default function KpiPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [category, setCategory] = useState("");
  const [frequency, setFrequency] = useState("");
  const [search, setSearch] = useState("");
  const [mine, setMine] = useState(false);
  const filters = { category: category || undefined, frequency: frequency || undefined, search: search.trim() || undefined, assignedToMe: mine };
  const q = useQuery({ queryKey: ["kpis", filters], queryFn: () => listKpis(filters), retry: false, placeholderData: (p) => p });
  const openId = params.get("kpi");
  const open = (id: string) => setParams((p) => { const n = new URLSearchParams(p); n.set("kpi", id); return n; });
  const close = () => setParams((p) => { const n = new URLSearchParams(p); n.delete("kpi"); return n; }, { replace: true });
  const canConfigure = can("kpi.configure");
  const filtered = Boolean(filters.category || filters.frequency || filters.search || mine);
  return (
    <>
      <PageHeader
        eyebrow="Strategy"
        title="KPIs"
        description="The indicators the organization measures again and again, who has which target, and how they are doing."
        actions={canConfigure ? <Button size="sm" onClick={() => setAdding(true)}><Plus aria-hidden="true" /> New KPI</Button> : undefined}
      />
      {adding && canConfigure && <NewKpiForm onDone={() => setAdding(false)} onCreated={(id) => { setAdding(false); open(id); }} />}
      <section aria-label="KPI list" className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <input aria-label="Search KPIs" type="search" placeholder="Search by name" value={search} onChange={(e) => setSearch(e.target.value)} className={selectCls} />
          <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className={selectCls}>
            <option value="">Any category</option>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select aria-label="How often" value={frequency} onChange={(e) => setFrequency(e.target.value)} className={selectCls}>
            <option value="">Any frequency</option>
            {Object.entries(FREQUENCY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="flex items-center gap-2 text-label"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only KPIs I have</label>
        </div>
        {q.isPending ? (
          <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
        ) : q.isError ? (
          <ErrorState title="The KPIs could not be loaded" error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data.length === 0 ? (
          <EmptyState illustration="chart" title={filtered ? "No KPIs match" : "No KPIs yet"} action={!filtered && canConfigure ? <Button size="sm" onClick={() => setAdding(true)}><Plus aria-hidden="true" /> New KPI</Button> : undefined}>
            {filtered ? "Change the search or the filters." : "A KPI is something you measure again and again, like qualified leads per month. Create one, give it a target, and record its values. Or load demo data in Settings to see how it looks."}
          </EmptyState>
        ) : (
          <ul aria-label="KPIs" className="grid gap-3 lg:grid-cols-2">
            {q.data.map((k) => (
              <li key={k.id}>
                <button type="button" onClick={() => open(k.id)} aria-label={`Open KPI: ${k.name}`} className="flex h-full w-full flex-col gap-2 rounded-xl border bg-card p-4 text-left hover:bg-muted/50">
                  <span className="flex flex-wrap items-center gap-2">
                    <BarChart3 aria-hidden="true" className="size-4 shrink-0 text-primary-ink" />
                    <span className="min-w-0 flex-1 text-body font-semibold">{k.name}</span>
                    <CategoryBadge category={k.category} />
                  </span>
                  <span className="text-caption text-muted-foreground">{kpiSentence(k)}</span>
                  <span className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
                    <span>{k.assignmentCount === 0 ? "No assignment you can see" : `${k.assignmentCount} active ${k.assignmentCount === 1 ? "assignment" : "assignments"}`}</span>
                    {k.isDemo && <Badge variant="dashed">Demo data</Badge>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <KpiDrawer id={openId} onClose={close} />
    </>
  );
}

function NewKpiForm({ onDone, onCreated }: { onDone: () => void; onCreated: (id: string) => void }) {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("delivery");
  const [frequency, setFrequency] = useState("monthly");
  const [direction, setDirection] = useState("higher_is_better");
  const [aggregation, setAggregation] = useState("sum");
  const [unit, setUnit] = useState("");
  const [target, setTarget] = useState("");
  const [max, setMax] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const create = useMutation({
    mutationFn: createKpi,
    onSuccess: (k) => {
      for (const key of ["kpis", "audit"]) void client.invalidateQueries({ queryKey: [key] });
      onCreated(k.id);
    },
    onError: (e) => setError(problemText(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setNameError("Give the KPI a name");
    setNameError(undefined);
    const t = target === "" ? null : Number(target);
    const m = max === "" ? null : Number(max);
    if ((t !== null && !Number.isFinite(t)) || (m !== null && !Number.isFinite(m))) return setError("The target must be a number");
    setError(null);
    create.mutate({ name: name.trim(), category, frequency, direction, aggregation, ...(description.trim() ? { description: description.trim() } : {}), ...(unit.trim() ? { unit: unit.trim() } : {}), ...(t !== null ? { defaultTarget: t } : {}), ...(direction === "target_range" && m !== null ? { defaultTargetMax: m } : {}) });
  }
  return (
    <Card lift={false} className="mb-6">
      <CardHeader>
        <CardTitle>New KPI</CardTitle>
        <p className="text-label text-muted-foreground">Name what you measure and how often. You give it targets and thresholds afterwards.</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate aria-label="New KPI" className="grid gap-3 sm:grid-cols-2">
          {error && <div className="sm:col-span-2"><FormAlert>{error}</FormAlert></div>}
          <div className="sm:col-span-2"><FormField label="Name" value={name} onChange={(e) => setName(e.target.value)} error={nameError} maxLength={80} autoComplete="off" placeholder="For example: Qualified leads" /></div>
          <div className="sm:col-span-2"><FormField label="What it is (optional)" value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} /></div>
          <SelectField label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </SelectField>
          <SelectField label="How often it is measured" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
            {Object.entries(FREQUENCY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </SelectField>
          <SelectField label="What is good" value={direction} onChange={(e) => setDirection(e.target.value)}>
            {Object.entries(DIRECTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </SelectField>
          <SelectField label="If there are several values in a period" value={aggregation} onChange={(e) => setAggregation(e.target.value)}>
            {Object.entries(AGGREGATION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </SelectField>
          <FormField label="Unit (optional)" value={unit} maxLength={20} placeholder="%, $, leads, days" onChange={(e) => setUnit(e.target.value)} />
          <FormField label={direction === "target_range" ? "Range from" : "Default target (optional)"} type="number" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
          {direction === "target_range" && <FormField label="Range to" type="number" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={create.isPending}>Create KPI</Button>
            <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
