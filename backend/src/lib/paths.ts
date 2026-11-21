import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Walk up from this file to the folder holding package.json (works from backend/src and from build/backend/src). */
export function findProjectRoot(fromUrl: string = import.meta.url): string {
  let dir = path.dirname(fileURLToPath(fromUrl));
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate the project root (package.json)");
}
