import { CheckCircle2, CircleAlert, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useHealth } from "@/hooks/useHealth";

/** Header indicator fed by the real /healthz answer. Always an icon plus words, never colour alone. */
export function StatusPill() {
  const { data, isPending, isError } = useHealth();
  if (isPending) return <Skeleton className="h-6 w-20 rounded-full" />;
  if (isError || !data) {
    return (
      <Badge variant="offTrack" title="The server did not answer">
        <WifiOff aria-hidden="true" /> Offline
      </Badge>
    );
  }
  if (!data.ready) {
    return (
      <Badge variant="atRisk" title="The server is running but its settings are incomplete">
        <CircleAlert aria-hidden="true" /> Setup incomplete
      </Badge>
    );
  }
  return (
    <Badge variant="onTrack" title={`Server ready, version ${data.version}`} className="gap-1.5">
      <span className="pulse-dot" aria-hidden="true" /> Online
    </Badge>
  );
}
