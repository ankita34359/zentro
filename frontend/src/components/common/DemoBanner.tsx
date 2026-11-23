import { useQueryClient } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { problemText } from "@/lib/authForm";
import { stopViewing } from "@/services/demo";
import type { Me } from "@/services/auth";

/** After the session changes (view as, or back), nothing cached belongs to the new person: reset it all except who is signed in. */
export function useSwitchedSession() {
  const client = useQueryClient();
  return (me: Me | null) => {
    client.setQueryData(["auth", "me"], me);
    void client.resetQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
  };
}

/**
 * A banner on every page while an administrator views as a demo person: who they are looking at, that nothing can be
 * changed, and the way back. The server enforces the read-only rule; this only says so.
 */
export function DemoBanner() {
  const { me } = useAuth();
  const switched = useSwitchedSession();
  const navigate = useNavigate();
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const v = me?.viewingAs;
  if (!v) return null;
  async function stop() {
    setBusy(true);
    try {
      const r = await stopViewing();
      switched("signedOut" in r ? null : r);
      navigate("signedOut" in r ? "/login" : "/settings/demo", { replace: true });
    } catch (e) {
      setProblem(problemText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 border-b border-at-risk/40 bg-at-risk-soft px-4 py-2 text-label text-at-risk-ink sm:px-6">
      <Eye aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        You are viewing as <strong>{v.personName}</strong> (demo data). This view is read only: nothing you click here can change anything.
        {problem && <span className="ml-2 font-medium"> {problem}</span>}
      </span>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void stop()}>
        {busy ? "Going back…" : "Stop viewing"}
      </Button>
    </div>
  );
}
