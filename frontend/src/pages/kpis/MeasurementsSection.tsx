import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { FormAlert, FormField, FormNotice } from "@/components/common/FormField";
import { SelectField } from "@/components/common/SelectField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { problemText } from "@/lib/authForm";
import { timeAgo } from "@/lib/format";
import { getHistory, getSubjects, recordMeasurement, STATUS_LABEL, subjectParam, type HistoryView, type KpiDetail, type PeriodView, type SeriesStatus, type SubjectView } from "@/services/kpi";
import { StatusBadge } from "./kpiUi";

const W = 560;
const H = 180;
const PAD = { l: 44, r: 12, t: 12, b: 28 };

/** The trend chart. A missing period is a GAP (the line breaks, a hollow mark sits on the axis): never a zero. */
function TrendChart({ h }: { h: HistoryView }) {
  const periods = h.periods.filter((p) => p.state !== "not_expected");
  const values = periods.flatMap((p) => (p.value === null ? [] : [p.value]));
  const extra = [...h.lines.map((l) => l.value), ...(h.target ? [h.target.targetValue, ...(h.target.targetMax !== null ? [h.target.targetMax] : [])] : [])];
  const all = [...values, ...extra];
  if (periods.length === 0) return null;
  const lo = Math.min(0, ...all);
  const hi = Math.max(1, ...all) * 1.08;
  const x = (i: number): number => PAD.l + (periods.length === 1 ? (W - PAD.l - PAD.r) / 2 : (i / (periods.length - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number): number => PAD.t + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD.t - PAD.b);
  const segments: string[] = [];
  let cur = "";
  periods.forEach((p, i) => {
    if (p.value === null) {
      if (cur) segments.push(cur);
      cur = "";
    } else cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
  });
  if (cur) segments.push(cur);
  const unit = h.kpi.unit ? ` ${h.kpi.unit}` : "";
  const desc = `${h.kpi.name} for ${h.subject.name}: ${periods.map((p) => `${p.label} ${p.state === "missing" ? "missing" : p.value === null ? "not yet" : p.value + unit}`).join(", ")}.`;
  const tone = (level: string): string => (level === "critical" ? "text-off-track-ink" : level === "warning" ? "text-at-risk-ink" : "text-on-track-ink");
  return (
    <svg role="img" aria-label={desc} viewBox={`0 0 ${W} ${H}`} className="w-full">
      <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} className="stroke-border" />
      {[lo, (lo + hi) / 2, hi].map((v, i) => (
        <g key={i}>
          <line x1={PAD.l} y1={y(v)} x2={W - PAD.r} y2={y(v)} className="stroke-border" strokeOpacity={0.5} />
          <text x={PAD.l - 6} y={y(v) + 3} textAnchor="end" fontSize="10" className="fill-muted-foreground">{Math.round(v * 10) / 10}</text>
        </g>
      ))}
      {h.target && (
        <g className="text-primary-ink">
          <line x1={PAD.l} y1={y(h.target.targetValue)} x2={W - PAD.r} y2={y(h.target.targetValue)} stroke="currentColor" strokeDasharray="2 3" />
          <text x={W - PAD.r} y={y(h.target.targetValue) - 3} textAnchor="end" fontSize="10" fill="currentColor">Target {h.target.targetValue}</text>
        </g>
      )}
      {h.lines.map((l) => (
        <g key={`${l.level}-${l.value}`} className={tone(l.level)}>
          <line x1={PAD.l} y1={y(l.value)} x2={W - PAD.r} y2={y(l.value)} stroke="currentColor" strokeDasharray="6 4" />
          <text x={PAD.l + 2} y={y(l.value) - 3} fontSize="10" fill="currentColor">{l.level} {l.value}</text>
        </g>
      ))}
      <g className="text-primary-ink">
        {segments.map((d, i) => <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth={2} />)}
        {periods.map((p, i) => (p.value === null ? null : <circle key={p.start} cx={x(i)} cy={y(p.value)} r={3.5} fill="currentColor"><title>{`${p.label}: ${p.value}${unit}`}</title></circle>))}
      </g>
      {periods.map((p, i) => (p.state === "missing" ? (
        <g key={p.start}>
          <circle cx={x(i)} cy={H - PAD.b} r={4} className="fill-background stroke-off-track-ink" strokeWidth={1.5}><title>{`${p.label}: missing`}</title></circle>
        </g>
      ) : null))}
      {periods.map((p, i) => (i === 0 || i === periods.length - 1 || periods.length <= 7 ? <text key={p.start} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" className="fill-muted-foreground">{p.label.replace(/^Week of /, "")}</text> : null))}
    </svg>
  );
}

const stateText = (p: PeriodView): string => (p.state === "recorded" ? String(p.value) : p.state === "missing" ? "Missing" : p.state === "open" ? "Not yet recorded" : "Before the KPI began");

/** One KPI for one subject: the trend with its gaps, every period, who recorded what and why it changed, and the form to record or correct. */
export function MeasurementsSection({ k }: { k: KpiDetail }) {
  const client = useQueryClient();
  const subjects = useQuery({ queryKey: ["kpi", k.id, "subjects"], queryFn: () => getSubjects(k.id), retry: false });
  const [picked, setPicked] = useState<string | null>(null);
  const list = subjects.data ?? [];
  const chosen = picked ?? (list.length > 0 ? subjectParam(list.find((s) => s.canRecord)?.subject ?? list[0]!.subject) : null);
  const hist = useQuery({ queryKey: ["kpi-history", k.id, chosen], queryFn: () => getHistory(k.id, chosen!), enabled: chosen !== null, retry: false });
  const [table, setTable] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  if (subjects.isPending || (chosen !== null && hist.isPending)) return <Skeleton className="h-48 w-full" aria-busy="true" />;
  if (subjects.isError) return <p className="text-label text-off-track-ink">The measurements could not be loaded.</p>;
  if (chosen === null || !hist.data) {
    return (
      <section aria-label="Measurements" className="space-y-2">
        <h3 className="text-label font-semibold">Measurements</h3>
        <p className="text-label text-muted-foreground">Nothing to show yet. Give the KPI to someone, then record their values here.</p>
      </section>
    );
  }
  const h = hist.data;
  const unit = h.kpi.unit ? ` ${h.kpi.unit}` : "";
  const shown = h.periods.filter((p) => p.state !== "not_expected");
  return (
    <section aria-label="Measurements" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-label font-semibold">Measurements</h3>
        {list.length > 1 && (
          <select aria-label="Whose values" value={chosen} onChange={(e) => setPicked(e.target.value)} className="h-9 rounded-lg border border-input bg-card px-2 text-label">
            {list.map((s) => <option key={subjectParam(s.subject)} value={subjectParam(s.subject)}>{s.subject.name}{s.missing > 0 ? ` (${s.missing} missing)` : ""}</option>)}
          </select>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-2 text-label text-muted-foreground">
        <strong className="text-foreground">{h.subject.name}</strong>
        <StatusBadge status={h.status} />
        {h.target && <span>target {h.target.targetValue}{h.target.targetMax !== null ? ` to ${h.target.targetMax}` : ""}{unit}</span>}
        {h.expected > 0 && <span>· {h.present} of {h.expected} periods have a value{h.missingCount > 0 ? `, ` : ""}{h.missingCount > 0 && <strong className="text-off-track-ink">{h.missingCount} missing</strong>}</span>}
      </p>
      <div>
        <div className="mb-1 flex justify-end"><Button size="sm" variant="ghost" aria-pressed={table} onClick={() => setTable((v) => !v)}>{table ? "View as chart" : "View as table"}</Button></div>
        {table ? (
          <table className="w-full text-label">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1 font-medium">Period</th><th className="py-1 text-right font-medium">Value</th></tr></thead>
            <tbody>{shown.map((p) => <tr key={p.start} className="border-t"><td className="py-1">{p.label}</td><td className="py-1 text-right tabular-nums">{stateText(p)}</td></tr>)}</tbody>
          </table>
        ) : <TrendChart h={h} />}
      </div>
      <ol aria-label="Periods" className="divide-y rounded-lg border">
        {[...shown].reverse().map((p) => (
          <li key={p.start} className="px-3 py-2 text-label">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-28 font-medium">{p.label}</span>
              <span className={p.state === "missing" ? "font-medium text-off-track-ink" : "tabular-nums"}>{p.state === "recorded" ? `${p.value}${unit}` : stateText(p)}</span>
              {p.attainmentPct !== null && <span className="text-muted-foreground">{p.attainmentPct}% of target</span>}
              {p.level && <Badge variant={p.level === "critical" ? "offTrack" : p.level === "warning" ? "atRisk" : "onTrack"}>{STATUS_LABEL[p.level]}</Badge>}
              {p.valueStatus && p.valueStatus !== "recorded" && <Badge variant="dashed">{p.valueStatus}</Badge>}
              {p.corrections > 0 && <button type="button" className="text-caption font-medium text-primary-ink underline" aria-expanded={open === p.start} onClick={() => setOpen(open === p.start ? null : p.start)}>{p.corrections === 1 ? "1 correction" : `${p.corrections} corrections`}</button>}
            </div>
            {open === p.start && (
              <ul className="mt-2 space-y-1 border-l pl-3 text-caption text-muted-foreground">
                {p.rows.map((r) => (
                  <li key={r.id}>
                    <strong className="text-foreground">{r.value}{unit}</strong> {r.current ? "(current)" : "(replaced)"} · {r.recordedBy?.name ?? "Unknown"} · {timeAgo(r.recordedAt)}{r.note ? ` · “${r.note}”` : ""}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      {h.can.record && <RecordForm k={k} h={h} onDone={() => { for (const key of ["kpi-history", "kpi", "kpi-overview", "kpis", "audit", "notifications"]) void client.invalidateQueries({ queryKey: [key] }); }} />}
    </section>
  );
}

function RecordForm({ k, h, onDone }: { k: KpiDetail; h: HistoryView; onDone: () => void }) {
  const choices = [...h.periods].filter((p) => p.state !== "not_expected").reverse();
  const firstPick = (choices.find((p) => p.state === "missing") ?? choices.find((p) => p.state === "open") ?? choices[0])?.start ?? "";
  const [period, setPeriod] = useState(firstPick);
  const [value, setValue] = useState("");
  const [status, setStatus] = useState("recorded");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => { if (!choices.some((c) => c.start === period)) setPeriod(firstPick); }, [choices, firstPick, period]);
  const p = choices.find((c) => c.start === period);
  const current = p?.rows.find((r) => r.current);
  const save = useMutation({
    mutationFn: recordMeasurement.bind(null, k.id),
    onSuccess: () => { setErr(null); setDone(current ? "Correction saved. The earlier value stays in the history." : "Value recorded."); setValue(""); setNote(""); onDone(); },
    onError: (e) => { setDone(null); setErr(problemText(e)); },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const v = Number(value);
    if (value === "" || !Number.isFinite(v)) return setErr("The value must be a number");
    if (current && !note.trim()) return setErr("Say why the value is being corrected");
    setErr(null);
    save.mutate({ subject: { type: h.subject.kind, ...(h.subject.id ? { id: h.subject.id } : {}) }, periodStart: period, value: v, valueStatus: status, ...(note.trim() ? { note: note.trim() } : {}), ...(current ? { supersedes: current.id } : {}) });
  }
  return (
    <form noValidate aria-label={current ? "Correct a value" : "Record a value"} onSubmit={submit} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
      <h4 className="text-label font-semibold sm:col-span-2">{current ? "Correct a value" : "Record a value"} for {h.subject.name}</h4>
      {err && <div className="sm:col-span-2"><FormAlert>{err}</FormAlert></div>}
      {done && <div className="sm:col-span-2"><FormNotice>{done}</FormNotice></div>}
      <SelectField label="Period" value={period} onChange={(e) => setPeriod(e.target.value)}>
        {choices.map((c) => <option key={c.start} value={c.start}>{c.label}{c.state === "missing" ? " (missing)" : c.state === "recorded" ? ` (recorded: ${c.value})` : ""}</option>)}
      </SelectField>
      <FormField label={`Value${h.kpi.unit ? ` (${h.kpi.unit})` : ""}`} type="number" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
      <SelectField label="How sure is it" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="recorded">Recorded</option>
        <option value="estimated">An estimate</option>
        <option value="disputed">Disputed</option>
      </SelectField>
      <FormField label={current ? "Why it is corrected" : "Note (optional)"} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      <div className="sm:col-span-2"><Button type="submit" size="sm" disabled={save.isPending}>{current ? "Save the correction" : "Record"}</Button></div>
    </form>
  );
}

export type { SubjectView, SeriesStatus };
