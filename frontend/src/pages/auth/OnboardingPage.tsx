import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router";
import { FormAlert, FormField } from "@/components/common/FormField";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { guessTimezone, problemText } from "@/lib/authForm";
import { AuthLayout } from "@/layouts/AuthLayout";

/** First sign-in: name the organization. The person becomes its Owner. */
export default function OnboardingPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (auth.status === "signedOut") return <Navigate to="/login" replace />;
  if (auth.status === "ready") return <Navigate to="/overview" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    const err = trimmed.length < 2 ? "Use at least 2 characters" : undefined;
    setError(err);
    setProblem(null);
    if (err) return;
    setBusy(true);
    try {
      await auth.createOrganization(trimmed, guessTimezone());
      navigate("/overview", { replace: true });
    } catch (e2) {
      setProblem(problemText(e2));
    } finally {
      setBusy(false);
    }
  }

  const first = auth.me?.user.name.split(" ")[0];
  return (
    <AuthLayout
      title={first ? `Welcome, ${first}` : "Welcome"}
      description="Create your organization. You will be its owner, and you can invite people later."
      footer={
        <button type="button" className="font-medium text-primary-ink underline-offset-4 hover:underline" onClick={() => void auth.logout().then(() => navigate("/login", { replace: true }))}>
          Not you? Log out
        </button>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {problem && <FormAlert>{problem}</FormAlert>}
        <FormField label="Organization name" autoComplete="organization" value={name} onChange={(e) => setName(e.target.value)} error={error} hint="For example, your company or team." />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Creating…" : "Create organization"}
        </Button>
      </form>
    </AuthLayout>
  );
}
