import type { Response } from "express";
import { z } from "zod";
import { sendData } from "../../http/envelope.js";
import type { RouteRegistry } from "../../http/registry.js";
import { unauthenticated } from "../../lib/errors.js";
import { authOf } from "../auth/guards.js";
import type { PermissionService } from "../permissions/service.js";
import { CONFIDENTIALITY, EVIDENCE_TYPES, TARGET_TYPES, VERIFY_STATUSES, type EvidenceInput, type EvidenceService } from "./service.js";

const uuid = z.string().uuid();
const idParams = z.object({ id: uuid });
const link = z.object({ type: z.enum(TARGET_TYPES), id: uuid }).strict();

/** Evidence: links and small files behind tasks, objectives, key results and KPI values (stage 4.3). */
export function registerEvidenceRoutes(registry: RouteRegistry, deps: { permissions: PermissionService; evidence: EvidenceService }): void {
  const { permissions, evidence } = deps;
  const call = <T>(res: Response, fn: (a: NonNullable<ReturnType<typeof authOf>>, r: string, c: ReturnType<typeof permissions.capsOf>) => T): T => {
    res.setHeader("Cache-Control", "no-store");
    const a = authOf(res);
    if (!a) throw unauthenticated();
    return fn(a, String(res.locals.requestId ?? ""), permissions.capsOf(res, a));
  };
  const id = (v: { params: unknown }) => (v.params as { id: string }).id;

  registry.add({
    method: "get",
    path: "/api/evidence",
    access: { kind: "permission", key: "evidence.view" },
    summary: "Evidence the caller may see (their own; confidentiality and `evidence.view` / `evidence.view_restricted` scope decide the rest). Query: `targetType` and `targetId` (the evidence behind one task, objective, key result or KPI value), `mine`",
    schema: { query: z.object({ targetType: z.enum(TARGET_TYPES).optional(), targetId: uuid.optional(), mine: z.enum(["true", "false"]).optional() }) },
    handler: (_req, res, v) => { const q = v.query as { targetType?: string; targetId?: string; mine?: string }; sendData(res, call(res, (a, r, c) => evidence.list(a, r, c, { ...q, mine: q.mine === "true" }))); },
  });
  registry.add({
    method: "post",
    path: "/api/evidence",
    access: { kind: "permission", key: "evidence.submit" },
    takesEntityId: true,
    summary: "Attach evidence: `{title, evidenceType?, description?, externalRef? (a http or https link), occurredOn?, relatedMembershipId? (inside the caller's `evidence.submit` scope), confidentiality?: organization|scope|restricted, links?: [{type: task|objective|key_result|kpi_measurement, id}]}`. Every linked record must exist here and be visible to the caller (404 otherwise). Restricted needs `evidence.view_restricted`. Audited",
    schema: { body: z.object({ title: z.string().min(1).max(200), evidenceType: z.enum(EVIDENCE_TYPES).optional(), description: z.string().max(2000).optional(), externalRef: z.string().max(500).nullable().optional(), occurredOn: z.string().max(10).optional(), relatedMembershipId: uuid.nullable().optional(), confidentiality: z.enum(CONFIDENTIALITY).optional(), links: z.array(link).max(10).optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => evidence.create(a, r, c, v.body as EvidenceInput)), 201),
  });
  registry.add({
    method: "get",
    path: "/api/evidence/:id",
    access: { kind: "permission", key: "evidence.view" },
    takesEntityId: true,
    summary: "One piece of evidence with its links, file details and verification. Not visible to the caller, missing, or another organization's: 404",
    schema: { params: idParams },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => evidence.one(a, r, c, id(v)))),
  });
  registry.add({
    method: "post",
    path: "/api/evidence/:id/links",
    access: { kind: "permission", key: "evidence.submit" },
    takesEntityId: true,
    summary: "Link more records to evidence you attached: `{type, id}`. The record must be visible to you. Audited",
    schema: { params: idParams, body: link },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => evidence.addLink(a, r, c, id(v), v.body as { type: string; id: string })), 201),
  });
  registry.add({
    method: "post",
    path: "/api/evidence/:id/verify",
    access: { kind: "permission", key: "evidence.verify" },
    takesEntityId: true,
    summary: "Verify, reject or ask for more information: `{status: verified|rejected|needs_info, note?}` (a note is required unless verifying). The person it is about (or who attached it) must be inside the caller's `evidence.verify` scope; nobody verifies their own evidence (403 self_verification). Audited",
    schema: { params: idParams, body: z.object({ status: z.enum(VERIFY_STATUSES), note: z.string().max(1000).optional() }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => evidence.verify(a, r, c, id(v), v.body as { status: string; note?: string }))),
  });
  registry.add({
    method: "post",
    path: "/api/evidence/:id/file",
    access: { kind: "permission", key: "evidence.submit" },
    takesEntityId: true,
    summary: "Add the one small file of your evidence: `{filename, dataBase64}`. png, jpg, pdf, txt, csv or md; at most 2 MB a file and 100 MB for the organization (413). Stored in the database, not on a public link. Audited",
    schema: { params: idParams, body: z.object({ filename: z.string().min(1).max(120), dataBase64: z.string().min(1).max(3_000_000) }).strict() },
    handler: (_req, res, v) => sendData(res, call(res, (a, r, c) => evidence.attachFile(a, r, c, id(v), v.body as { filename: string; dataBase64: string })), 201),
  });
  registry.add({
    method: "get",
    path: "/api/evidence/:id/file",
    access: { kind: "permission", key: "evidence.view" },
    takesEntityId: true,
    summary: "Download the file, after the same visibility check as the evidence (404 when not visible or from another organization). Sent as an attachment with its stored type and `nosniff`",
    schema: { params: idParams },
    handler: (_req, res, v) => {
      const f = call(res, (a, r, c) => evidence.download(a, r, c, id(v)));
      res.setHeader("Content-Type", f.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${f.filename}"`);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Length", String(f.data.length));
      res.status(200).end(f.data);
    },
  });
}
