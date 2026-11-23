import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { FormAlert, FormField, FormNotice } from "@/components/common/FormField";
import { PageHeader } from "@/components/common/PageHeader";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { SelectField } from "@/components/common/SelectField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { problemText } from "@/lib/authForm";
import { activateModel, createModel, getTemplates, listModels, previewModel, STATE_WORD, STATUS_WORD, updateModel, type ModelView, type PreviewResult } from "@/services/scoring";
import { getStructure } from "@/services/structure";

const field = "h-10 w-full rounded-lg border border-input bg-card px-3 text-body text-foreground shadow-xs";

/**
 * Settings → Scoring (stage 5.1): the scoring models (what each role is measured on and how much each part counts) and the
 * what-if calculator. Weights are data you can change; the measures themselves are fixed, tested code. Nothing typed into the
 * calculator is stored.
 */
export default function ScoringPage() {
  const { can } = useAuth();
  const canConfigure = can("performance.configure");
  const q = useQuery({ queryKey: ["scoring-models"], queryFn: () => listModels(true), retry: false });
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Scoring"
        description="What each kind of role is measured on and how much each part counts. Every score can be explained from these settings and the records behind it."
        actions={canConfigure ? <Button size="sm" onClick={() => setAdding(true)}><Plus aria-hidden="true" /> New model</Button> : undefined}
      />
      {adding && canConfigure && <NewModel onDone={() => setAdding(false)} onCreated={(id) => { setAdding(false); setOpen(id); }} />}
      {q.isPending ? <PageSkeleton /> : q.isError ? <ErrorState title="The scoring models could not be loaded" error={q.error} onRetry={() => void q.refetch()} /> : q.data.length === 0 ? (
        <EmptyState illustration="gauge" title="No scoring models yet">Open this page again in a moment: the standard models are added the first time.</EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-5">
          <section aria-label="Scoring models" className="space-y-3 lg:col-span-2">
            <ul className="space-y-2">
              {q.data.map((m) => (
                <li key={m.id}>
                  <button type="button" aria-label={`Open model: ${m.name} version ${m.version}`} aria-pressed={open === m.id} onClick={() => setOpen(m.id)} className={`flex w-full flex-wrap items-center gap-2 rounded-xl border bg-card p-3 text-left hover:bg-muted/50 ${open === m.id ? "border-primary" : ""}`}>
                    <span className="min-w-0 flex-1 text-body font-medium">{m.name} <span className="font-normal text-muted-foreground">v{m.version}</span></span>
                    <Badge variant={m.status === "active" ? "onTrack" : m.status === "draft" ? "info" : "dashed"}>{m.status === "active" ? "Active" : m.status === "draft" ? "Draft" : "Retired"}</Badge>
                    {m.isDefault && <Badge variant="neutral">Default</Badge>}
                    {m.isDemo && <Badge variant="dashed">Demo data</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Model details" className="space-y-6 lg:col-span-3">
            {open ? <ModelEditor key={open} id={open} models={q.data} canConfigure={canConfigure} onOpen={setOpen} /> : <p className="text-label text-muted-foreground">Choose a model to see what it measures, change it, and try it with the what-if calculator.</p>}
          </section>
        </div>
      )}
    </>
  );
}

function NewModel({ onDone, onCreated }: { onDone: () => void; onCreated: (id: string) => void }) {
  const client = useQueryClient();
  const templates = useQuery({ queryKey: ["scoring-templates"], queryFn: getTemplates, retry: false });
  const [key, setKey] = useState("model_employee");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: createModel,
    onSuccess: (m) => { void client.invalidateQueries({ queryKey: ["scoring-models"] }); onCreated(m.id); },
    onError: (e) => setError(problemText(e)),
  });
  return (
    <Card lift={false} className="mb-6">
      <CardHeader><CardTitle>New model</CardTitle><CardDescription>Start from a standard role model. It is created as a draft you can change before you use it.</CardDescription></CardHeader>
      <CardContent>
        <form noValidate aria-label="New model" className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); setError(null); create.mutate({ templateKey: key, ...(name.trim() ? { name: name.trim() } : {}) }); }}>
          {error && <div className="sm:col-span-2"><FormAlert>{error}</FormAlert></div>}
          <SelectField label="Start from" value={key} onChange={(e) => setKey(e.target.value)}>
            {(templates.data ?? []).map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
          </SelectField>
          <FormField label="Name (optional)" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <div className="flex gap-2 sm:col-span-2"><Button type="submit" disabled={create.isPending}>Create model</Button><Button type="button" variant="ghost" onClick={onDone}>Cancel</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

function ModelEditor({ id, models, canConfigure, onOpen }: { id: string; models: ModelView[]; canConfigure: boolean; onOpen: (id: string) => void }) {
  const client = useQueryClient();
  const m = models.find((x) => x.id === id)!;
  const structure = useQuery({ queryKey: ["structure"], queryFn: getStructure, enabled: canConfigure, retry: false });
  const [weights, setWeights] = useState<Record<string, string>>(() => Object.fromEntries(m.components.map((c) => [c.key, String(c.weight)])));
  const [designation, setDesignation] = useState(m.designation?.id ?? "");
  const [family, setFamily] = useState(m.roleFamily?.id ?? "");
  const [isDefault, setIsDefault] = useState(m.isDefault);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const total = m.components.reduce((n, c) => n + (Number(weights[c.key]) || 0), 0);
  const run = useMutation({
    mutationFn: (v: { fn: () => Promise<ModelView>; done: string }) => v.fn().then((r) => ({ r, done: v.done })),
    onSuccess: ({ r, done }) => { setProblem(null); setNotice(done); void client.invalidateQueries({ queryKey: ["scoring-models"] }); if (r.id !== id) onOpen(r.id); },
    onError: (e) => { setNotice(null); setProblem(problemText(e)); },
  });
  const editable = canConfigure && m.status !== "retired";
  const save = () => {
    const comps = m.components.map((c) => ({ key: c.key, label: c.label, weight: Number(weights[c.key]), providerKey: c.providerKey, minSample: c.minSample, config: c.config }));
    if (comps.some((c) => !Number.isFinite(c.weight) || c.weight < 0)) return setProblem("Every weight must be a number, 0 or more");
    run.mutate({ fn: () => updateModel(id, { components: comps, designationId: designation || null, roleFamilyId: family || null, isDefault }), done: m.status === "draft" ? "Draft saved." : "A new draft version was started. Activate it when you are ready." });
  };
  return (
    <div className="space-y-6">
      <Card lift={false}>
        <CardHeader>
          <CardTitle>{m.name} <span className="text-muted-foreground">v{m.version}</span></CardTitle>
          <CardDescription>{m.status === "active" ? "In use." : m.status === "draft" ? "A draft: not used for any score until you activate it." : "Retired: kept because scores were calculated with it."} Minimum data to give a score: {Math.round(m.minWeightCoverage * 100)}% of the weight.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {notice && <FormNotice>{notice}</FormNotice>}
          {problem && <FormAlert>{problem}</FormAlert>}
          <table className="w-full text-label">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1 font-medium">Part</th><th className="py-1 font-medium">Measures</th><th className="py-1 text-right font-medium">Weight</th></tr></thead>
            <tbody>
              {m.components.map((c) => (
                <tr key={c.key} className="border-t">
                  <td className="py-2 pr-2 font-medium">{c.label}</td>
                  <td className="py-2 pr-2 text-muted-foreground"><code>{c.providerKey}</code></td>
                  <td className="py-2 text-right">
                    {editable ? <input aria-label={`Weight of ${c.label}`} type="number" inputMode="decimal" value={weights[c.key] ?? ""} onChange={(e) => setWeights((w) => ({ ...w, [c.key]: e.target.value }))} className="h-9 w-20 rounded-lg border border-input bg-card px-2 text-right tabular-nums" /> : <span className="tabular-nums">{c.weight}</span>}
                  </td>
                </tr>
              ))}
              <tr className="border-t font-semibold"><td className="py-2" colSpan={2}>Total</td><td className={`py-2 text-right tabular-nums ${Math.abs(total - 100) > 1e-9 ? "text-off-track-ink" : ""}`}>{Math.round(total * 100) / 100} of 100</td></tr>
            </tbody>
          </table>
          {Math.abs(total - 100) > 1e-9 && editable && <p className="text-caption text-off-track-ink">The weights must add up to exactly 100 before the model can be activated.</p>}
          {m.problems.length > 0 && <ul className="list-disc pl-5 text-caption text-muted-foreground">{m.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          {editable && (
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField label="Used for people with this designation" value={designation} onChange={(e) => setDesignation(e.target.value)}>
                <option value="">Any</option>
                {(structure.data?.designations ?? []).filter((d) => !d.archived).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </SelectField>
              <SelectField label="Or in this role family" value={family} onChange={(e) => setFamily(e.target.value)}>
                <option value="">Any</option>
                {(structure.data?.roleFamilies ?? []).filter((f) => !f.archived).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </SelectField>
              <label className="flex items-center gap-2 text-label sm:col-span-2"><input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> The default model, for people no other model applies to</label>
            </div>
          )}
          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={run.isPending} onClick={save}>{m.status === "draft" ? "Save the draft" : "Start a new version"}</Button>
              {m.status === "draft" && <Button size="sm" disabled={run.isPending} onClick={() => run.mutate({ fn: () => activateModel(id), done: "Activated. The earlier version is retired and keeps its old scores." })}>Activate</Button>}
            </div>
          )}
        </CardContent>
      </Card>
      {canConfigure && <WhatIf model={m} />}
    </div>
  );
}

function WhatIf({ model }: { model: ModelView }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [closed, setClosed] = useState(true);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: previewModel,
    onSuccess: (r) => { setResult(r); setErr(null); },
    onError: (e) => setErr(problemText(e)),
  });
  function go() {
    const v: Record<string, number | null> = {};
    for (const c of model.components) {
      const raw = values[c.key];
      if (raw === undefined || raw.trim() === "") v[c.key] = null;
      else {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || n > 100) return setErr(`The value for "${c.label}" must be a number from 0 to 100, or left empty for no data`);
        v[c.key] = n;
      }
    }
    setErr(null);
    run.mutate({ modelId: model.id, values: v, periodClosed: closed });
  }
  return (
    <Card lift={false}>
      <CardHeader><CardTitle>What-if calculator</CardTitle><CardDescription>Type a score from 0 to 100 for each part, or leave it empty for “no data”. Nothing is saved.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <form noValidate aria-label="What-if calculator" className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); go(); }}>
          {err && <div className="sm:col-span-2"><FormAlert>{err}</FormAlert></div>}
          {model.components.map((c) => (
            <FormField key={c.key} label={`${c.label} (weight ${c.weight})`} type="number" inputMode="decimal" value={values[c.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [c.key]: e.target.value }))} />
          ))}
          <label className="flex items-center gap-2 text-label sm:col-span-2"><input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /> The period is closed (otherwise a score is provisional)</label>
          <div className="sm:col-span-2"><Button type="submit" size="sm" disabled={run.isPending}>Calculate</Button></div>
        </form>
        {result && <Result r={result} />}
      </CardContent>
    </Card>
  );
}

