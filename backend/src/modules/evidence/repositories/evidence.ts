import type { TenantDb } from "../../../db/tenant.js";

export interface EvidenceRow {
  id: string; evidence_type: string; title: string; description: string; source: string; external_ref: string | null; related_membership_id: string | null; occurred_on: string;
  submitted_by_membership_id: string; verification_status: string; verified_by_membership_id: string | null; verified_at: string | null; verification_note: string | null; confidentiality: string; is_demo: number; created_at: string; updated_at: string;
}
export interface EvidenceFileRow { id: string; evidence_id: string; filename: string; content_type: string; size_bytes: number; sha256: string }
export interface EvidenceLinkRow { id: string; evidence_id: string; target_type: string; target_id: string }
const COLS = "id, evidence_type, title, description, source, external_ref, related_membership_id, occurred_on, submitted_by_membership_id, verification_status, verified_by_membership_id, verified_at, verification_note, confidentiality, is_demo, created_at, updated_at";

/** Evidence, its files and its links for ONE organization. */
export class EvidenceRepository {
  constructor(private readonly tdb: TenantDb) {}

  all(): EvidenceRow[] {
    return this.tdb.all<EvidenceRow>(`SELECT ${COLS} FROM evidence WHERE organization_id = @organization_id AND withdrawn_at IS NULL ORDER BY occurred_on DESC, created_at DESC, rowid DESC`);
  }
  one(id: string): EvidenceRow | undefined {
    return this.tdb.get<EvidenceRow>(`SELECT ${COLS} FROM evidence WHERE organization_id = @organization_id AND id = @id AND withdrawn_at IS NULL`, { id });
  }
  insert(e: { id: string; type: string; title: string; description: string; source: string; externalRef: string | null; relatedId: string | null; occurredOn: string; by: string; confidentiality: string; isDemo?: boolean; status?: string; verifiedBy?: string | null; verifiedAt?: string | null; now: string }): void {
    this.tdb.run(
      "INSERT INTO evidence (id, organization_id, evidence_type, title, description, source, external_ref, related_membership_id, occurred_on, submitted_by_membership_id, verification_status, verified_by_membership_id, verified_at, confidentiality, is_demo, created_at, updated_at) VALUES (@id, @organization_id, @type, @title, @description, @source, @externalRef, @relatedId, @occurredOn, @by, @status, @verifiedBy, @verifiedAt, @confidentiality, @isDemo, @now, @now)",
      { ...e, status: e.status ?? "unverified", verifiedBy: e.verifiedBy ?? null, verifiedAt: e.verifiedAt ?? null, isDemo: e.isDemo ? 1 : 0 },
    );
  }
  /** Withdrawn evidence stays in the table (who and when are kept) but is hidden from every read above. */
  withdraw(id: string, by: string, now: string): void {
    this.tdb.run("UPDATE evidence SET verification_status = 'withdrawn', withdrawn_at = @now, withdrawn_by_membership_id = @by, updated_at = @now WHERE organization_id = @organization_id AND id = @id AND verification_status = 'unverified' AND withdrawn_at IS NULL", { id, by, now });
  }
  deleteFile(evidenceId: string): void {
    this.tdb.run("DELETE FROM evidence_files WHERE organization_id = @organization_id AND evidence_id = @evidenceId", { evidenceId });
  }
  setSource(id: string, source: string, now: string): void {
    this.tdb.run("UPDATE evidence SET source = @source, updated_at = @now WHERE organization_id = @organization_id AND id = @id", { id, source, now });
  }
  verify(id: string, status: string, by: string, note: string | null, now: string): void {
    this.tdb.run("UPDATE evidence SET verification_status = @status, verified_by_membership_id = @by, verified_at = @now, verification_note = @note, updated_at = @now WHERE organization_id = @organization_id AND id = @id", { id, status, by, note, now });
  }

  files(): EvidenceFileRow[] {
    return this.tdb.all<EvidenceFileRow>("SELECT id, evidence_id, filename, content_type, size_bytes, sha256 FROM evidence_files WHERE organization_id = @organization_id");
  }
  file(evidenceId: string): (EvidenceFileRow & { data: Buffer }) | undefined {
    return this.tdb.get<EvidenceFileRow & { data: Buffer }>("SELECT id, evidence_id, filename, content_type, size_bytes, sha256, data FROM evidence_files WHERE organization_id = @organization_id AND evidence_id = @evidenceId", { evidenceId });
  }
  totalBytes(): number {
    return this.tdb.get<{ n: number }>("SELECT COALESCE(SUM(size_bytes), 0) AS n FROM evidence_files WHERE organization_id = @organization_id")?.n ?? 0;
  }
  insertFile(f: { id: string; evidenceId: string; filename: string; contentType: string; size: number; sha256: string; data: Buffer; now: string }): void {
    this.tdb.run("INSERT INTO evidence_files (id, organization_id, evidence_id, filename, content_type, size_bytes, sha256, data, created_at) VALUES (@id, @organization_id, @evidenceId, @filename, @contentType, @size, @sha256, @data, @now)", f);
  }

  links(): EvidenceLinkRow[] {
    return this.tdb.all<EvidenceLinkRow>("SELECT id, evidence_id, target_type, target_id FROM evidence_links WHERE organization_id = @organization_id");
  }
  insertLink(l: { id: string; evidenceId: string; type: string; targetId: string; now: string }): boolean {
    return this.tdb.run("INSERT OR IGNORE INTO evidence_links (id, organization_id, evidence_id, target_type, target_id, created_at) VALUES (@id, @organization_id, @evidenceId, @type, @targetId, @now)", l).changes === 1;
  }
}
