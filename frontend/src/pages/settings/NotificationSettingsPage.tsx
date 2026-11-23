import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorState } from "@/components/common/ErrorState";
import { FormAlert, FormNotice } from "@/components/common/FormField";
import { PageHeader } from "@/components/common/PageHeader";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { Card } from "@/components/ui/card";
import { problemText } from "@/lib/authForm";
import { getPreferences, savePreferences } from "@/services/tasks";
import { useState } from "react";

/** Settings → Notifications: switch each kind of in-app notification on or off. Saved as you click. */
export default function NotificationSettingsPage() {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["preferences"], queryFn: getPreferences, retry: false });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (v: { type: string; inApp: boolean }) => savePreferences([v]),
    onSuccess: (data) => {
      setError(null);
      setSaved(true);
      client.setQueryData(["preferences"], data);
    },
    onError: (e) => {
      setSaved(false);
      setError(problemText(e));
    },
  });
  return (
    <>
      <PageHeader eyebrow="Settings" title="Notifications" description="Choose which things reach the bell in the header. Reminders about tasks that are due or overdue are sent by the system every few minutes." />
      {q.isPending ? <PageSkeleton /> : q.isError ? <ErrorState title="Your settings could not be loaded" error={q.error} onRetry={() => void q.refetch()} /> : (
        <Card lift={false} className="p-0">
          {error && <div className="p-4"><FormAlert>{error}</FormAlert></div>}
          {saved && !error && <div className="p-4"><FormNotice>Saved.</FormNotice></div>}
          <ul aria-label="Kinds of notification" className="divide-y">
            {q.data.types.map((t) => (
              <li key={t.type} className="flex items-center justify-between gap-4 px-5 py-4">
                <label htmlFor={`pref-${t.type}`} className="min-w-0 flex-1 cursor-pointer">
                  <span className="block text-body font-medium">{t.label}</span>
                  <span className="block text-label text-muted-foreground">{t.description}</span>
                </label>
                <input id={`pref-${t.type}`} type="checkbox" className="size-5" checked={t.inApp} disabled={save.isPending} onChange={(e) => save.mutate({ type: t.type, inApp: e.target.checked })} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
