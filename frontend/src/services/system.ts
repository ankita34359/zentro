import { api, apiPlain } from "./api";

export interface Health {
  ok: boolean;
  ready: boolean;
  version: string;
  node: string;
  migrations: { applied: number; total: number } | null;
  lastTick: { startedAt: string; finishedAt: string | null; status: string } | null;
  missing?: string[];
}

export const getHealth = (signal?: AbortSignal) => apiPlain<Health>("/healthz", { signal });

export interface SystemView {
  version: string; node: string;
  migrations: { applied: number; total: number };
  database: { sizeBytes: number };
  backups: {
    count: number; daily: { count: number; keep: number }; preMigration: { count: number };
    newest: { name: string; sizeBytes: number; at: string } | null;
    files: { name: string; kind: "daily" | "pre-migration"; sizeBytes: number; at: string }[];
    lastRun: { startedAt: string; finishedAt: string | null; status: string; error: string | null } | null;
    location: string; warning: string;
  };
  jobs: { name: string; startedAt: string; finishedAt: string | null; status: string; error: string | null }[];
  lastTick: { startedAt: string; finishedAt: string | null; status: string } | null;
}
export const getSystem = () => api<SystemView>("/api/system");
