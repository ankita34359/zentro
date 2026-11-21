import { CheckCircle2, CircleAlert, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useHealth } from "@/hooks/useHealth";

/** Header indicator fed by the real /healthz answer. Always an icon plus words, never color alone. */
export function StatusPill() {
  const { data, isPending, isError } = useHealth();
  if (isPending) return <Skeleton className="h-6 w-20 rounded-full" />;
  if (isError || !data) {
    return (
      <Badge variant="destructive" title="The server did not answer">
        <WifiOff aria-hidden="true" /> Offline
      </Badge>
    );
  }
  if (!data.ready) {
    return (
      <Badge variant="warning" title="The server is running but its settings are incomplete">
        <CircleAlert aria-hidden="true" /> Setup incomplete
      </Badge>
    );
  }
  return (
    <Badge variant="success" title={`Server ready, version ${data.version}`}>
      <CheckCircle2 aria-hidden="true" /> Online
    </Badge>
  );
}
