import type { TenantDb } from "../../db/tenant.js";
import { newId } from "../../lib/ids.js";
import { AutomationEventsRepository } from "../automation/repositories/events.js";
import { deliverNotification } from "../notifications/service.js";
import { NotificationsRepository } from "../notifications/repositories/notifications.js";
import { PeopleRepository } from "../people/repositories/people.js";
import { keyResultAttainment, objectiveAttainment, type Direction, type ProgressMethod } from "./attainment.js";
import { HEALTH_LABEL, objectiveHealth, type Health, type HealthResult } from "./health.js";
import type { KeyResultRow, ObjectiveRow } from "./repositories/okr.js";

/** The progress (0 to 1, or null for no data) of an objective, from its key results' recorded values. */
export function progressOf(krs: readonly KeyResultRow[]): number | null {
  return objectiveAttainment(krs.map((k) => ({ attainment: keyResultAttainment({ direction: k.direction as Direction, method: k.progress_method as ProgressMethod, start: k.start_value, target: k.target_value, current: k.current_value, weight: k.weight }).value, weight: k.weight }))).value;
}

export function healthOf(o: ObjectiveRow, krs: readonly KeyResultRow[], today: string): HealthResult {
  return objectiveHealth({ lifecycle: o.lifecycle, startDate: o.start_date, endDate: o.end_date, today, progress: progressOf(krs) });
}

/**
 * Stores the objective's health when it changed, and tells the owner and the creator when it moves to at risk or delayed.
 * Used both inside the transaction of a change (a recorded value, a new end date) and by the hourly sweep, so the story is the
 * same either way. The notice and the business event carry a dedupe key per objective and status: told once per status.
 */
export function refreshObjectiveHealth(tdb: TenantDb, o: ObjectiveRow, krs: readonly KeyResultRow[], today: string, nowIso: string, store: { setHealth: (id: string, health: string | null, reason: string, now: string) => void }): { changed: boolean; health: Health | null } {
  const r = healthOf(o, krs, today);
  const same = (o.health ?? null) === r.health && (o.health_reason ?? "") === r.reason;
  if (same) return { changed: false, health: r.health };
  store.setHealth(o.id, r.health, r.reason, nowIso);
  if ((r.health === "at_risk" || r.health === "delayed") && o.health !== r.health && o.lifecycle === "active") {
    const live = new Set(new PeopleRepository(tdb).activePersonIds());
    const key = `objective.health:${o.id}:${r.health}`;
    new AutomationEventsRepository(tdb).insert({ id: newId(), eventType: "objective.at_risk", entityType: "objective", entityId: o.id, actorId: null, payloadJson: JSON.stringify({ objectiveId: o.id, title: o.title, health: r.health, reason: r.reason }), dedupeKey: key, now: nowIso });
    const recipients = [o.owner_membership_id, o.created_by_membership_id].filter((m): m is string => m !== null && live.has(m));
    if (recipients.length > 0) {
      deliverNotification(new NotificationsRepository(tdb), { recipients, type: "objective.at_risk", title: `${HEALTH_LABEL[r.health]}: ${o.title}`, body: r.reason, severity: r.health === "delayed" ? "critical" : "warning", entityType: "objective", entityId: o.id, dedupeKey: key }, nowIso);
    }
  }
  return { changed: true, health: r.health };
}
