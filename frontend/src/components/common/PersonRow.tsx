import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldPlus, UserMinus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { problemText } from "@/lib/authForm";
import { formatDateTime } from "@/lib/format";
import { assignRole, removePerson, revokeAssignment, type MemberView, type RoleView } from "@/services/auth";

/**
 * One person on the Users screen: their roles (each can be taken away), Assign role (for example to someone who
 * joined with no role), Remove from organization and the password-reset link. Every destructive step asks twice, and the
 * server's refusals (last administrator, a role you do not hold) are shown in its own words.
 */
export function PersonRow({
  m,
  tz,
  roles,
  canAssign,
  canPeople,
  onReset,
  resetBusy,
  onProblem,
}: {
  m: MemberView;
  tz: string;
  roles: RoleView[] | undefined;
  canAssign: boolean;
  canPeople: boolean;
  onReset: (id: string) => void;
  resetBusy: boolean;
  onProblem: (message: string | null) => void;
}) {
  const client = useQueryClient();
  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: ["members"] }), client.invalidateQueries({ queryKey: ["roles"] })]);
  const [assigning, setAssigning] = useState(false);
  const [roleId, setRoleId] = useState("");
  const [scope, setScope] = useState("organization");
  const [until, setUntil] = useState("");
  const [confirm, setConfirm] = useState<"remove" | string | null>(null); // "remove" or an assignment id being revoked

  const assign = useMutation({
    mutationFn: () => assignRole({ membershipId: m.id, roleId, scopeType: scope, ...(until ? { validTo: new Date(`${until}T23:59:59`).toISOString() } : {}) }),
    onSuccess: () => {
      setAssigning(false);
      setRoleId("");
      setUntil("");
      onProblem(null);
      void refresh();
    },
    onError: (e) => onProblem(problemText(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeAssignment(id),
    onSuccess: () => {
      setConfirm(null);
      onProblem(null);
      void refresh();
    },
    onError: (e) => {
      setConfirm(null);
      onProblem(problemText(e));
    },
  });
  const remove = useMutation({
    mutationFn: () => removePerson(m.id),
    onSuccess: () => {
      setConfirm(null);
      onProblem(null);
      void refresh();
    },
    onError: (e) => {
      setConfirm(null);
      onProblem(problemText(e));
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!roleId) return onProblem("Choose a role to assign");
    onProblem(null);
    assign.mutate();
  }

  const joined = m.hasLogin && m.status === "active";
  const heldIds = new Set(m.assignments.map((a) => a.roleId));
  const assignable = (roles ?? []).filter((r) => !heldIds.has(r.id));

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-body font-medium">
            {m.displayName} {m.isYou && <span className="text-caption font-normal text-muted-foreground">(you)</span>}
          </p>
          <p className="truncate text-caption text-muted-foreground">{m.email ?? "No email"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {m.assignments.map((a) =>
            canAssign ? (
              <span key={a.id} className="inline-flex items-center gap-1">
                <Badge variant="primary">
                  {a.roleName}
                  {a.validTo && <span className="font-normal"> · until {formatDateTime(a.validTo, tz).split(",")[0]}</span>}
                </Badge>
                {confirm === a.id ? (
                  <>
                    <Button variant="outline" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(a.id)} aria-label={`Confirm taking ${a.roleName} away from ${m.displayName}`}>
                      Confirm
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" size="icon" className="size-7" onClick={() => setConfirm(a.id)} aria-label={`Take ${a.roleName} away from ${m.displayName}`}>
                    <X aria-hidden="true" />
                  </Button>
                )}
              </span>
            ) : (
              <Badge key={a.id} variant="primary">
                {a.roleName}
              </Badge>
            ),
          )}
          {m.assignments.length === 0 && m.status === "active" && <Badge variant="dashed">No role</Badge>}
          {m.status === "invited" && <Badge variant="dashed">Not joined yet</Badge>}
        </div>
      </div>

      {(joined && !m.isYou) || (canAssign && joined) ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {canAssign && joined && (
            <Button variant="outline" size="sm" aria-label={`Assign a role to ${m.displayName}`} onClick={() => setAssigning((v) => !v)}>
              <ShieldPlus aria-hidden="true" /> Assign role
            </Button>
          )}
          {canPeople && joined && !m.isYou && (
            <Button variant="outline" size="sm" aria-label={`Reset password link for ${m.displayName}`} disabled={resetBusy} onClick={() => onReset(m.id)}>
              <KeyRound aria-hidden="true" /> Reset password link
            </Button>
          )}
          {canPeople && joined && !m.isYou &&
            (confirm === "remove" ? (
              <>
                <span className="text-caption text-muted-foreground">They keep their login and will be asked to create an organization.</span>
                <Button variant="outline" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()} aria-label={`Confirm removing ${m.displayName} from the organization`}>
                  Confirm remove
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" aria-label={`Remove ${m.displayName} from the organization`} onClick={() => setConfirm("remove")}>
                <UserMinus aria-hidden="true" /> Remove from organization
              </Button>
            ))}
        </div>
      ) : null}

      {assigning && (
        <form onSubmit={submit} noValidate aria-label={`Assign a role to ${m.displayName}`} className="mt-3 grid gap-3 rounded-lg border bg-muted/40 p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
          <div className="space-y-1.5">
            <label htmlFor={`role-${m.id}`} className="text-label font-medium">
              Role
            </label>
            <select id={`role-${m.id}`} value={roleId} onChange={(e) => setRoleId(e.target.value)} className="h-10 w-full rounded-lg border border-input bg-card px-3 text-body text-foreground shadow-xs">
              <option value="">Choose a role</option>
              {assignable.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`scope-${m.id}`} className="text-label font-medium">
              Applies to
            </label>
            <select id={`scope-${m.id}`} value={scope} onChange={(e) => setScope(e.target.value)} className="h-10 w-full rounded-lg border border-input bg-card px-3 text-body text-foreground shadow-xs">
              <option value="organization">The whole organization</option>
              <option value="department" disabled>
                One department (arrives with stage 2.6)
              </option>
              <option value="team" disabled>
                One team (arrives with stage 2.6)
              </option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`until-${m.id}`} className="text-label font-medium">
              Until (optional)
            </label>
            <input id={`until-${m.id}`} type="date" value={until} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setUntil(e.target.value)} className="h-10 w-full rounded-lg border border-input bg-card px-3 text-body text-foreground shadow-xs" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={assign.isPending}>
              {assign.isPending ? "Assigning…" : "Assign"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAssigning(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}
