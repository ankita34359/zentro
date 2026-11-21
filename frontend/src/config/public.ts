/**
 * Non-secret constants only. VITE_* environment values cannot reach the build on Embarko, so anything the
 * browser needs to know at build time lives in this committed file. Never put a key, token or URL with a secret here.
 */
export const publicConfig = {
  appName: "Zentro",
  tagline: "Performance management and intelligence",
  /** How often the header status checks the server, in milliseconds. */
  healthRefreshMs: 60_000,
  /** localStorage keys: non-sensitive UI preferences only. */
  storage: { theme: "zentro.theme" },
} as const;
