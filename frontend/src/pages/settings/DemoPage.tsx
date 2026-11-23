import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, FlaskConical, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useSwitchedSession } from "@/components/common/DemoBanner";
import { ErrorState } from "@/components/common/ErrorState";
import { FormAlert, FormNotice } from "@/components/common/FormField";
import { PageHeader } from "@/components/common/PageHeader";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { problemText } from "@/lib/authForm";
import { ApiError } from "@/services/api";
import { getDemoStatus, getPersonas, loadDemo, removeDemo, viewAs, type Blocker, type Persona } from "@/services/demo";

const LABEL: Record<string, string> = { people: "people", departments: "departments", teams: "teams", designations: "designations", tasks: "tasks" };

/**
 * Settings → Demo data (stage 2.8): load a fictional company as real rows flagged "Demo data", remove exactly those rows,
 * and view the app as one of the demo people (read only) to see the employee, manager and executive views.
 */
export default function DemoPage() {
  const client = useQueryClient();
  const switched = useSwitchedSession();
  const navigate = useNavigate();
  const status = useQuery({ queryKey: ["demo", "status"], queryFn: getDemoStatus, retry: false });
  const loaded = status.data?.loaded === true;
  const personas = useQuery({ queryKey: ["demo", "personas"], queryFn: getPersonas, enabled: loaded, retry: false });
  const [confirm, setConfirm] = useState<null | "load" | "remove">(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => {
    for (const k of ["demo", "structure", "people", "tree", "tasks", "my-work", "overview", "audit", "members"]) void client.invalidateQueries({ queryKey: [k] });
  };
  const load = useMutation({
    mutationFn: loadDemo,
    onSuccess: (d) => { setConfirm(null); setProblem(null); setBlockers([]); setNotice(`Demo data loaded: ${d.counts.people} people, ${d.counts.departments} departments, ${d.counts.teams} teams and ${d.counts.tasks} tasks.`); refresh(); },
    onError: (e) => { setConfirm(null); setNotice(null); setProblem(problemText(e)); },
  });
  const remove = useMutation({
    mutationFn: removeDemo,
    onSuccess: () => { setConfirm(null); setProblem(null); setBlockers([]); setNotice("Demo data removed. Your own data was not touched."); refresh(); },
    onError: (e) => {
      setConfirm(null);
      setNotice(null);
      setProblem(problemText(e));
      setBlockers(e instanceof ApiError && e.code === "demo_blocked" ? ((e.details as { blockers?: Blocker[] } | undefined)?.blockers ?? []) : []);
    },
  });
  const view = useMutation({
    mutationFn: (id: string) => viewAs(id),
    onSuccess: (r) => { switched(r.me); navigate("/overview"); },
    onError: (e) => setProblem(problemText(e)),
  });

  if (status.isPending) return <PageSkeleton />;
  if (status.isError) return <ErrorState title="Demo data could not be checked" error={status.error} onRetry={() => void status.refetch()} />;
  const s = status.data;
  const groups = groupPersonas(personas.data ?? []);

  return (
    <>
      <PageHeader eyebrow="Settings" title="Demo data" description="A fictional company with about 60 people, departments, teams and a few weeks of tasks, so every page has something real to show. Everything it adds is marked “Demo data” and can be removed in one click." />
      <div className="space-y-6">
        {notice && <FormNotice>{notice}</FormNotice>}
        {problem && <FormAlert>{problem}</FormAlert>}
        {blockers.length > 0 && (
          <Card lift={false}>
            <CardHeader>
              <CardTitle>What stops the removal</CardTitle>
              <CardDescription>Nothing was changed. Fix these, then remove the demo data again.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul aria-label="Blockers" className="list-disc space-y-1 pl-5 text-body">
                {blockers.map((b) => (
                  <li key={b.kind}>{b.message}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <Card lift={false}>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FlaskConical aria-hidden="true" className="size-5" /> Status
              </CardTitle>
              <CardDescription>{loaded ? `Loaded on ${new Date(s.loadedAt!).toLocaleString()}.` : "Not loaded. Your organization shows only your own data."}</CardDescription>
            </div>
            {loaded ? <Badge variant="info">Demo data loaded</Badge> : <Badge variant="neutral">Not loaded</Badge>}
          </CardHeader>
          <CardContent className="space-y-4">
            {loaded && (
              <dl aria-label="What is loaded" className="flex flex-wrap gap-x-8 gap-y-2 text-label">
                {Object.entries(s.counts).map(([k, n]) => (
                  <div key={k}>
                    <dt className="text-muted-foreground">{LABEL[k] ?? k}</dt>
                    <dd className="text-heading font-semibold tabular-nums">{n}</dd>
                  </div>
                ))}
                <div>
                  <dt className="text-muted-foreground">your own people</dt>
                  <dd className="text-heading font-semibold tabular-nums">{s.realPeople}</dd>
                </div>
              </dl>
            )}
            {confirm === "load" && (
              <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
                <p className="text-body">This adds about 60 fictional people and their work to your organization, marked “Demo data”. Your own people and data are not changed, and you can remove it all later.</p>
                <div className="flex gap-2">
                  <Button disabled={load.isPending} onClick={() => load.mutate()}>{load.isPending ? "Loading…" : "Yes, load demo data"}</Button>
                  <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
                </div>
              </div>
            )}
            {confirm === "remove" && (
              <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
                <p className="text-body">This deletes the demo people, departments, teams and tasks. Only rows marked “Demo data” are removed; your own data stays exactly as it is.</p>
                <div className="flex gap-2">
                  <Button disabled={remove.isPending} onClick={() => remove.mutate()}>{remove.isPending ? "Removing…" : "Yes, remove demo data"}</Button>
                  <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
                </div>
              </div>
            )}
            {!confirm && (
              <div className="flex flex-wrap gap-2">
                {loaded ? (
                  <Button variant="outline" onClick={() => { setProblem(null); setNotice(null); setConfirm("remove"); }}>
                    <Trash2 aria-hidden="true" /> Remove demo data…
                  </Button>
                ) : (
                  <Button onClick={() => { setProblem(null); setNotice(null); setConfirm("load"); }}>
                    <FlaskConical aria-hidden="true" /> Load demo data…
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {loaded && (
          <Card lift={false}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye aria-hidden="true" className="size-5" /> View as a demo person
              </CardTitle>
              <CardDescription>See the app exactly as that person sees it, with their permissions. It is read only, lasts up to an hour, and a banner shows who you are viewing as. It is written to the audit log.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {personas.isPending ? <PageSkeleton /> : personas.isError ? <ErrorState title="The demo people could not be loaded" error={personas.error} onRetry={() => void personas.refetch()} /> : groups.map((g) => (
                <section key={g.title} aria-label={g.title}>
                  <h3 className="mb-2 text-label font-semibold">{g.title}</h3>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {g.people.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2">
                        <span className="min-w-0">
                          <span className="block truncate text-body font-medium">{p.name}</span>
                          <span className="block truncate text-caption text-muted-foreground">{[p.designation, p.department].filter(Boolean).join(" · ")}</span>
                        </span>
                        <Button size="sm" variant="outline" disabled={view.isPending} aria-label={`View as ${p.name}`} onClick={() => { setProblem(null); view.mutate(p.id); }}>
                          View as
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

/** A handful of examples of each kind of view, not all sixty people. The server says where each person sits in the tree. */
function groupPersonas(all: Persona[]): { title: string; people: Persona[] }[] {
  const of = (g: Persona["group"], n: number) => all.filter((p) => p.group === g).slice(0, n);
  return [
    { title: "Company leadership", people: of("leadership", 2) },
    { title: "Department heads", people: of("heads", 5) },
    { title: "Managers and team leads", people: of("managers", 6) },
    { title: "Employees", people: of("employees", 6) },
  ].filter((g) => g.people.length > 0);
}