function Result({ r }: { r: PreviewResult }) {
  return (
    <div role="status" aria-label="Result" className="space-y-3 rounded-lg border bg-muted/30 p-4">
      <p className="flex flex-wrap items-baseline gap-3">
        <span className="text-hero font-bold tabular-nums">{r.total === null ? "No score" : r.total.toFixed(1)}</span>
        <Badge variant={r.status === "final" ? "onTrack" : r.status === "provisional" ? "atRisk" : "dashed"}>{STATUS_WORD[r.status]}</Badge>
        {r.explanation.band && <Badge variant="neutral">{r.explanation.band}</Badge>}
      </p>
      <p className="text-label"><strong>How:</strong> {r.explanation.formula}</p>
      <p className="text-label text-muted-foreground">{Math.round(r.weightCoverage * 100)}% of the weight has data · confidence {r.explanation.confidence.label} ({Math.round(r.confidence * 100)}%)</p>
      {r.explanation.reasons.length > 0 && <ul className="list-disc pl-5 text-label">{r.explanation.reasons.map((x) => <li key={x}>{x}</li>)}</ul>}
      <ul className="divide-y rounded-lg border bg-card text-label">
        {r.components.map((c) => (
          <li key={c.key} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <span className="min-w-0 flex-1 font-medium">{c.label}</span>
            {c.state === "ok" ? <span className="tabular-nums">{c.score?.toFixed(1)} × {c.effectiveWeight.toFixed(2)} = {c.points?.toFixed(1)}</span> : <Badge variant="dashed">{STATE_WORD[c.state]}</Badge>}
          </li>
        ))}
      </ul>
    </div>
  );
}
