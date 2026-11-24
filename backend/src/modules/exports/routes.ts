import type { Response } from "express";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { unauthenticated } from "../../lib/errors.js";
import { authOf } from "../auth/guards.js";
import type { PermissionService } from "../permissions/service.js";
import { EXCLUDED_FROM_EXPORT, type ExportService } from "./service.js";
import { EXPORT_TABLES } from "./repositories/export.js";

/** Settings → Export all data (administrators only). */
export function registerExportRoutes(registry: RouteRegistry, deps: { permissions: PermissionService; exports: ExportService }): void {
  const me = (res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const a = authOf(res);
    if (!a) throw unauthenticated();
    return { a, r: String(res.locals.requestId ?? ""), c: deps.permissions.capsOf(res, a) };
  };
  registry.add({
    method: "get",
    path: "/api/export",
    access: { kind: "permission", key: "org.settings" },
    summary: "What an export holds: the files it will contain and what is left out on purpose. Nothing is exported by this call",
    handler: (_req, res) => { me(res); sendData(res, { files: EXPORT_TABLES.map((t) => t.file), excluded: EXCLUDED_FROM_EXPORT }); },
  });
  registry.add({
    method: "post",
    path: "/api/export",
    access: { kind: "permission", key: "org.settings" },
    summary: "Download the signed-in organization's own data as a zip of CSV files (people, teams, objectives, key results, KPIs and values, tasks, evidence records without files, scores). Never password hashes, sessions, tokens, keys, private review notes, restricted evidence or another organization's data. Audited with the file names and row counts. At most 6 an hour per person",
    handler: (_req, res) => {
      const { a, r, c } = me(res);
      const out = deps.exports.build(a, r, c);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Export-Files", String(out.files.length));
      res.send(out.zip);
    },
  });
}
