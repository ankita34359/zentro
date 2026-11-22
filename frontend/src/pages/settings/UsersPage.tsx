import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleDashed, Clock, KeyRound, Link2, MailPlus, RefreshCw, XCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { FormAlert, FormField } from "@/components/common/FormField";
import { OneTimeLink } from "@/components/common/OneTimeLink";
import { PageHeader } from "@/components/common/PageHeader";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { emailError, problemText } from "@/lib/authForm";
import { formatDateTime } from "@/lib/format";
import {
  createInvitation,
  createResetLink,
  invitationLink,
  listInvitations,
  listMembers,
  regenerateInvitation,
  resetLinkUrl,
  revokeInvitation,
  type InvitationView,
} from "@/services/auth";

interface Shown {
  title: string;
  link: string;
  note: string;
}

const STATUS = {
  pending: { label: "Pending", icon: Clock, variant: "primary" },
  accepted: { label: "Accepted", icon: CheckCircle2, variant: "neutral" },
  revoked: { label: "Revoked", icon: XCircle, variant: "outline" },
  expired: { label: "Expired", icon: CircleDashed, variant: "dashed" },
} as const;

/** Settings → Users: invite people, copy and revoke links, and generate password-reset links. Owners only for now. */
export default function UsersPage() {
  const auth = useAuth();
  const client = useQueryClient();
  const tz = auth.me?.organization?.timezone ?? "UTC";
  const isOwner = auth.me?.roles.includes("owner") ?? false;
  const [shown, setShown] = useState<Shown | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [emailErr, setEmailErr] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const invitations = useQuery({ queryKey: ["invitations"], queryFn: listInvitations, enabled: isOwner, retry: false });
  const members = useQuery({ queryKey: ["members"], queryFn: listMembers, enabled: isOwner, retry: false });
  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: ["invitations"] }), client.invalidateQueries({ queryKey: ["members"] })]);

  const showInvite = (code: string, who: string, expiresAt: string) =>
    setShown({
      title: `Invitation link for ${who}`,
      link: invitationLink(code),
      note: `Copy it now and send it to ${who}. It is shown once and works until ${formatDateTime(expiresAt, tz)}. Anyone with the link can join as the invited email address.`,
    });

  const invite = useMutation({
    mutationFn: () => createInvitation({ email: email.trim(), ...(name.trim() ? { name: name.trim() } : {}) }),
    onSuccess: (r) => {
      showInvite(r.code, r.invitation.email, r.expiresAt);
      setEmail("");
      setName("");
      void refresh();
    },
    onError: (e) => setProblem(problemText(e)),
  });
  const regenerate = useMutation({
    mutationFn: (id: string) => regenerateInvitation(id),
    onSuccess: (r) => {
      showInvite(r.code, r.invitation.email, r.expiresAt);
      void refresh();
    },
    onError: (e) => setProblem(problemText(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeInvitation(id),
    onSuccess: () => {
      setConfirmRevoke(null);
      void refresh();
    },
    onError: (e) => setProblem(problemText(e)),
  });
  const reset = useMutation({
    mutationFn: (m: { id: string }) => createResetLink(m.id),
    onSuccess: (r) =>
      setShown({
        title: `Password reset link for ${r.displayName}`,
        link: resetLinkUrl(r.token),
        note: `Copy it now and send it to ${r.displayName}. It is shown once, works once and expires ${formatDateTime(r.expiresAt, tz)}. Using it signs them out everywhere.`,
      }),
    onError: (e) => setProblem(problemText(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const err = emailError(email);
    setEmailErr(err);
    setProblem(null);
    if (!err) invite.mutate();
  }

  const header = <PageHeader eyebrow="Settings" title="Users and invitations" description="Invite people, copy their link, and help someone back in if they lose their password." />;
  if (auth.status === "loading") return <PageSkeleton />;
  if (!isOwner) {
    return (
      <>
        {header}
        <EmptyState illustration="settings" title="Only owners can manage users for now">
          <p>Roles and permissions arrive in stage 2.3. Until then the organization&apos;s owners manage invitations and password resets.</p>
        </EmptyState>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="space-y-6">
        {shown && <OneTimeLink {...shown} onDismiss={() => setShown(null)} />}
        {problem && <FormAlert>{problem}</FormAlert>}

        <Card lift={false}>
          <CardHeader>
            <CardTitle>Invite someone</CardTitle>
            <CardDescription>You get a link to copy and send. Nothing is emailed automatically yet.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
              <FormField label="Email" type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} error={emailErr} />
              <FormField label="Name (optional)" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
              <Button type="submit" className="w-full sm:mt-[1.65rem] sm:w-auto" disabled={invite.isPending}>
                <MailPlus aria-hidden="true" /> {invite.isPending ? "Creating…" : "Create invitation"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card lift={false}>
          <CardHeader>
            <CardTitle>Invitations</CardTitle>
            <CardDescription>Links last 7 days. A new link replaces the old one.</CardDescription>
          </CardHeader>
          <CardContent>
            {invitations.isPending ? (
              <PageSkeleton />
            ) : invitations.isError ? (
              <ErrorState error={invitations.error} onRetry={() => void invitations.refetch()} />
            ) : invitations.data.length === 0 ? (
              <p className="text-body text-muted-foreground">No invitations yet. Invite the first person above.</p>
            ) : (
              <ul className="divide-y divide-border" aria-label="Invitations">
                {invitations.data.map((i) => (
                  <InvitationRow
                    key={i.id}
                    inv={i}
                    tz={tz}
                    confirming={confirmRevoke === i.id}
                    busy={regenerate.isPending || revoke.isPending}
                    onRegenerate={() => regenerate.mutate(i.id)}
                    onAskRevoke={() => setConfirmRevoke(i.id)}
                    onCancelRevoke={() => setConfirmRevoke(null)}
                    onRevoke={() => revoke.mutate(i.id)}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card lift={false}>
          <CardHeader>
            <CardTitle>People</CardTitle>
            <CardDescription>Generate a one-time link for someone who lost their password. You send it to them.</CardDescription>
          </CardHeader>
          <CardContent>
            {members.isPending ? (
              <PageSkeleton />
            ) : members.isError ? (
              <ErrorState error={members.error} onRetry={() => void members.refetch()} />
            ) : (
              <ul className="divide-y divide-border" aria-label="People">
                {members.data.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-body font-medium">
                        {m.displayName} {m.isYou && <span className="text-caption font-normal text-muted-foreground">(you)</span>}
                      </p>
                      <p className="truncate text-caption text-muted-foreground">{m.email ?? "No email"}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {m.roles.map((r) => (
                        <Badge key={r} variant="primary">
                          {r === "owner" ? "Owner" : r}
                        </Badge>
                      ))}
                      {m.status === "invited" && <Badge variant="dashed">Not joined yet</Badge>}
                      {m.hasLogin && !m.isYou && (
                        <Button variant="outline" size="sm" aria-label={`Reset password link for ${m.displayName}`} disabled={reset.isPending} onClick={() => reset.mutate({ id: m.id })}>
                          <KeyRound aria-hidden="true" /> Reset password link
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function InvitationRow({
  inv,
  tz,
  confirming,
  busy,
  onRegenerate,
  onAskRevoke,
  onCancelRevoke,
  onRevoke,
}: {
  inv: InvitationView;
  tz: string;
  confirming: boolean;
  busy: boolean;
  onRegenerate: () => void;
  onAskRevoke: () => void;
  onCancelRevoke: () => void;
  onRevoke: () => void;
}) {
  const s = STATUS[inv.status];
  const open = inv.status === "pending" || inv.status === "expired";
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-body font-medium">{inv.displayName}</p>
        <p className="truncate text-caption text-muted-foreground">
          {inv.email} · {inv.status === "accepted" ? `joined ${formatDateTime(inv.acceptedAt ?? inv.createdAt, tz)}` : `${inv.status === "pending" ? "expires" : "expired"} ${formatDateTime(inv.expiresAt, tz)}`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={s.variant}>
          <s.icon aria-hidden="true" /> {s.label}
        </Badge>
        {inv.status !== "accepted" && (
          <Button variant="outline" size="sm" disabled={busy} onClick={onRegenerate} aria-label={`New link for ${inv.email}`}>
            {inv.status === "pending" ? <RefreshCw aria-hidden="true" /> : <Link2 aria-hidden="true" />} New link
          </Button>
        )}
        {open &&
          (confirming ? (
            <>
              <Button variant="outline" size="sm" disabled={busy} onClick={onRevoke} aria-label={`Confirm revoking the invitation for ${inv.email}`}>
                Confirm revoke
              </Button>
              <Button variant="ghost" size="sm" onClick={onCancelRevoke}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" disabled={busy} onClick={onAskRevoke} aria-label={`Revoke the invitation for ${inv.email}`}>
              Revoke
            </Button>
          ))}
      </div>
    </li>
  );
}
