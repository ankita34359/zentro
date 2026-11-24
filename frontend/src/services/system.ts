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

export interface ExportInfo { files: string[]; excluded: string[] }
export const getExportInfo = () => api<ExportInfo>("/api/export");
/** Asks for the export and returns the zip as a file the browser can save. A refusal comes back as the server's plain message. */
export async function downloadExport(): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch("/api/export", { method: "POST", credentials: "same-origin", headers: { Accept: "application/zip" } });
  if (!res.ok) {
    let message = "The export could not be made. Try again.";
    try { const j = (await res.json()) as { error?: { message?: string } }; if (j.error?.message) message = j.error.message; } catch { /* keep the plain message */ }
    throw new Error(message);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "zentro-export.zip";
  return { blob: await res.blob(), filename: name };
}
