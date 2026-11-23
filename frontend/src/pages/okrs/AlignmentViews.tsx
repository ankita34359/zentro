import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { getGaps, getTree, LEVEL_LABEL, pctText, type GapItem, type TreeNode } from "@/services/okr";
import { HealthBadge, LifecycleBadge } from "./okrUi";

/** One objective in the contribution tree, and the ones that contribute to it below. Collapsible; the toggle is a real button. */
function Node({ n, depth, onOpen }: { n: TreeNode; depth: number; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(depth < 2);
  const hasKids = n.children.length > 0;
  return (
    <li role="treeitem" aria-expanded={hasKids ? open : undefined} aria-level={depth + 1} aria-selected={false}>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2">
        {hasKids ? (
          <button type="button" aria-label={`${open ? "Collapse" : "Expand"} ${n.title}`} onClick={() => setOpen(!open)} className="rounded p-1 hover:bg-muted">
            <ChevronRight aria-hidden="true" className={cn("size-4 transition-transform duration-[var(--duration-fast)]", open && "rotate-90")} />
          </button>
        ) : (
          <span aria-hidden="true" className="inline-block size-6" />
        )}
        <button type="button" onClick={() => onOpen(n.id)} aria-label={`Open objective: ${n.title}`} className="min-w-0 flex-1 text-left text-body font-medium hover:text-primary-ink">
          {n.title}
        </button>
        <Badge variant="neutral">{LEVEL_LABEL[n.level] ?? n.level}</Badge>
        <LifecycleBadge lifecycle={n.lifecycle} />
        <HealthBadge health={n.health} />
        <span className="text-label tabular-nums text-muted-foreground">{pctText(n.attainmentPct)}</span>
        {n.contributionPct !== null && <span className="text-caption text-muted-foreground">adds {n.contributionPct} points to its parent</span>}
        {n.unaligned && <Badge variant="atRisk">Not aligned</Badge>}
        {n.hiddenChildren > 0 && <span className="text-caption text-muted-foreground">+{n.hiddenChildren} you cannot see</span>}
      </div>
      {hasKids && open && (
        <ul role="group" className="ml-4 mt-2 space-y-2 border-l pl-3 sm:ml-6 sm:pl-4">
          {n.children.map((c) => <Node key={c.id} n={c} depth={depth + 1} onOpen={onOpen} />)}
        </ul>
      )}
    </li>
  );
}

/** The alignment tree: company at the top, then departments, teams and people, each with its health and what it adds to the level above. */
export function AlignmentTree({ onOpen }: { onOpen: (id: string) => void }) {
  const [closed, setClosed] = useState(false);
  const q = useQuery({ queryKey: ["objectives", "tree", closed], queryFn: () => getTree(closed), retry: false });
  if (q.isPending) return <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  if (q.isError) return <ErrorState title="The alignment tree could not be loaded" error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <section aria-label="Alignment tree" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-label text-muted-foreground">Each objective sits under the one it contributes to. “Adds” is its attainment times its share of the parent’s weight.</p>
        <label className="flex items-center gap-2 text-label"><input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /> Include completed and cancelled</label>
      </div>
      {q.data.roots.length === 0 ? (
        <EmptyState illustration="org" title="Nothing to align yet">Create company objectives, then link department and team objectives to them from each objective’s panel.</EmptyState>
      ) : (
        <ul role="tree" aria-label="Objectives by alignment" className="space-y-2">
          {q.data.roots.map((r) => <Node key={r.id} n={r} depth={0} onOpen={onOpen} />)}
        </ul>
      )}
    </section>
  );
}

function Group({ title, hint, items, onOpen }: { title: string; hint: string; items: GapItem[]; onOpen: (id: string) => void }) {
  return (
    <section aria-label={title} className="space-y-2 rounded-xl border bg-card p-4">
      <h3 className="flex items-center justify-between gap-2 text-label font-semibold">
        <span>{title}</span>
        <Badge variant={items.length === 0 ? "onTrack" : "atRisk"}>{items.length === 0 ? "None" : items.length}</Badge>
      </h3>
      <p className="text-caption text-muted-foreground">{hint}</p>
      {items.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {items.map((i) => (
            <li key={i.id} className="px-3 py-2">
              <button type="button" onClick={() => onOpen(i.id)} aria-label={`Open objective: ${i.title}`} className="block w-full text-left">
                <span className="text-body font-medium hover:text-primary-ink">{i.title}</span> <span className="text-caption text-muted-foreground">({LEVEL_LABEL[i.level] ?? i.level})</span>
                <span className="block text-caption text-muted-foreground">{i.reason}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Where alignment is missing, from the rules (no guessing): each line says why it is listed. */
export function GapsReport({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useQuery({ queryKey: ["objectives", "gaps"], queryFn: getGaps, retry: false });
  if (q.isPending) return <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;
  if (q.isError) return <ErrorState title="The report could not be loaded" error={q.error} onRetry={() => void q.refetch()} />;
  const g = q.data;
  return (
    <section aria-label="Alignment gaps" className="grid gap-4 lg:grid-cols-2">
      <Group title="Not aligned to anything" hint="Department, team and personal objectives that contribute to no higher objective." items={g.unaligned} onOpen={onOpen} />
      <Group title="Not broken down" hint="Active company and department objectives that nothing below contributes to." items={g.notBrokenDown} onOpen={onOpen} />
      <Group title="Cannot be measured" hint="Active objectives with no key results." items={g.unmeasurable} onOpen={onOpen} />
      <Group title="No data" hint="Time has passed but no key result has a recorded value." items={g.noData} onOpen={onOpen} />
      <Group title="Behind pace" hint="At risk or delayed, with the numbers behind it." items={g.behindPace} onOpen={onOpen} />
      <Group title="Past their end date" hint="Active objectives whose end date has passed." items={g.overdue} onOpen={onOpen} />
      <section aria-label="Work with no objective" className="space-y-1 rounded-xl border bg-card p-4">
        <h3 className="flex items-center justify-between gap-2 text-label font-semibold">
          <span>Tasks that support no objective</span>
          <Badge variant={g.unalignedTasks === 0 ? "onTrack" : "atRisk"}>{g.unalignedTasks === 0 ? "None" : g.unalignedTasks}</Badge>
        </h3>
        <p className="text-caption text-muted-foreground">Open tasks you can see that are not linked to an objective or key result.</p>
        {g.unalignedTasks > 0 && <Button asChild size="sm" variant="outline"><a href="/my-work/tasks">See them in All tasks</a></Button>}
      </section>
    </section>
  );
}
