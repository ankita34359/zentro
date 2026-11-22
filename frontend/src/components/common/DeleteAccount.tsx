import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { FormAlert, FormField } from "@/components/common/FormField";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { problemText } from "@/lib/authForm";
import { deletionPreview } from "@/services/auth";

/**
 * "Delete my account". It first asks the server what would happen and shows that in plain words BEFORE anything can be
 * confirmed: only the login, or (when the person is the only member and nothing is pending) the whole organization.
 */
export function DeleteAccount() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const preview = useQuery({ queryKey: ["deletion-preview"], queryFn: deletionPreview, enabled: open, retry: false, staleTime: 0, gcTime: 0 });
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [orgName, setOrgName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const p = preview.data;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!p || p.mode === "blocked") return;
    setProblem(null);
    setBusy(true);
    try {
      await auth.deleteAccount({ password, confirmEmail: email, ...(p.mode === "account_and_organization" ? { confirmOrganizationName: orgName } : {}) });
      navigate("/login", { replace: true });
    } catch (err) {
      setProblem(problemText(err));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card lift={false} className="border-off-track/30">
      <CardHeader>
        <CardTitle>Delete my account</CardTitle>
        <CardDescription>Erases your login. This cannot be undone.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!open ? (
          <Button variant="outline" onClick={() => setOpen(true)}>
            <Trash2 aria-hidden="true" /> Delete my account…
          </Button>
        ) : preview.isPending ? (
          <PageSkeleton />
        ) : preview.isError || !p ? (
          <FormAlert>{problemText(preview.error)}</FormAlert>
        ) : p.mode === "blocked" ? (
          <div role="alert" className="rounded-lg border border-at-risk/40 bg-at-risk-soft px-3 py-3 text-label text-at-risk-ink">
            {p.reason === "pending_invitations" ? (
              <p>
                You are the only member of <strong>{p.organizationName}</strong>, but {p.pendingInvitations} invitation{p.pendingInvitations === 1 ? " is" : "s are"} still pending. Revoke{" "}
                {p.pendingInvitations === 1 ? "it" : "them"} in Settings → Users and invitations first, then come back.
              </p>
            ) : (
              <p>
                You are the last administrator of <strong>{p.organizationName}</strong>, and {p.others} other {p.others === 1 ? "person remains" : "people remain"}. Make someone else an administrator first, or ask everyone else to leave.
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-4">
            <div role="alert" className="flex gap-3 rounded-lg border border-off-track/30 bg-off-track-soft px-3 py-3 text-label text-off-track-ink">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {p.mode === "account_and_organization" ? (
                <div className="space-y-1">
                  <p className="font-semibold">This also deletes the organization &ldquo;{p.organizationName}&rdquo;.</p>
                  <p>You are its only member and nothing is pending, so the organization, its roles and everything in it are deleted with your login. There is no undo and no backup.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="font-semibold">Your login is erased{p.organizationName ? ` and you leave ${p.organizationName}` : ""}.</p>
                  <p>Your name and email are removed, you are signed out everywhere, and your roles end.{p.organizationName ? " The organization and the other people carry on." : ""} There is no undo.</p>
                </div>
              )}
            </div>
            {problem && <FormAlert>{problem}</FormAlert>}
            <FormField label="Your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <FormField label={`Type your email (${auth.me?.user.email}) to confirm`} autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
            {p.mode === "account_and_organization" && (
              <FormField label={`Type the organization name (${p.organizationName}) to confirm`} autoComplete="off" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="outline" disabled={busy || !password || !email || (p.mode === "account_and_organization" && !orgName)}>
                <Trash2 aria-hidden="true" /> {busy ? "Deleting…" : p.mode === "account_and_organization" ? "Delete my account and the organization" : "Delete my account"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
