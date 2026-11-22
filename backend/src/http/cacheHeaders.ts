import path from "node:path";
import type { NextFunction, Request, Response } from "express";

/** Vite names built files `name-<8 hash characters>.ext`; a changed file always gets a new name. */
const HASHED_ASSET = /-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/i;

export const IMMUTABLE = "public, max-age=31536000, immutable";
/** Cache it, but ask the server before every reuse (a cheap 304 when nothing changed). */
export const REVALIDATE = "no-cache";

/** True for a built file under /assets whose name carries a content hash (safe to cache for a year). */
export function isHashedAsset(urlPath: string): boolean {
  return urlPath.startsWith("/assets/") && HASHED_ASSET.test(path.posix.basename(urlPath));
}

/** express.static `setHeaders` hook: hashed assets are immutable, everything else (index.html, favicon) revalidates. */
export function staticCacheHeaders(res: Response, filePath: string, staticDir: string): void {
  const rel = "/" + path.relative(staticDir, filePath).split(path.sep).join("/");
  res.setHeader("Cache-Control", isHashedAsset(rel) ? IMMUTABLE : REVALIDATE);
}

/** /healthz must always show the current state; it is also the post-deploy probe. */
export function revalidateHealthz(req: Request, res: Response, next: NextFunction): void {
  if (req.path === "/healthz") res.setHeader("Cache-Control", REVALIDATE);
  next();
}
