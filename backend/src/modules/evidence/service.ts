import { createHash } from "node:crypto";
import type { TenantCtx, TenantDb } from "../../db/tenant.js";
import { HttpError, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { RateLimiter } from "../../lib/rateLimit.js";
import type { AuditService } from "../audit/service.js";
import type { AuthStore } from "../auth/repositories/store.js";
import type { AuthContext, AuthService } from "../auth/service.js";
import type { OkrService } from "../okr/service.js";
import type { Capabilities } from "../permissions/service.js";
import { todayIn } from "../tasks/dates.js";
import type { TaskService } from "../tasks/service.js";
import type { EvidenceRow } from "./repositories/evidence.js";
import { evidenceVisible } from "./visibility.js";

export const EVIDENCE_TYPES = ["task_completion", "milestone", "pull_request", "deployment", "sales_record", "crm_update", "customer_feedback", "document", "report", "meeting_outcome", "delivery_record", "kpi_measurement", "manager_feedback", "other"] as const;
export const CONFIDENTIALITY = ["organization", "scope", "restricted"] as const;
export const TARGET_TYPES = ["task", "objective", "key_result", "kpi_measurement"] as const;
export const VERIFY_STATUSES = ["verified", "rejected", "needs_info"] as const;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_ORG_BYTES = 100 * 1024 * 1024;
const FILE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", pdf: "application/pdf", txt: "text/plain", csv: "text/csv", md: "text/markdown" };
const isDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export interface EvidenceView {
  id: string;
  type: string;
  title: string;
  description: string;
  externalRef: string | null;
  about: { id: string; name: string } | null;
  submittedBy: { id: string; name: string };
  occurredOn: string;
  verification: { status: string; by: { id: string; name: string } | null; at: string | null; note: string | null };
  confidentiality: string;
  file: { filename: string; contentType: string; sizeBytes: number } | null;
  links: { type: string; id: string }[];
  isDemo: boolean;
  can: { verify: boolean; attachFile: boolean; withdraw: boolean };
}
export interface EvidenceInput { title: string; evidenceType?: string; description?: string; externalRef?: string | null; occurredOn?: string; relatedMembershipId?: string | null; confidentiality?: string; links?: { type: string; id: string }[] }

/**
 * Evidence (stage 4.3): links and small files that support a task, an objective, a key result or a KPI value. Who may see an item
 * follows its confidentiality and the person it is about; nobody verifies their own evidence; a file is served only by an
 * authenticated route that re-runs the same check, and another organization's file is "not found".
 */
export class EvidenceService {
  /** File uploads per person: every attempt counts (20 in 10 minutes), because a file is the one thing a person can make the server store in bulk. */
  private readonly uploads = new RateLimiter({ max: 20, windowMs: 10 * 60_000, blockMs: 5 * 60_000, maxBlockMs: 60 * 60_000 });
  constructor(private readonly o: { store: AuthStore; auth: AuthService; audit: AuditService; tasks: TaskService; okr: OkrService }) {}

  private ctx(auth: AuthContext, requestId: string): TenantCtx {
    return this.o.auth.tenantCtx(auth, requestId);
  }
  private now = (): string => this.o.auth.iso();
  private world(ctx: TenantCtx) {
    const tdb = this.o.store.tenant(ctx);
    const people = this.o.store.people(tdb);
    const org = this.o.store.orgs.findById(ctx.organizationId);
    return { tdb, repo: this.o.store.evidence(tdb), names: new Map(people.people().map((p) => [p.id, p.display_name])), today: todayIn(org?.timezone ?? "UTC", new Date(this.now())) };
  }
  private who(w: ReturnType<EvidenceService["world"]>, id: string | null): { id: string; name: string } | null {
    return id ? { id, name: w.names.get(id) ?? "Former member" } : null;
  }
  private covers(caps: Capabilities, key: string, subject: string): boolean {
    const s = caps.scope(key);
    return s.all || s.members.has(subject);
  }

  private view(w: ReturnType<EvidenceService["world"]>, caps: Capabilities, me: string, e: EvidenceRow, files: Map<string, { filename: string; content_type: string; size_bytes: number }>, links: Map<string, { type: string; id: string }[]>): EvidenceView {
    const subject = e.related_membership_id ?? e.submitted_by_membership_id;
    const f = files.get(e.id);
    return {
      id: e.id, type: e.evidence_type, title: e.title, description: e.description, externalRef: e.external_ref, about: this.who(w, e.related_membership_id), submittedBy: this.who(w, e.submitted_by_membership_id)!, occurredOn: e.occurred_on,
      verification: { status: e.verification_status, by: this.who(w, e.verified_by_membership_id), at: e.verified_at, note: e.verification_note }, confidentiality: e.confidentiality,
      file: f ? { filename: f.filename, contentType: f.content_type, sizeBytes: f.size_bytes } : null, links: links.get(e.id) ?? [], isDemo: e.is_demo === 1,
      can: { verify: caps.has("evidence.verify") && this.covers(caps, "evidence.verify", subject) && e.submitted_by_membership_id !== me, attachFile: e.submitted_by_membership_id === me && !f, withdraw: e.submitted_by_membership_id === me && e.verification_status === "unverified" },
    };
  }
  private maps(w: ReturnType<EvidenceService["world"]>) {
    return { files: new Map(w.repo.files().map((f) => [f.evidence_id, f])), links: w.repo.links().reduce((m, l) => m.set(l.evidence_id, [...(m.get(l.evidence_id) ?? []), { type: l.target_type, id: l.target_id }]), new Map<string, { type: string; id: string }[]>()) };
  }

  list(auth: AuthContext, requestId: string, caps: Capabilities, q: { targetType?: string; targetId?: string; mine?: boolean }): EvidenceView[] {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const { files, links } = this.maps(w);
    return w.repo.all()
      .filter((e) => evidenceVisible(caps, ctx.membershipId, e) && (!q.mine || e.submitted_by_membership_id === ctx.membershipId) && (!q.targetType || !q.targetId || (links.get(e.id) ?? []).some((l) => l.type === q.targetType && l.id === q.targetId)))
      .map((e) => this.view(w, caps, ctx.membershipId, e, files, links));
  }
  private find(w: ReturnType<EvidenceService["world"]>, caps: Capabilities, me: string, id: string): EvidenceRow {
    const e = w.repo.one(id);
    if (!e || !evidenceVisible(caps, me, e)) throw notFound();
    return e;
  }
  one(auth: AuthContext, requestId: string, caps: Capabilities, id: string): EvidenceView {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const { files, links } = this.maps(w);
    return this.view(w, caps, ctx.membershipId, this.find(w, caps, ctx.membershipId, id), files, links);
  }

  /** A target must exist in this organization AND be one the caller may see (404 otherwise, so another organization's ids say nothing). */
  private checkTarget(auth: AuthContext, requestId: string, caps: Capabilities, w: ReturnType<EvidenceService["world"]>, t: { type: string; id: string }): void {
    if (!(TARGET_TYPES as readonly string[]).includes(t.type)) throw new HttpError(400, "invalid_value", `Evidence can support: ${TARGET_TYPES.join(", ")}.`);
    if (t.type === "task") this.o.tasks.detail(auth, requestId, caps, t.id);
    else if (t.type === "objective") this.o.okr.detail(auth, requestId, caps, t.id);
    else if (t.type === "key_result") {
      const kr = this.o.store.okr(w.tdb).keyResult(t.id);
      if (!kr) throw notFound();
      this.o.okr.detail(auth, requestId, caps, kr.objective_id);
    } else if (!this.o.store.kpi(w.tdb).measurement(t.id)) throw notFound();
  }

  create(auth: AuthContext, requestId: string, caps: Capabilities, input: EvidenceInput): EvidenceView {
    if (!caps.has("evidence.submit")) throw new HttpError(403, "permission_denied", "You cannot attach evidence.");
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const me = ctx.membershipId;
    const title = (input.title ?? "").trim();
    if (title.length < 1 || title.length > 200) throw new HttpError(400, "invalid_title", "A title is 1 to 200 characters.");
    const type = input.evidenceType ?? "other";
    if (!(EVIDENCE_TYPES as readonly string[]).includes(type)) throw new HttpError(400, "invalid_value", "That kind of evidence does not exist.");
    const level = input.confidentiality ?? "scope";
    if (!(CONFIDENTIALITY as readonly string[]).includes(level)) throw new HttpError(400, "invalid_value", "Confidentiality is organization, scope or restricted.");
    const description = (input.description ?? "").trim();
    if (description.length > 2000) throw new HttpError(400, "invalid_text", "The description is at most 2000 characters.");
    const ref = (input.externalRef ?? "").trim() || null;
    if (ref !== null && (ref.length > 500 || !/^https?:\/\/\S+$/i.test(ref))) throw new HttpError(400, "invalid_link", "A link starts with http:// or https://.");
    const occurredOn = input.occurredOn ?? w.today;
    if (!isDay(occurredOn) || occurredOn > w.today) throw new HttpError(400, "invalid_date", "Give a real date that is not in the future.");
    const about = input.relatedMembershipId ?? null;
    if (about !== null) {
      if (!w.names.has(about)) throw notFound();
      if (about !== me && !this.covers(caps, "evidence.submit", about)) throw new HttpError(403, "outside_scope", "You can attach evidence about people inside your scope.");
    }
    if (level === "restricted" && !caps.has("evidence.view_restricted")) throw new HttpError(403, "permission_denied", "Marking evidence restricted needs permission to see restricted evidence.");
    const links = input.links ?? [];
    if (links.length > 10) throw new HttpError(400, "too_many", "Link at most 10 records.");
    for (const l of links) this.checkTarget(auth, requestId, caps, w, l);
    const id = newId();
    const now = this.now();
    this.o.store.transaction(() => {
      w.repo.insert({ id, type, title, description, source: "manual", externalRef: ref, relatedId: about, occurredOn, by: me, confidentiality: level, now });
      for (const l of links) w.repo.insertLink({ id: newId(), evidenceId: id, type: l.type, targetId: l.id, now });
      this.o.audit.record(w.tdb, ctx, { action: "evidence.create", entityType: "evidence", entityId: id, summary: `Attached evidence "${title}" (${type.replace(/_/g, " ")}, ${level})${links.length ? ` to ${links.length} ${links.length === 1 ? "record" : "records"}` : ""}`, after: { type, confidentiality: level, links: links.length } });
    });
    return this.one(auth, requestId, caps, id);
  }

  addLink(auth: AuthContext, requestId: string, caps: Capabilities, id: string, link: { type: string; id: string }): EvidenceView {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const e = this.find(w, caps, ctx.membershipId, id);
    if (e.submitted_by_membership_id !== ctx.membershipId) throw new HttpError(403, "permission_denied", "Only the person who attached it can link more records.");
    this.checkTarget(auth, requestId, caps, w, link);
    this.o.store.transaction(() => {
      if (w.repo.insertLink({ id: newId(), evidenceId: id, type: link.type, targetId: link.id, now: this.now() })) this.o.audit.record(w.tdb, ctx, { action: "evidence.link", entityType: "evidence", entityId: id, summary: `Linked evidence "${e.title}" to a ${link.type.replace(/_/g, " ")}`, after: link });
    });
    return this.one(auth, requestId, caps, id);
  }

  verify(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: { status: string; note?: string }): EvidenceView {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const e = this.find(w, caps, ctx.membershipId, id);
    const subject = e.related_membership_id ?? e.submitted_by_membership_id;
    if (!caps.has("evidence.verify") || !this.covers(caps, "evidence.verify", subject)) throw new HttpError(403, "permission_denied", "You cannot verify this evidence.");
    if (e.submitted_by_membership_id === ctx.membershipId) throw new HttpError(403, "self_verification", "You cannot verify evidence you attached yourself.");
    if (!(VERIFY_STATUSES as readonly string[]).includes(input.status)) throw new HttpError(400, "invalid_value", "Verify, reject, or ask for more information.");
    const note = (input.note ?? "").trim() || null;
    if (note && note.length > 1000) throw new HttpError(400, "invalid_text", "The note is at most 1000 characters.");
    if (input.status !== "verified" && !note) throw new HttpError(400, "note_required", "Say why it is rejected or what is missing.");
    this.o.store.transaction(() => {
      w.repo.verify(id, input.status, ctx.membershipId, note, this.now());
      this.o.audit.record(w.tdb, ctx, { action: "evidence.verify", entityType: "evidence", entityId: id, summary: `Marked evidence "${e.title}" ${input.status.replace("_", " ")}`, before: { status: e.verification_status }, after: { status: input.status } });
    });
    return this.one(auth, requestId, caps, id);
  }

  /** The person who attached evidence may take it back while it is still "not verified yet". It is hidden, its file is removed, and the audit log keeps who and when. */
  withdraw(auth: AuthContext, requestId: string, caps: Capabilities, id: string): { id: string; withdrawn: true } {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const e = this.find(w, caps, ctx.membershipId, id);
    if (e.submitted_by_membership_id !== ctx.membershipId) throw new HttpError(403, "permission_denied", "Only the person who attached the evidence can withdraw it.");
    if (e.verification_status !== "unverified") throw new HttpError(409, "not_withdrawable", "Only evidence that is still not verified can be withdrawn.");
    const file = w.repo.file(id);
    this.o.store.transaction(() => {
      w.repo.withdraw(id, ctx.membershipId, this.now());
      w.repo.deleteFile(id);
      this.o.audit.record(w.tdb, ctx, { action: "evidence.withdraw", entityType: "evidence", entityId: id, summary: `Withdrew evidence "${e.title}"`, before: { status: e.verification_status, file: file ? file.filename : null }, after: { status: "withdrawn" } });
    });
    return { id, withdrawn: true };
  }

  // ---------- files ----------

  attachFile(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: { filename: string; dataBase64: string }): EvidenceView {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    const e = this.find(w, caps, ctx.membershipId, id);
    if (e.submitted_by_membership_id !== ctx.membershipId) throw new HttpError(403, "permission_denied", "Only the person who attached the evidence can add its file.");
    this.checkUploadRate(w.tdb, ctx);
    if (w.repo.file(id)) throw new HttpError(409, "file_exists", "This evidence already has a file.");
    const filename = input.filename.replace(/[\\/\0\r\n"]/g, "_").trim().slice(0, 120);
    const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
    const contentType = FILE_TYPES[ext];
    if (!filename || !contentType) throw new HttpError(400, "file_type", "A file can be a png, jpg, pdf, txt, csv or md.");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.dataBase64)) throw new HttpError(400, "invalid_file", "The file could not be read.");
    const data = Buffer.from(input.dataBase64, "base64");
    if (data.length === 0) throw new HttpError(400, "invalid_file", "The file is empty.");
    if (data.length > MAX_FILE_BYTES) throw new HttpError(413, "file_too_large", "A file can be at most 2 MB.");
    if (w.repo.totalBytes() + data.length > MAX_ORG_BYTES) throw new HttpError(413, "storage_full", "The organization's evidence storage (100 MB) is full.");
    this.o.store.transaction(() => {
      w.repo.insertFile({ id: newId(), evidenceId: id, filename, contentType, size: data.length, sha256: createHash("sha256").update(data).digest("hex"), data, now: this.now() });
      w.repo.setSource(id, "upload", this.now());
      this.o.audit.record(w.tdb, ctx, { action: "evidence.file", entityType: "evidence", entityId: id, summary: `Attached the file "${filename}" (${data.length} bytes) to evidence "${e.title}"`, after: { filename, sizeBytes: data.length } });
    });
    return this.one(auth, requestId, caps, id);
  }

  private checkUploadRate(tdb: TenantDb, ctx: TenantCtx): void {
    const key = ctx.membershipId;
    const wait = this.uploads.retryAfterMs(key);
    if (wait > 0) throw this.o.auth.tooMany(wait);
    const block = this.uploads.fail(key);
    if (block > 0) {
      // the block starts now: the audit log records who was slowed down and for how long, never the file or anything about it
      this.o.audit.record(tdb, ctx, { action: "security.rate_limited", entityType: "evidence", summary: "Too many file uploads in a short time; uploads are paused for this person", after: { limiter: "evidence_upload", blockedSeconds: Math.ceil(block / 1000) } });
    }
  }

  /** The file, after the same visibility check as the evidence itself (another organization's or an unseen item is "not found"). */
  download(auth: AuthContext, requestId: string, caps: Capabilities, id: string): { filename: string; contentType: string; data: Buffer } {
    const ctx = this.ctx(auth, requestId);
    const w = this.world(ctx);
    this.find(w, caps, ctx.membershipId, id);
    const f = w.repo.file(id);
    if (!f) throw notFound();
    return { filename: f.filename, contentType: f.content_type, data: f.data };
  }
}
