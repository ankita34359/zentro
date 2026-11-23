import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, Settings, X } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { SheetRight } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/cn";
import { timeAgo } from "@/lib/format";
import { getInbox, markAllRead, markRead, type NotificationEntry } from "@/services/tasks";

/**
 * The bell in the header (stage 4.5): your unread count, and a panel with your latest notifications. Opening one marks it
 * read and goes to what it is about. The count refreshes every minute and whenever something you do changes it.
 */
export function NotificationBell() {
  const auth = useAuth();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const enabled = Boolean(auth.me?.organization);
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => getInbox({ limit: 25 }), enabled, refetchInterval: 60_000, retry: false });
  const refresh = () => void client.invalidateQueries({ queryKey: ["notifications"] });
  const read = useMutation({ mutationFn: (id: string) => markRead(id), onSuccess: refresh });
  const readAll = useMutation({ mutationFn: markAllRead, onSuccess: refresh });
  if (!enabled) return null;
  const unread = q.data?.unreadCount ?? 0;

  function openEntry(n: NotificationEntry) {
    if (!n.read) read.mutate(n.id);
    setOpen(false);
    if (n.entityType === "task" && n.entityId) navigate(`/my-work?task=${n.entityId}`);
  }
  return (
    <>
      <Button variant="ghost" size="icon" aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"} onClick={() => setOpen(true)} className="relative">
        <Bell aria-hidden="true" />
        {unread > 0 && (
          <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 flex min-w-[1.1rem] items-center justify-center rounded-full bg-off-track-ink px-1 text-[0.65rem] font-semibold leading-[1.1rem] text-background">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Button>
      <SheetRight open={open} onOpenChange={setOpen} title="Notifications" description="Your latest notifications.">
        <header className="flex items-center gap-2 border-b p-4">
          <h2 className="flex-1 text-heading font-semibold">Notifications</h2>
          <Button size="sm" variant="outline" disabled={unread === 0 || readAll.isPending} onClick={() => readAll.mutate()}>
            <CheckCheck aria-hidden="true" /> Mark all read
          </Button>
          <Dialog.Close asChild>
            <Button variant="ghost" size="icon" aria-label="Close notifications">
              <X aria-hidden="true" />
            </Button>
          </Dialog.Close>
        </header>
        <div className="flex-1 p-2">
          {q.isPending ? (
            <div className="space-y-2 p-2" aria-busy="true">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : q.isError ? (
            <p className="p-4 text-label text-muted-foreground">Notifications could not be loaded. Try again in a moment.</p>
          ) : q.data.notifications.length === 0 ? (
            <p className="p-6 text-center text-body text-muted-foreground">Nothing yet. Reminders and updates about your tasks appear here.</p>
          ) : (
            <ul aria-label="Notifications list" className="space-y-1">
              {q.data.notifications.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => openEntry(n)} className={cn("flex w-full gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted", !n.read && "bg-primary-soft/40")}>
                    <span aria-hidden="true" className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : n.severity === "warning" ? "bg-at-risk" : "bg-primary")} />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-body", !n.read && "font-semibold")}>
                        {n.title}
                        {!n.read && <span className="sr-only"> (unread)</span>}
                      </span>
                      {n.body && <span className="block truncate text-label text-muted-foreground">{n.body}</span>}
                      <span className="block text-caption text-muted-foreground">{timeAgo(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <footer className="border-t p-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/settings/notifications" onClick={() => setOpen(false)}>
              <Settings aria-hidden="true" /> Notification settings
            </Link>
          </Button>
        </footer>
      </SheetRight>
    </>
  );
}
