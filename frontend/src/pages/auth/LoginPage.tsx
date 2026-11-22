import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { FormAlert, FormField, FormNotice } from "@/components/common/FormField";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { emailError, problemText } from "@/lib/authForm";
import { AuthLayout } from "@/layouts/AuthLayout";

export default function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { from?: string; registered?: boolean } | null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (auth.status === "ready" || auth.status === "needsOnboarding") return <Navigate to={state?.from ?? "/"} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = { email: emailError(email), password: password ? undefined : "Enter your password" };
    setErrors(next);
    setProblem(null);
    if (next.email || next.password) return;
    setBusy(true);
    try {
      await auth.login(email.trim(), password);
      navigate(state?.from ?? "/", { replace: true });
    } catch (err) {
      setProblem(problemText(err));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      description="Welcome back. Sign in to see your organization."
      footer={
        <>
          New here? <Link to="/register" className="font-medium text-primary-ink underline-offset-4 hover:underline">Create an account</Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {state?.registered && <FormNotice>Account created. Sign in with your email and password.</FormNotice>}
        {problem && <FormAlert>{problem}</FormAlert>}
        <FormField label="Email" type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <FormField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthLayout>
  );
}
