import { useQuery } from "@tanstack/react-query";
import { Lock, ShieldAlert, Users } from "lucide-react";
import { useState } from "react";
import { ErrorState } from "@/components/common/ErrorState";
import { PageHeader } from "@/components/common/PageHeader";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { getRole, listRoles, type RolePermission } from "@/services/auth";

const MODE_LABEL: Record<string, string> = { own: "Own", my_teams: "My teams", reports: "Reports", all_in_scope: "Everyone in scope" };

/** Settings → Roles: the roles of the organization and what each one allows. Read only until the editor in stage 2.4. */
export default function RolesPage() {
  const roles = useQuery({ queryKey: ["roles"], queryFn: listRoles, retry: false });
  const [selected, setSelected] = useState<string | null>(null);
  const activeId = selected ?? roles.data?.[0]?.id ?? null;
  const detail = useQuery({ queryKey: ["role", activeId], queryFn: () => getRole(activeId!), enabled: Boolean(activeId), retry: false });

  const byModule = new Map<string, RolePermission[]>();
  for (const p of detail.data?.permissions ?? []) byModule.set(p.module, [...(byModule.get(p.module) ?? []), p]);

  return (
    <>
      <PageHeader eyebrow="Settings" title="Roles" description="Roles are data: each one is a set of permissions and how far they reach. Choose one to see what it allows." />
      <p className="mb-4 flex items-center gap-2 text-label text-muted-foreground">
        <Lock aria-hidden="true" className="size-4" /> Read only. Editing roles and assigning them arrives in stage 2.4.
      </p>
      {roles.isPending ? (
        <PageSkeleton />
      ) : roles.isError ? (
        <ErrorState error={roles.error} onRetry={() => void roles.refetch()} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <ul aria-label="Roles" className="space-y-2">
            {roles.data.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelected(r.id)}
                  aria-current={r.id === activeId ? "true" : undefined}
                  className={cn(
                    "w-full rounded-xl border p-3 text-left transition-colors duration-[var(--duration-fast)]",
                    r.id === activeId ? "border-primary/50 bg-selected" : "bg-card hover:bg-muted/60",
                  )}
                >
                  <span className="block text-body font-medium">{r.name}</span>
                  <span className="mt-0.5 flex items-center gap-3 text-caption text-muted-foreground">
                    <span>{r.permissionCount} permissions</span>
                    <span className="flex items-center gap-1">
                      <Users aria-hidden="true" className="size-3.5" /> {r.holderCount}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <Card lift={false}>
            {detail.isPending ? (
              <CardContent className="pt-5">
                <PageSkeleton />
              </CardContent>
            ) : detail.isError || !detail.data ? (
              <CardContent className="pt-5">
                <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
              </CardContent>
            ) : (
              <>
                <CardHeader>
                  <CardTitle>{detail.data.name}</CardTitle>
                  <CardDescription>{detail.data.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  {[...byModule.entries()].map(([module, perms]) => (
                    <section key={module} aria-label={module}>
                      <h3 className="eyebrow mb-2 text-primary-ink">{module}</h3>
                      <ul className="divide-y divide-border rounded-lg border">
                        {perms.map((p) => (
                          <li key={p.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                            <div className="min-w-0">
                              <p className="flex items-center gap-2 text-label font-medium">
                                <code className="font-mono text-caption">{p.key}</code>
                                {p.sensitive && (
                                  <Badge variant="outline">
                                    <ShieldAlert aria-hidden="true" /> Sensitive
                                  </Badge>
                                )}
                              </p>
                              <p className="text-caption text-muted-foreground">{p.description}</p>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {p.modes.map((m) => (
                                <Badge key={m} variant="primary">
                                  {MODE_LABEL[m] ?? m}
                                </Badge>
                              ))}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                  {byModule.size === 0 && <p className="text-body text-muted-foreground">This role grants no permissions.</p>}
                </CardContent>
              </>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
