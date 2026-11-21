import type { LogLevel } from "../lib/logger.js";

export interface Config {
  sessionSecret: string;
  encryptionKey: string;
  appUrl: string | undefined;
  logLevel: LogLevel;
  trustProxy: number;
  nodeEnv: string;
}

export type ConfigResult =
  | { ok: true; config: Config }
  | { ok: false; missing: string[]; invalid: { name: string; reason: string }[] };

/** Settings the server cannot run without. The owner types these on Embarko's App setup page. */
export const REQUIRED_SETTINGS = ["SESSION_SECRET", "ENCRYPTION_KEY"] as const;

const MIN_SECRET_LENGTH = 32;
const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

/**
 * Reads and checks the environment. Only NAMES and fixed reasons are ever reported: a value
 * (even a wrong one) is never copied into a message, a log line or a page.
 */
export function loadConfig(env: NodeJS.ProcessEnv): ConfigResult {
  const missing: string[] = [];
  const invalid: { name: string; reason: string }[] = [];

  for (const name of REQUIRED_SETTINGS) {
    const v = env[name];
    if (v === undefined || v.trim() === "") missing.push(name);
    else if (v.length < MIN_SECRET_LENGTH) invalid.push({ name, reason: `must be at least ${MIN_SECRET_LENGTH} characters` });
  }
  const sessionSecret = env.SESSION_SECRET ?? "";
  const encryptionKey = env.ENCRYPTION_KEY ?? "";
  if (sessionSecret && encryptionKey && sessionSecret === encryptionKey) {
    invalid.push({ name: "ENCRYPTION_KEY", reason: "must differ from SESSION_SECRET" });
  }

  let appUrl: string | undefined;
  if (env.APP_URL && env.APP_URL.trim() !== "") {
    try {
      const u = new URL(env.APP_URL.trim());
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("scheme");
      appUrl = u.origin; // drops any trailing slash or path
    } catch {
      invalid.push({ name: "APP_URL", reason: "must be a full web address such as https://zentro.embarko.app" });
    }
  }

  let logLevel: LogLevel = "info";
  if (env.LOG_LEVEL && env.LOG_LEVEL.trim() !== "") {
    const l = env.LOG_LEVEL.trim().toLowerCase() as LogLevel;
    if (LEVELS.includes(l)) logLevel = l;
    else invalid.push({ name: "LOG_LEVEL", reason: "must be debug, info, warn or error" });
  }

  let trustProxy = 1;
  if (env.TRUST_PROXY && env.TRUST_PROXY.trim() !== "") {
    const n = Number(env.TRUST_PROXY);
    if (Number.isInteger(n) && n >= 0 && n <= 10) trustProxy = n;
    else invalid.push({ name: "TRUST_PROXY", reason: "must be a whole number from 0 to 10" });
  }

  if (missing.length > 0 || invalid.length > 0) return { ok: false, missing, invalid };
  return {
    ok: true,
    config: { sessionSecret, encryptionKey, appUrl, logLevel, trustProxy, nodeEnv: env.NODE_ENV ?? "development" },
  };
}

/** The sentence shown on the holding page and in the 503 answer. Names only. */
export function describeProblem(r: Extract<ConfigResult, { ok: false }>): string {
  const parts: string[] = [];
  if (r.missing.length > 0) parts.push(`Server is missing: ${r.missing.join(", ")}`);
  if (r.invalid.length > 0) {
    parts.push(`Server has invalid settings: ${r.invalid.map((i) => `${i.name} (${i.reason})`).join(", ")}`);
  }
  return parts.join(". ");
}
