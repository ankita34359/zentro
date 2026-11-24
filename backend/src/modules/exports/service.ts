import type { TenantCtx } from "../../db/tenant.js";
import { toCsv } from "../../lib/csv.js";
import { HttpError } from "../../lib/errors.js";
import { RateLimiter } from "../../lib/rateLimit.js";
import { makeZip } from "../../lib/zip.js";
import type { AuditService } from "../audit/service.js";
import type { AuthStore } from "../auth/repositories/store.js";
import type { AuthContext, AuthService } from "../auth/service.js";
import type { Capabilities } from "../permissions/service.js";
import { EXPORT_TABLES } from "./repositories/export.js";

export const EXCLUDED_FROM_EXPORT = [
  "password hashes, sign-in sessions, invitation and reset tokens, API keys and other secrets",
  "private review notes (reviews are not exported)",
  "restricted evidence, evidence files, and the links and verification notes of evidence",
  "the inputs and explanations behind scores",
  "any other organization's data",
] as const;

/** "Export all data": the signed-in organization's own records as a zip of CSV files. Administrators only (`org.settings`); every export is audited. */
export class ExportService {
  /** A person may export a few times an hour: it reads every table. */
  private readonly limiter = new RateLimiter({ max: 6, windowMs: 60 * 60_000, blockMs: 10 * 60_000, maxBlockMs: 60 * 60_000 });
  constructor(private readonly o: { store: AuthStore; auth: AuthService; audit: AuditService }) {}

  build(auth: AuthContext, requestId: string, caps: Capabilities): { filename: string; zip: Buffer; files: { name: string; rows: number }[] } {
    if (!caps.has("org.settings")) throw new HttpError(403, "permission_denied", "Only an administrator can export the organization's data.");
    const ctx: TenantCtx = this.o.auth.tenantCtx(auth, requestId);
    const wait = this.limiter.retryAfterMs(ctx.membershipId);
    if (wait > 0) throw this.o.auth.tooMany(wait);
    this.limiter.fail(ctx.membershipId);
    const tdb = this.o.store.tenant(ctx);
    const repo = this.o.store.exports(tdb);
    const org = this.o.store.orgs.findById(ctx.organizationId);
    const now = new Date(this.o.auth.iso());
    const files: { name: string; data: Buffer; rows: number }[] = [];
    for (const t of EXPORT_TABLES) {
      const rows = repo.rows(t);
      files.push({ name: t.file, data: Buffer.from(toCsv(t.columns, rows), "utf8"), rows: rows.length });
    }
    const readme = [
      `Zentro export of "${org?.name ?? "your organization"}"`,
      `Made on ${now.toISOString()} (UTC) by an administrator of this organization.`,
      "",
      "Each CSV file is one table: the first line holds the column names. Rows that belong to the demo company have is_demo = 1.",
      "",
      "Files and row counts:",
      ...files.map((f) => `  ${f.name}: ${f.rows}`),
      "",
      "Not included, on purpose:",
      ...EXCLUDED_FROM_EXPORT.map((e) => `  - ${e}`),
      "",
    ].join("\r\n");
    const all = [...files.map((f) => ({ name: f.name, data: f.data })), { name: "README.txt", data: Buffer.from(readme, "utf8") }];
    const list = files.map((f) => ({ name: f.name, rows: f.rows }));
    this.o.store.transaction(() => {
      this.o.audit.record(tdb, ctx, { action: "data.export", entityType: "organization", entityId: ctx.organizationId, summary: `Exported the organization's data (${files.length} files)`, after: { files: list } });
    });
    const slug = (org?.slug ?? "organization").replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "organization";
    return { filename: `zentro-export-${slug}-${now.toISOString().slice(0, 10)}.zip`, zip: makeZip(all, now), files: list };
  }
}
