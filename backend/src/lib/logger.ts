export type LogLevel = "debug" | "info" | "warn" | "error";
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Field names whose values are never written to the log, whatever they contain. */
const SENSITIVE = /secret|token|password|passwd|authorization|cookie|key|email|url|webhook|credential|registration/i;

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

function clean(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = SENSITIVE.test(k) ? "[redacted]" : v;
  return out;
}

/** Terse JSON lines to stdout (Embarko keeps only ~8 KB of recent log per stream). Never pass request bodies. */
export function createLogger(
  level: LogLevel = "info",
  write: (line: string) => void = (l) => process.stdout.write(l + "\n"),
  base: Record<string, unknown> = {},
): Logger {
  const emit = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[lvl] < ORDER[level]) return;
    write(JSON.stringify({ level: lvl, time: new Date().toISOString(), msg, ...clean({ ...base, ...fields }) }));
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (fields) => createLogger(level, write, { ...base, ...fields }),
  };
}

export const silentLogger: Logger = createLogger("error", () => undefined);
