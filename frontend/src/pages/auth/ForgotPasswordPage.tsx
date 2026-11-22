import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { FormAlert, FormField, FormNotice } from "@/components/common/FormField";
import { Button } from "@/components/ui/button";
import { emailError, problemText } from "@/lib/authForm";
import { AuthLayout } from "@/layouts/AuthLayout";
import { forgotPassword } from "@/services/auth";

/** Nothing is emailed yet: the answer is always the same and tells the person to ask their administrator. */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const err = emailError(email);
    setError(err);
    setProblem(null);
    if (err) return;
    setBusy(true);
    try {
      const r = await forgotPassword(email.trim());
      setDone(r.message);
    } catch (e2) {
      setProblem(problemText(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Forgot your password?"
      description="Passwords are reset by your organization's administrator, who gives you a one-time link."
      footer={
        <Link to="/login" className="font-medium text-primary-ink underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {done ? (
        <div className="space-y-4">
          <FormNotice>{done}</FormNotice>
          <p className="text-label text-muted-foreground">When you have the link, open it to choose a new password. It works once and expires after an hour.</p>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          {problem && <FormAlert>{problem}</FormAlert>}
          <FormField label="Email" type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={error} />
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Sending…" : "Ask for a reset link"}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
