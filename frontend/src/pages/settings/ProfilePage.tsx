import { useState, type FormEvent } from "react";
import { FormAlert, FormField, FormNotice } from "@/components/common/FormField";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { MIN_PASSWORD_LENGTH, passwordError, problemText } from "@/lib/authForm";
import { changePassword } from "@/services/auth";

/** Settings → Profile: who you are, and change your own password. */
export default function ProfilePage() {
  const { me } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs = {
      current: current ? undefined : "Enter your current password",
      next: passwordError(next),
      confirm: confirm === next ? undefined : "The two passwords do not match",
    };
    setErrors(errs);
    setProblem(null);
    setDone(false);
    if (errs.current || errs.next || errs.confirm) return;
    setBusy(true);
    try {
      await changePassword(current, next);
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setProblem(problemText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Settings" title="Profile" description="Your account and your password." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card lift={false}>
          <CardHeader>
            <CardTitle>Your account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-body">
            <p className="font-medium">{me?.user.name}</p>
            <p className="text-muted-foreground">{me?.user.email}</p>
            <p className="text-muted-foreground">{me?.organization?.name}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              {me?.roles.map((r) => (
                <Badge key={r} variant="primary">
                  {r === "owner" ? "Owner" : r}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card lift={false}>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>You stay signed in here. Every other device is signed out.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} noValidate className="space-y-4">
              {done && <FormNotice>Password changed. Other devices were signed out.</FormNotice>}
              {problem && <FormAlert>{problem}</FormAlert>}
              <FormField label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} error={errors.current} />
              <FormField label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={errors.next} hint={`At least ${MIN_PASSWORD_LENGTH} characters.`} />
              <FormField label="Repeat the new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Change password"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
