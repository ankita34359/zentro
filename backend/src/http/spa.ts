import fs from "node:fs";
import path from "node:path";
import express, { type Express, type NextFunction, type Request, type Response } from "express";

/** Serves the Vite build and falls back to index.html for any GET that is not an /api path (client-side routing). */
export function mountSpa(app: Express, staticDir: string | undefined): void {
  if (!staticDir || !fs.existsSync(path.join(staticDir, "index.html"))) return;
  app.use(express.static(staticDir));
  app.use((req: Request, res: Response, next: NextFunction) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(staticDir, "index.html"));
  });
}
