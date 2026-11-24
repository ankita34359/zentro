import { RotateCw, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useHealth } from "@/hooks/useHealth";

/** Shown across the top while the server does not answer (or the device is offline). It goes away by itself when the server is back; Retry asks right now. */
export function OfflineBanner() {
  const { isError, isFetching, refetch } = useHealth();
  const [deviceOffline, setDeviceOffline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);
  useEffect(() => {
    const on = () => setDeviceOffline(false);
    const off = () => setDeviceOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  if (!isError && !deviceOffline) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center justify-center gap-3 border-b border-off-track/30 bg-off-track-soft px-4 py-2 text-label text-off-track-ink">
      <WifiOff aria-hidden="true" className="size-4 shrink-0" />
      <span>{deviceOffline ? "You are offline." : "Zentro cannot reach the server."} What you see may be out of date, and changes may not be saved until it is back.</span>
      <Button size="sm" variant="outline" disabled={isFetching} onClick={() => { setDeviceOffline(typeof navigator !== "undefined" && navigator.onLine === false); void refetch(); }}><RotateCw aria-hidden="true" /> Retry</Button>
    </div>
  );
}
