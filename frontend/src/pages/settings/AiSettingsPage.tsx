import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorState } from "@/components/common/ErrorState";
import { FormAlert } from "@/components/common/FormField";
import { PageHeader } from "@/components/common/PageHeader";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { problemText } from "@/lib/authForm";
import { getAiStatus, setAiEnabled } from "@/services/ai";

/** Settings → AI (administrators): whether the server has an AI key (yes or no, never the value) and the organization's on/off switch. Off by default. */
export default function AiSettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ai", "status"], queryFn: getAiStatus, retry: false });
  const toggle = useMutation({ mutationFn: (on: boolean) => setAiEnabled(on), onSuccess: (s) => qc.setQueryData(["ai", "status"], s) });
  const s = q.data;
  return (
    <>
      <PageHeader eyebrow="System" title="AI settings" description="Whether AI is connected, and whether your organization uses it. AI is off until an administrator switches it on." />
      {q.isPending ? <PageSkeleton /> : q.isError || !s ? <ErrorState title="AI settings could not be loaded" error={q.error} onRetry={() => void q.refetch()} /> : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Connection</CardTitle><CardDescription>Whoever runs the server adds the AI key to the server's own settings. Its value is never shown anywhere in Zentro.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-label">
                <dt className="text-muted-foreground">AI key on the server</dt>
                <dd>{s.keyConfigured ? <Badge variant="onTrack">Set</Badge> : <Badge variant="dashed">Not set</Badge>}</dd>
                <dt className="text-muted-foreground">Your organization</dt>
                <dd>{s.enabledForOrganization ? <Badge variant="onTrack">AI is on</Badge> : <Badge variant="dashed">AI is off</Badge>}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd>{s.connected ? "AI is connected" : "AI is not connected"}</dd>
              </dl>
              {s.reason && <p className="text-caption text-muted-foreground">{s.reason}</p>}
              <div>
                <Button variant={s.enabledForOrganization ? "outline" : "default"} disabled={toggle.isPending} onClick={() => toggle.mutate(!s.enabledForOrganization)}>
                  {s.enabledForOrganization ? "Turn AI off for the organization" : "Turn AI on for the organization"}
                </Button>
              </div>
              {toggle.isError && <FormAlert>{problemText(toggle.error)}</FormAlert>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Limits</CardTitle><CardDescription>Guard rails that keep use and cost predictable.</CardDescription></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-label">
                <dt className="text-muted-foreground">Per person, per day</dt><dd>{s.limits.perUserPerDay} questions (you used {s.usedToday.you})</dd>
                <dt className="text-muted-foreground">Whole organization, per day</dt><dd>{s.limits.perOrganizationPerDay} questions (used {s.usedToday.organization})</dd>
                <dt className="text-muted-foreground">Longest question</dt><dd>{s.limits.maxQuestionChars} characters</dd>
              </dl>
              <p className="mt-3 text-caption text-muted-foreground">Every AI question is recorded in the audit log by its length, the records included and whether it worked. The question and the answer themselves are not stored.</p>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
