import type { TenantDb } from "../../../db/tenant.js";

export interface AiRequestInsert {
  id: string; membershipId: string; questionLength: number; records: { type: string; id: string }[]; status: "succeeded" | "failed" | "blocked";
  errorCode: string | null; provider: string | null; model: string | null; tokensIn: number | null; tokensOut: number | null; durationMs: number | null; now: string;
}

/** The organization's AI switch and the log of AI requests (the shape of each request only: never a question, an answer, a context or a key). */
export class AiRepository {
  constructor(private readonly tdb: TenantDb) {}

  enabled(): boolean {
    return (this.tdb.get<{ enabled: number }>("SELECT enabled FROM organization_ai_settings WHERE organization_id = @organization_id")?.enabled ?? 0) === 1;
  }
  setEnabled(enabled: boolean, by: string, now: string): void {
    this.tdb.run(
      "INSERT INTO organization_ai_settings (organization_id, enabled, updated_by_membership_id, updated_at) VALUES (@organization_id, @enabled, @by, @now) ON CONFLICT (organization_id) DO UPDATE SET enabled = @enabled, updated_by_membership_id = @by, updated_at = @now",
      { enabled: enabled ? 1 : 0, by, now },
    );
  }
  /** Requests that reached the provider (succeeded or failed) since `since`: what the daily limits count. */
  countSince(since: string, membershipId?: string): number {
    return membershipId
      ? this.tdb.get<{ n: number }>("SELECT COUNT(*) AS n FROM ai_requests WHERE organization_id = @organization_id AND created_at >= @since AND status <> 'blocked' AND membership_id = @membershipId", { since, membershipId })?.n ?? 0
      : this.tdb.get<{ n: number }>("SELECT COUNT(*) AS n FROM ai_requests WHERE organization_id = @organization_id AND created_at >= @since AND status <> 'blocked'", { since })?.n ?? 0;
  }
  insert(r: AiRequestInsert): void {
    this.tdb.run(
      "INSERT INTO ai_requests (id, organization_id, membership_id, question_length, record_count, records_json, status, error_code, provider, model, tokens_in, tokens_out, duration_ms, created_at) VALUES (@id, @organization_id, @membershipId, @questionLength, @recordCount, @recordsJson, @status, @errorCode, @provider, @model, @tokensIn, @tokensOut, @durationMs, @now)",
      { id: r.id, membershipId: r.membershipId, questionLength: r.questionLength, recordCount: r.records.length, recordsJson: JSON.stringify(r.records), status: r.status, errorCode: r.errorCode, provider: r.provider, model: r.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut, durationMs: r.durationMs, now: r.now },
    );
  }
}
