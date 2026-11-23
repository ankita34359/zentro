import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronRight, Network, Users } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { getTree, initials, type TreeNode } from "@/services/people";

type View = "reporting" | "organization";
const keyOf = (n: TreeNode) => `${n.kind}:${n.id}`;
const VIEW_LABEL: Record<View, string> = { reporting: "Reporting lines", organization: "Departments and teams" };

/**
 * The organization chart: an ARIA tree you can open level by level. Two views of the same people: who reports to whom
 * (primary lines) and department → team → people. Only the first levels are loaded; opening a node asks the server for the
 * next levels, so a few hundred people stay quick. It is one vertical list that works from a phone to a wide screen. Arrow
 * keys move, Right/Left open and close, Enter opens a person's profile.
 */
export function OrgChart({ onOpenPerson, canAdd, onAdd }: { onOpenPerson: (id: string) => void; canAdd: boolean; onAdd: () => void }) {
  const [view, setView] = useState<View>("reporting");
  const q = useQuery({ queryKey: ["tree", view], queryFn: () => getTree({ view, depth: 2 }), retry: false });
  const treeRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState<Record<string, TreeNode[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<string | null>(null);

  // after a change in the profile panel the tree is fetched again: forget what was opened lazily so it is not stale
  useEffect(() => {
    setLoaded({});
    setOpen({});
  }, [q.dataUpdatedAt]);

  const switchView = (v: View) => {
    setView(v);
    setOpen({});
    setLoaded({});
    setFailed(null);
  };

  async function expand(n: TreeNode) {
    const k = keyOf(n);
    const kids = n.children ?? loaded[k];
    setOpen((o) => ({ ...o, [k]: true }));
    if (kids || n.childCount === 0) return;
    setLoading((l) => ({ ...l, [k]: true }));
    try {
      const t = await getTree({ view, root: n.id, rootKind: n.kind === "team" ? "team" : "department", depth: 2 });
      setLoaded((l) => ({ ...l, [k]: t.nodes[0]?.children ?? [] }));
      setFailed(null);
    } catch {
      setFailed(`The people under ${n.name} could not be loaded. Try again.`);
      setOpen((o) => ({ ...o, [k]: false }));
    } finally {
      setLoading((l) => ({ ...l, [k]: false }));
    }
  }
  const collapse = (n: TreeNode) => setOpen((o) => ({ ...o, [keyOf(n)]: false }));

  const items = () => [...(treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])];
  const focusItem = (el: HTMLElement | undefined) => el?.focus();

  function onKeyDown(e: KeyboardEvent<HTMLElement>, n: TreeNode, hasKids: boolean, isOpen: boolean) {
    const el = e.currentTarget.ownerDocument.activeElement as HTMLElement | null;
    if (!el || el.getAttribute("data-key") !== keyOf(n)) return; // keys bubble from nested items: only the focused one reacts
    const all = items();
    const i = all.indexOf(el);
    switch (e.key) {
      case "ArrowDown":
        focusItem(all[i + 1]);
        break;
      case "ArrowUp":
        focusItem(all[i - 1]);
        break;
      case "Home":
        focusItem(all[0]);
        break;
      case "End":
        focusItem(all[all.length - 1]);
        break;
      case "ArrowRight":
        if (hasKids && !isOpen) void expand(n);
        else if (isOpen) focusItem(all[i + 1]);
        break;
      case "ArrowLeft":
        if (isOpen) collapse(n);
        else focusItem(el.parentElement?.closest<HTMLElement>('[role="treeitem"]') ?? undefined);
        break;
      case "Enter":
      case " ":
        if (n.kind === "person") onOpenPerson(n.id);
        else if (hasKids) (isOpen ? collapse : expand)(n);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  function renderNode(n: TreeNode, level: number, first: boolean): ReactNode {
    const k = keyOf(n);
    const kids = n.children ?? loaded[k] ?? null;
    const hasKids = n.childCount > 0;
    const isOpen = !!open[k] || (level === 1 && open[k] === undefined && n.children !== null && hasKids);
    const Icon = n.kind === "department" ? Building2 : n.kind === "team" ? Users : null;
    return (
      <li
        key={k}
        role="treeitem"
        data-key={k}
        aria-level={level}
        aria-label={[n.name, n.subtitle, n.detail].filter(Boolean).join(", ")}
        aria-expanded={hasKids ? isOpen : undefined}
        tabIndex={first ? 0 : -1}
        onKeyDown={(e) => onKeyDown(e, n, hasKids, isOpen)}
        className="rounded-lg outline-none focus-visible:[&>div]:ring-2 focus-visible:[&>div]:ring-ring"
      >
        <div className={cn("flex items-center gap-2 rounded-lg border bg-card px-2.5 py-2 shadow-xs", n.kind !== "person" && "bg-muted/50")}>
          {hasKids ? (
            <button
              type="button"
              tabIndex={-1}
              aria-label={`${isOpen ? "Collapse" : "Expand"} ${n.name}`}
              onClick={() => (isOpen ? collapse(n) : void expand(n))}
              className="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-muted"
            >
              <ChevronRight aria-hidden="true" className={cn("size-4 transition-transform duration-[var(--duration-fast)]", isOpen && "rotate-90")} />
            </button>
          ) : (
            <span className="size-7 shrink-0" aria-hidden="true" />
          )}
          <span aria-hidden="true" className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-caption font-semibold", n.kind === "person" ? "bg-gradient-brand-strong text-on-gradient" : "bg-primary-soft text-primary-soft-foreground")}>
            {Icon ? <Icon className="size-4" /> : initials(n.name)}
          </span>
          <button
            type="button"
            tabIndex={-1}
            onClick={() => (n.kind === "person" ? onOpenPerson(n.id) : hasKids ? (isOpen ? collapse(n) : void expand(n)) : undefined)}
            className="min-w-0 flex-1 rounded-md text-left"
            aria-label={n.kind === "person" ? `Open profile of ${n.name}` : `${n.name}${n.subtitle ? `, ${n.subtitle}` : ""}`}
          >
            <span className="block truncate text-body font-medium">{n.name}</span>
            {(n.subtitle || n.detail) && <span className="block truncate text-caption text-muted-foreground">{[n.subtitle, n.detail].filter(Boolean).join(" · ")}</span>}
          </button>
          {n.isDemo && <Badge variant="dashed">Demo</Badge>}
          {hasKids && (
            <Badge variant="neutral" title={n.kind === "person" ? "People who report directly to them" : "Items inside"}>
              {n.childCount}
            </Badge>
          )}
        </div>
        {hasKids && isOpen && (
          <ul role="group" className="ml-[1.1rem] mt-1.5 space-y-1.5 border-l-2 border-border pl-3 sm:ml-5 sm:pl-4">
            {loading[k] && <li className="py-1" aria-busy="true"><Skeleton className="h-10 w-full" /></li>}
            {kids?.map((c) => renderNode(c, level + 1, false))}
          </ul>
        )}
      </li>
    );
  }

  const toggle = (
    <div role="group" aria-label="Chart view" className="inline-flex rounded-lg border bg-muted p-0.5">
      {(Object.keys(VIEW_LABEL) as View[]).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => switchView(v)}
          className={cn("rounded-md px-3 py-1.5 text-label font-medium transition-colors", view === v ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
        >
          {VIEW_LABEL[v]}
        </button>
      ))}
    </div>
  );

  let body;
  if (q.isPending) {
    body = (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-11/12" />
        <Skeleton className="h-12 w-10/12" />
      </div>
    );
  } else if (q.isError) {
    body = <ErrorState title="The chart could not be loaded" error={q.error} onRetry={() => void q.refetch()} />;
  } else if (q.data.nodes.length === 0) {
    body = (
      <EmptyState
        illustration="org"
        title={view === "reporting" ? "No one is in the chart yet" : "No departments yet"}
        action={canAdd ? <Button size="sm" onClick={onAdd}>Add a person</Button> : undefined}
      >
        {view === "reporting" ? "Add people and say who reports to whom, and the chart draws itself." : "Create departments and teams in Settings → Organization structure, then place people in them."}
      </EmptyState>
    );
  } else {
    body = (
      <>
        {q.data.partial && <p className="mb-3 rounded-lg border bg-muted px-3 py-2.5 text-label text-muted-foreground">You see the people in your scope. Someone with wider access sees the whole chart.</p>}
        {failed && <p role="alert" className="mb-3 rounded-lg border border-off-track/30 bg-off-track-soft px-3 py-2.5 text-label text-off-track-ink">{failed}</p>}
        <ul ref={treeRef} role="tree" aria-label={VIEW_LABEL[view]} className="space-y-1.5">
          {q.data.nodes.map((n, i) => renderNode(n, 1, i === 0))}
        </ul>
        <p className="mt-4 text-caption text-muted-foreground">
          <Network aria-hidden="true" className="mr-1 inline size-3.5" />
          {view === "reporting" ? "Follows primary reporting lines. Secondary, dotted and project lines are in each person's profile." : "Heads and leads are shown next to their department or team."} Use the arrow keys to move, Right and Left to open and close, Enter to open a profile.
        </p>
      </>
    );
  }
  return (
    <section aria-label="Organization chart" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">{toggle}</div>
      {body}
    </section>
  );
}
