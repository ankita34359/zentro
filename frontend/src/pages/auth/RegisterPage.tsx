import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { FormAlert, FormField } from "@/components/common/FormField";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { emailError, MIN_PASSWORD_LENGTH, passwordError, problemText } from "@/lib/authForm";
import { AuthLayout } from "@/layouts/AuthLayout";
import { register } from "@/services/auth";

export default function RegisterPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", registrationCode: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (auth.status === "ready" || auth.status === "needsOnboarding") return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = {
      name: form.name.trim() ? undefined : "Enter your name",
      email: emailError(form.email),
      password: passwordError(form.password),
      registrationCode: form.registrationCode.trim() ? undefined : "Enter the registration code",
    };
    setErrors(next);
    setProblem(null);
    if (Object.values(next).some(Boolean)) return;
    setBusy(true);
    try {
      await register({ name: form.name.trim(), email: form.email.trim(), password: form.password, registrationCode: form.registrationCode.trim() });
      navigate("/login", { replace: true, state: { registered: true } });
    } catch (err) {
      setProblem(problemText(err));
      setForm((f) => ({ ...f, password: "" }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      description="Registration needs the code you were given."
      footer={
        <>
          Already have an account? <Link to="/login" className="font-medium text-primary-ink underline-offset-4 hover:underline">Sign in</Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {problem && <FormAlert>{problem}</FormAlert>}
        <FormField label="Your name" autoComplete="name" value={form.name} onChange={set("name")} error={errors.name} />
        <FormField label="Email" type="email" autoComplete="username" inputMode="email" value={form.email} onChange={set("email")} error={errors.email} />
        <FormField
          label="Password"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={set("password")}
          error={errors.password}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        />
        <FormField label="Registration code" autoComplete="off" spellCheck={false} value={form.registrationCode} onChange={set("registrationCode")} error={errors.registrationCode} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthLayout>
  );
}
