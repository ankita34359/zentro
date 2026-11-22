import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { FormAlert, FormField } from "@/components/common/FormField";
import { Button } from "@/components/ui/button";
import { MIN_PASSWORD_LENGTH, passwordError, problemText } from "@/lib/authForm";
import { AuthLayout } from "@/layouts/AuthLayout";
import { fragmentParam, resetPassword } from "@/services/auth";

/** The link carries the token in the fragment (`#token=...`), which is never sent to a server or written to a log. */
export default function ResetPasswordPage() {
  const { hash } = useLocation();
  const navigate = useNavigate();
  const token = fragmentParam(hash, "token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = { password: passwordError(password), confirm: confirm === password ? undefined : "The two passwords do not match" };
    setErrors(next);
    setProblem(null);
    if (next.password || next.confirm || !token) return;
    setBusy(true);
    try {
      await resetPassword(token, password);
      navigate("/login", { replace: true, state: { passwordReset: true } });
    } catch (err) {
      setProblem(problemText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Choose a new password"
      description="You will be signed out everywhere and asked to sign in with the new password."
      footer={
        <Link to="/login" className="font-medium text-primary-ink underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {!token ? (
        <FormAlert>This reset link is incomplete. Ask your administrator for a new one.</FormAlert>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          {problem && <FormAlert>{problem}</FormAlert>}
          <FormField label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} hint={`At least ${MIN_PASSWORD_LENGTH} characters.`} />
          <FormField label="Repeat the new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Saving…" : "Set new password"}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
