import { apiPlain } from "./api";

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
