import type { TenantCtx, TenantDb } from "../../db/tenant.js";
import { newId } from "../../lib/ids.js";
import type { AuthStore } from "../auth/repositories/store.js";

export interface BusinessEvent {
  eventType: string;
  entityType: string;
  entityId: string;
  /** Names the same occurrence twice with the same key: the second write is ignored. */
  dedupeKey: string;
  /** Business facts only. Never a secret, a link or a password. */
  payload: Record<string, unknown>;
  actorId?: string | null;
}

/** Writes the business-event log INSIDE the caller's transaction. Nothing reads it before the integrations stage. */
export class EventWriter {
  constructor(
    private readonly store: AuthStore,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  record(tdb: TenantDb, ctx: Pick<TenantCtx, "membershipId">, e: BusinessEvent): boolean {
    return this.store.events(tdb).insert({
      id: newId(),
      eventType: e.eventType,
      entityType: e.entityType,
      entityId: e.entityId,
      actorId: e.actorId === undefined ? ctx.membershipId || null : e.actorId,
      payloadJson: JSON.stringify(e.payload),
      dedupeKey: e.dedupeKey,
      now: new Date(this.clock()).toISOString(),
    });
  }
}
