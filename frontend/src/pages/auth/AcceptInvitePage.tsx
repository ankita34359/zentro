import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { FormAlert, FormField } from "@/components/common/FormField";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { MIN_PASSWORD_LENGTH, passwordError, problemText } from "@/lib/authForm";
import { AuthLayout } from "@/layouts/AuthLayout";
import { fragmentParam, previewInvitation } from "@/services/auth";

/** The link carries the invitation code in the fragment (`#code=...`). The invitation replaces the registration code. */
export default function AcceptInvitePage() {
  const { hash, pathname } = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const code = fragmentParam(hash, "code");
  const preview = useQuery({
    queryKey: ["invitation-preview", code],
    queryFn: () => previewInvitation(code!),
    enabled: Boolean(code),
    retry: false,
    staleTime: Infinity,
  });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ name?: string; password?: string }>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function join(e: FormEvent) {
    e.preventDefault();
    if (!code || !preview.data) return;
    const signedIn = Boolean(auth.me);
    const next = signedIn ? {} : { name: name.trim() ? undefined : "Enter your name", password: passwordError(password) };
    setErrors(next);
    setProblem(null);
    if (Object.values(next).some(Boolean)) return;
    setBusy(true);
    try {
      await auth.acceptInvitation(signedIn ? { code } : { code, name: name.trim(), email: preview.data.email, password });
      navigate("/overview", { replace: true });
    } catch (err) {
      setProblem(problemText(err));
    } finally {
      setBusy(false);
    }
  }

  const here = pathname + hash;
  const layout = (title: string, description: string, body: React.ReactNode) => (
    <AuthLayout title={title} description={description}>
      {body}
    </AuthLayout>
  );

  if (!code) return layout("Invitation", "This invitation link is incomplete.", <FormAlert>Ask the person who invited you to send the link again.</FormAlert>);
  if (preview.isPending || auth.status === "loading") return layout("Invitation", "Checking your invitation…", <PageSkeleton />);
  if (preview.isError || !preview.data) {
    return layout("Invitation", "This invitation cannot be used.", <FormAlert>{problemText(preview.error)}</FormAlert>);
  }

  const inv = preview.data;
  const me = auth.me;
  if (me) {
    const sameAddress = me.user.email.toLowerCase() === inv.email.toLowerCase();
    if (me.organization) {
      return layout(`Join ${inv.organizationName}`, "You already belong to an organization.", <FormAlert>Log out of this account if the invitation is for someone else.</FormAlert>);
    }
    if (!sameAddress) {
      return layout(
        `Join ${inv.organizationName}`,
        `This invitation is for ${inv.email}, but you are signed in as ${me.user.email}.`,
        <Button variant="outline" className="w-full" onClick={() => void auth.logout().then(() => navigate(here, { replace: true }))}>
          Log out and continue
        </Button>,
      );
    }
    return layout(
      `Join ${inv.organizationName}`,
      `You are signed in as ${me.user.email}.`,
      <form onSubmit={join} className="space-y-4">
        {problem && <FormAlert>{problem}</FormAlert>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Joining…" : `Join ${inv.organizationName}`}
        </Button>
      </form>,
    );
  }

  return (
    <AuthLayout
      title={`Join ${inv.organizationName}`}
      description="You were invited. Create your account to join; no registration code is needed."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" state={{ from: here }} className="font-medium text-primary-ink underline-offset-4 hover:underline">
            Sign in first
          </Link>
        </>
      }
    >
      <form onSubmit={join} noValidate className="space-y-4">
        {problem && <FormAlert>{problem}</FormAlert>}
        <FormField label="Your name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
        <FormField label="Email" type="email" value={inv.email} readOnly aria-readonly="true" hint="The invitation was sent to this address." />
        <FormField label="Password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} hint={`At least ${MIN_PASSWORD_LENGTH} characters.`} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Creating your account…" : "Create account and join"}
        </Button>
      </form>
    </AuthLayout>
  );
}
