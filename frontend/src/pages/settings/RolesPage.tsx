import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Plus, ShieldAlert, Users } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ErrorState } from "@/components/common/ErrorState";
import { FormAlert, FormField, FormNotice } from "@/components/common/FormField";
import { PageHeader } from "@/components/common/PageHeader";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { problemText } from "@/lib/authForm";
import { cn } from "@/lib/cn";
import { ApiError } from "@/services/api";
import { archiveRole, canGrantMode, createRole, getRole, listPermissions, listRoles, setRolePermissions, updateRole, type CatalogPermission } from "@/services/auth";

const MODES = ["own", "my_teams", "reports", "all_in_scope"] as const;
const MODE_LABEL: Record<string, string> = { own: "Own", my_teams: "My teams", reports: "Reports", all_in_scope: "Everyone in scope" };
const cell = (permission: string, mode: string) => `${permission}:${mode}`;

/**
 * Settings → Roles: the organization's roles and a grid of what each one allows. People with `roles.manage` can create,
 * rename, change and archive roles (the Owner role is protected: view only); everyone else with `roles.view` sees the
 * same grid read only. Cells you cannot grant are disabled; the server enforces every rule again.
 */
export default function RolesPage() {
  const auth = useAuth();
  const client = useQueryClient();
  const canManage = auth.can("roles.manage");
  const roles = useQuery({ queryKey: ["roles"], queryFn: listRoles, retry: false });
  const catalog = useQuery({ queryKey: ["permissions"], queryFn: listPermissions, retry: false, staleTime: Infinity });
  const [selected, setSelected] = useState<string | null>(null);
  const activeId = selected ?? roles.data?.[0]?.id ?? null;
  const detail = useQuery({ queryKey: ["role", activeId], queryFn: () => getRole(activeId!), enabled: Boolean(activeId), retry: false });
  const role = detail.data;
  const editable = canManage && role !== undefined && !role.isProtected;

  // ----- the grid being edited -----
  const original = useMemo(() => new Set((role?.permissions ?? []).flatMap((p) => p.modes.map((m) => cell(p.key, m)))), [role]);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [confirmSensitive, setConfirmSensitive] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    // The grid is re-read after a save: start the draft from the saved state (the success notice must survive that).
    setDraft(new Set(original));
    setConfirmSensitive(false);
  }, [original]);
  useEffect(() => {
    // Choosing another role starts clean.
    setSaved(false);
    setProblem(null);
  }, [activeId]);

  const added = [...draft].filter((c) => !original.has(c));
  const removed = [...original].filter((c) => !draft.has(c));
  const sensitiveAdded = [...new Set(added.map((c) => c.split(":")[0]!))].filter((k) => catalog.data?.find((p) => p.key === k)?.sensitive);
  const dirty = added.length + removed.length > 0;

  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: ["roles"] }), client.invalidateQueries({ queryKey: ["role"] })]);

  const save = useMutation({
    mutationFn: () =>
      setRolePermissions(role!.id, {
        grants: [...draft].map((c) => ({ permission: c.split(":")[0]!, mode: c.split(":")[1]! })),
        ...(sensitiveAdded.length > 0 ? { confirmSensitive: true } : {}),
      }),
    onSuccess: () => {
      setSaved(true);
      setProblem(null);
      void refresh();
    },
    onError: (e) => setProblem(problemText(e)),
  });

  function toggle(permission: string, mode: string) {
    setSaved(false);
    setDraft((d) => {
      const next = new Set(d);
      const c = cell(permission, mode);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  // ----- creating, renaming, archiving -----
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [createProblem, setCreateProblem] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => createRole({ name: newName.trim(), ...(newDescription.trim() ? { description: newDescription.trim() } : {}), ...(copyFrom ? { copyFromRoleId: copyFrom } : {}) }),
    onSuccess: (r) => {
      setCreating(false);
      setNewName("");
      setNewDescription("");
      setCopyFrom("");
      setCreateProblem(null);
      setSelected(r.id);
      void refresh();
    },
    onError: (e) => setCreateProblem(problemText(e)),
  });
  function submitCreate(e: FormEvent) {
    e.preventDefault();
    if (newName.trim().length < 2) return setCreateProblem("Use at least 2 characters for the name");
    setCreateProblem(null);
    create.mutate();
  }

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  useEffect(() => {
    setName(role?.name ?? "");
    setDescription(role?.description ?? "");
  }, [role?.id, role?.name, role?.description]);
  const rename = useMutation({
    mutationFn: () => updateRole(role!.id, { name: name.trim(), description: description.trim() }),
    onSuccess: () => {
      setProblem(null);
      void refresh();
    },
    onError: (e) => setProblem(problemText(e)),
  });
  const [confirmArchive, setConfirmArchive] = useState(false);
  const archive = useMutation({
    mutationFn: () => archiveRole(role!.id),
    onSuccess: () => {
      setConfirmArchive(false);
      setSelected(null);
      void refresh();
    },
    onError: (e) => {
      setConfirmArchive(false);
      setProblem(e instanceof ApiError ? e.message : problemText(e));
    },
  });

  const byModule = new Map<string, CatalogPermission[]>();
  for (const p of catalog.data ?? []) byModule.set(p.module, [...(byModule.get(p.module) ?? []), p]);
  const caps = auth.me?.capabilities ?? {};

  return (
    <>
      <PageHeader eyebrow="Settings" title="Roles" description="Roles are data: each one is a set of permissions and how far they reach. Choose one to see or change what it allows." />
      {!canManage && (
        <p className="mb-4 flex items-center gap-2 text-label text-muted-foreground">
          <Lock aria-hidden="true" className="size-4" /> You can view roles but not change them.
        </p>
      )}
      {roles.isPending ? (
        <PageSkeleton />
      ) : roles.isError ? (
        <ErrorState error={roles.error} onRetry={() => void roles.refetch()} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <div className="space-y-3">
            <ul aria-label="Roles" className="space-y-2">
              {roles.data.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(r.id)}
                    aria-current={r.id === activeId ? "true" : undefined}
                    className={cn("w-full rounded-xl border p-3 text-left transition-colors duration-[var(--duration-fast)]", r.id === activeId ? "border-primary/50 bg-selected" : "bg-card hover:bg-muted/60")}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-body font-medium">{r.name}</span>
                      {r.isProtected && (
                        <Badge variant="outline">
                          <Lock aria-hidden="true" /> Protected
                        </Badge>
                      )}
                    </span>
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
            {canManage &&
              (creating ? (
                <form onSubmit={submitCreate} noValidate className="space-y-3 rounded-xl border bg-card p-3" aria-label="New role">
                  {createProblem && <FormAlert>{createProblem}</FormAlert>}
                  <FormField label="Role name" value={newName} onChange={(e) => setNewName(e.target.value)} autoComplete="off" />
                  <FormField label="Description (optional)" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} autoComplete="off" />
                  <div className="space-y-1.5">
                    <label htmlFor="copy-from" className="text-label font-medium">
                      Start from
                    </label>
                    <select id="copy-from" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} className="h-10 w-full rounded-lg border border-input bg-card px-3 text-body text-foreground shadow-xs">
                      <option value="">An empty role</option>
                      {roles.data.map((r) => (
                        <option key={r.id} value={r.id}>
                          A copy of {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={create.isPending}>
                      {create.isPending ? "Creating…" : "Create role"}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <Button variant="outline" className="w-full" onClick={() => setCreating(true)}>
                  <Plus aria-hidden="true" /> New role
                </Button>
              ))}
          </div>

          <Card lift={false}>
            {detail.isPending || catalog.isPending ? (
              <CardContent className="pt-5">
                <PageSkeleton />
              </CardContent>
            ) : detail.isError || !role ? (
              <CardContent className="pt-5">
                <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
              </CardContent>
            ) : (
              <>
                <CardHeader>
                  <CardTitle>{role.name}</CardTitle>
                  <CardDescription>{role.description || "No description."}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  {role.isProtected && (
                    <p role="note" className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary-soft px-3 py-2.5 text-label text-primary-soft-foreground">
                      <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                      This role is protected. It can be viewed, assigned and copied, but never edited or archived, so the organization can never lose full control.
                    </p>
                  )}
                  {problem && <FormAlert>{problem}</FormAlert>}
                  {saved && <FormNotice>Saved. People holding this role have the new permissions on their next request.</FormNotice>}

                  {editable && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        rename.mutate();
                      }}
                      noValidate
                      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
                      aria-label="Role details"
                    >
                      <FormField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
                      <FormField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} autoComplete="off" />
                      <Button type="submit" variant="outline" disabled={rename.isPending || (name.trim() === role.name && description.trim() === role.description) || name.trim().length < 2}>
                        Save details
                      </Button>
                    </form>
                  )}

                  {[...byModule.entries()].map(([module, perms]) => (
                    <section key={module} aria-label={module}>
                      <h3 className="eyebrow mb-2 text-primary-ink">{module}</h3>
                      <ul className="divide-y divide-border rounded-lg border">
                        {perms.map((p) => (
                          <li key={p.key} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                            <div className="min-w-0 flex-1 basis-60">
                              <p className="flex flex-wrap items-center gap-2 text-label font-medium">
                                <code className="font-mono text-caption">{p.key}</code>
                                {p.sensitive && (
                                  <Badge variant="outline">
                                    <ShieldAlert aria-hidden="true" /> Sensitive
                                  </Badge>
                                )}
                              </p>
                              <p className="text-caption text-muted-foreground">{p.description}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:flex sm:flex-wrap">
                              {MODES.map((m) => {
                                const checked = draft.has(cell(p.key, m));
                                const allowed = p.modes.includes(m);
                                const grantable = checked || canGrantMode(caps, p.key, m); // taking away is always allowed; adding needs you to hold it
                                const disabled = !editable || !allowed || !grantable;
                                const why = !allowed ? "This permission cannot be given in this mode" : !grantable ? "You can only add permissions you hold yourself" : undefined;
                                return (
                                  <label key={m} title={why} className={cn("flex items-center gap-1.5 text-caption", disabled ? "text-muted-foreground" : "cursor-pointer")}>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={disabled}
                                      onChange={() => toggle(p.key, m)}
                                      aria-label={`${p.key}: ${MODE_LABEL[m]}`}
                                      className="size-4 accent-[var(--primary)]"
                                    />
                                    {MODE_LABEL[m]}
                                  </label>
                                );
                              })}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}

                  {editable && (
                    <div className="space-y-3 rounded-xl border bg-muted/40 p-4" aria-label="Save changes">
                      <p className="text-label" role="status">
                        {dirty ? `${added.length} to add, ${removed.length} to remove.` : "No changes."}
                      </p>
                      {sensitiveAdded.length > 0 && (
                        <label className="flex items-start gap-2 text-label">
                          <input type="checkbox" checked={confirmSensitive} onChange={(e) => setConfirmSensitive(e.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
                          <span>
                            I understand I am adding sensitive permissions ({sensitiveAdded.join(", ")}). Everyone holding this role will get them, and the change is recorded in the audit log.
                          </span>
                        </label>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending || (sensitiveAdded.length > 0 && !confirmSensitive)}>
                          {save.isPending ? "Saving…" : "Save changes"}
                        </Button>
                        <Button variant="ghost" onClick={() => setDraft(new Set(original))} disabled={!dirty}>
                          Discard
                        </Button>
                      </div>
                    </div>
                  )}

                  {editable && (
                    <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                      {confirmArchive ? (
                        <>
                          <span className="text-label">Archive &ldquo;{role.name}&rdquo;? It stops granting anything.</span>
                          <Button variant="outline" size="sm" onClick={() => archive.mutate()} disabled={archive.isPending}>
                            Confirm archive
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setConfirmArchive(false)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => setConfirmArchive(true)}>
                          Archive this role…
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
