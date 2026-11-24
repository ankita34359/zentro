import type Database from "better-sqlite3";

export interface InboundLookup { id: string; organization_id: string; kind: string; config_json: string; token_hash: string; created_by_membership_id: string; user_id: string | null; creator_status: string }

/**
 * Platform-level lookup for the public incoming-endpoint route: the caller has no session, so the organization is not known yet. The ENDPOINT's own
 * row says which organization it belongs to (and who created it); nothing the caller sends can choose another one.
 */
export function findInboundEndpoint(db: Database.Database, id: string): InboundLookup | undefined {
  return db
    .prepare("SELECT e.id, e.organization_id, e.kind, e.config_json, e.token_hash, e.created_by_membership_id, m.user_id, m.status AS creator_status FROM inbound_endpoints e JOIN organization_memberships m ON m.id = e.created_by_membership_id AND m.organization_id = e.organization_id WHERE e.id = ?")
    .get(id) as InboundLookup | undefined;
}
