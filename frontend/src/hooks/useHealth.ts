import { useQuery } from "@tanstack/react-query";
import { publicConfig } from "@/config/public";
import { getHealth } from "@/services/system";

/** Server health for the header status and the sidebar version. Real data from /healthz, refreshed every minute. */
export function useHealth() {
  return useQuery({
    queryKey: ["system", "health"],
    queryFn: ({ signal }) => getHealth(signal),
    refetchInterval: publicConfig.healthRefreshMs,
    retry: false,
  });
}
