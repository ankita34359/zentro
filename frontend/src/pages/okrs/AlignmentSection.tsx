import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FormField } from "@/components/common/FormField";
import { SelectField } from "@/components/common/SelectField";
import { Button } from "@/components/ui/button";
import { assignObjective, clearParent, getAlignment, LEVEL_LABEL, listObjectives, pctText, setParent, unassignObjective, type ObjectiveDetail } from "@/services/okr";
import { listPeople } from "@/services/people";
import { getStructure } from "@/services/structure";
import { HealthBadge } from "./okrUi";

type Act = (fn: () => Promise<unknown>, done: string) => void;
const RANK: Record<string, number> = { company: 0, department: 1, team: 2, individual: 3 };

/** What this objective contributes to, what contributes to it, and who else works on it (stage 3.2). */
export function AlignmentSection({ o, busy, act }: { o: ObjectiveDetail; busy: boolean; act: Act }) {
  const q = useQuery({ queryKey: ["objective", o.id, "alignment"], queryFn: () => getAlignment(o.id), retry: false });
  const canAssign = q.data?.can.assign === true;
  const candidates = useQuery({ queryKey: ["objectives", { parentPicker: true }], queryFn: () => listObjectives({}), enabled: canAssign, retry: false });
  const people = useQuery({ queryKey: ["people", "all"], queryFn: () => listPeople({ limit: 500 }), enabled: canAssign, retry: false });
  const structure = useQuery({ queryKey: ["structure"], queryFn: getStructure, enabled: canAssign, retry: false });
  const [parent, setParentId] = useState("");
  const [weight, setWeight] = useState("1");
  const [who, setWho] = useState("");
  const [role, setRole] = useState("contributor");
  const [err, setErr] = useState<string | null>(null);
  if (q.isPending) return <p className="text-label text-muted-foreground" aria-busy="true">Loading alignment…</p>;
  if (q.isError) return <p className="text-label text-off-track-ink">The alignment could not be loaded.</p>;
  const a = q.data;
  const higher = (candidates.data ?? []).filter((c) => (RANK[c.level] ?? 9) < (RANK[o.level] ?? 0) && c.lifecycle !== "cancelled");
  return (
    <section aria-label="Alignment" className="space-y-4">
      <h3 className="text-label font-semibold">Alignment</h3>
      <div className="space-y-2">
        <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">Contributes to</p>
        {a.parent ? (
          <p className="flex flex-wrap items-center gap-2 text-body">
            {a.parent.objective ? (
              <>
                <span className="font-medium">{a.parent.objective.title}</span>
                <HealthBadge health={a.parent.objective.health} />
                <span className="text-label text-muted-foreground">{pctText(a.parent.objective.attainmentPct)} · weight {a.parent.weight}</span>
              </>
            ) : (
              <span className="text-muted-foreground">An objective that is not shared with you</span>
            )}
            {canAssign && <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => clearParent(o.id), "Taken out of the alignment.")}>Remove link</Button>}
          </p>
        ) : (
          <p className="text-label text-muted-foreground">{o.level === "company" ? "A company objective sits at the top." : "It does not contribute to any higher objective yet."}</p>
        )}
        {canAssign && o.level !== "company" && (
          <form
            noValidate
            aria-label="Align to a higher objective"
            className="grid gap-2 sm:grid-cols-[1fr_6rem_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              const w = Number(weight);
              if (!parent) return setErr("Choose the objective it contributes to");
              if (!Number.isFinite(w) || w <= 0) return setErr("The weight must be more than 0");
              setErr(null);
              act(() => setParent(o.id, { parentId: parent, weight: w }), "Aligned.");
              setParentId("");
            }}
          >
            {err && <p role="alert" className="text-caption text-off-track-ink sm:col-span-3">{err}</p>}
            <SelectField label={a.parent ? "Change to" : "Align to"} value={parent} onChange={(e) => setParentId(e.target.value)}>
              <option value="">Choose a higher objective</option>
              {higher.map((c) => <option key={c.id} value={c.id}>{LEVEL_LABEL[c.level]} · {c.title}</option>)}
            </SelectField>
            <FormField label="Weight" type="number" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
            <Button type="submit" size="sm" variant="outline" disabled={busy}>Save link</Button>
          </form>
        )}
      </div>
      <div className="space-y-2">
        <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">Contributing objectives</p>
        {a.children.length === 0 ? <p className="text-label text-muted-foreground">Nothing contributes to it yet.</p> : (
          <ul className="divide-y rounded-lg border">
            {a.children.map((c) => (
              <li key={c.relationshipId} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 text-body">{c.objective.title}</span>
                <HealthBadge health={c.objective.health} />
                <span className="text-label tabular-nums text-muted-foreground">{pctText(c.objective.attainmentPct)} · weight {c.weight}</span>
              </li>
            ))}
          </ul>
        )}
        {a.hiddenChildren > 0 && <p className="text-caption text-muted-foreground">{a.hiddenChildren} more contribute to it that you cannot see.</p>}
      </div>
      <div className="space-y-2">
        <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">Also works on it</p>
        {a.assignments.length === 0 ? <p className="text-label text-muted-foreground">Nobody else has been added.</p> : (
          <ul className="divide-y rounded-lg border">
            {a.assignments.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="text-body">{x.name} <span className="text-caption text-muted-foreground">{x.kind} · {x.role}</span></span>
                {canAssign && <Button size="sm" variant="ghost" disabled={busy} aria-label={`Take ${x.name} off this objective`} onClick={() => act(() => unassignObjective(o.id, x.id), `${x.name} is off the objective.`)}>Remove</Button>}
              </li>
            ))}
          </ul>
        )}
        {canAssign && (
          <form
            noValidate
            aria-label="Add a contributor"
            className="grid gap-2 sm:grid-cols-[1fr_9rem_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (!who) return;
              const [kind, id] = who.split(":") as ["person" | "team" | "department", string];
              act(() => assignObjective(o.id, { ...(kind === "person" ? { assigneeId: id } : kind === "team" ? { teamId: id } : { departmentId: id }), role }), "Added.");
              setWho("");
            }}
          >
            <SelectField label="Add a person, team or department" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">Choose</option>
              <optgroup label="Departments">{(structure.data?.departments ?? []).filter((d) => !d.archived).map((d) => <option key={d.id} value={`department:${d.id}`}>{d.name}</option>)}</optgroup>
              <optgroup label="Teams">{(structure.data?.teams ?? []).filter((t) => !t.archived).map((t) => <option key={t.id} value={`team:${t.id}`}>{t.name}</option>)}</optgroup>
              <optgroup label="People">{(people.data?.people ?? []).filter((p) => !p.archived).map((p) => <option key={p.id} value={`person:${p.id}`}>{p.displayName}</option>)}</optgroup>
            </SelectField>
            <SelectField label="As" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="contributor">Contributor</option>
              <option value="reviewer">Reviewer</option>
            </SelectField>
            <Button type="submit" size="sm" variant="outline" disabled={busy || !who}>Add</Button>
          </form>
        )}
      </div>
    </section>
  );
}
