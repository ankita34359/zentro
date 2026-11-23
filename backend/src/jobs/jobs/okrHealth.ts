import { createTenantDb } from "../../db/tenant.js";
import { OrganizationsRepository } from "../../modules/auth/repositories/organizations.js";
import { refreshObjectiveHealth } from "../../modules/okr/healthSweep.js";
import { OkrRepository } from "../../modules/okr/repositories/okr.js";
import { todayIn } from "../../modules/tasks/dates.js";
import type { JobDef } from "../registry.js";

/**
 * Stage 3.2: every hour, for every organization, recompute the health of each objective (time passes even when nobody
 * records anything, so an objective can slip behind its pace on its own). Writes only when the health or its reason changed;
 * a move to at risk or delayed tells the owner and the creator once per status (a dedupe key).
 */
export const okrHealthJob: JobDef = {
  name: "okr.health",
  minIntervalSeconds: 60 * 60,
  run: ({ db, now, budgetMs }) => {
    const nowIso = now.toISOString();
    const summary = { organizations: 0, objectives: 0, changed: 0 };
    for (const org of new OrganizationsRepository(db).listAll()) {
      if (budgetMs() < 5_000) break;
      const today = todayIn(org.timezone, now);
      const tdb = createTenantDb(db, { userId: "", membershipId: "", organizationId: org.id, sessionId: "", requestId: "job:okr.health" });
      const repo = new OkrRepository(tdb);
      const krs = new Map<string, ReturnType<OkrRepository["keyResults"]>>();
      for (const k of repo.keyResults()) krs.set(k.objective_id, [...(krs.get(k.objective_id) ?? []), k]);
      summary.organizations += 1;
      tdb.transaction(() => {
        for (const o of repo.objectives()) {
          summary.objectives += 1;
          if (refreshObjectiveHealth(tdb, o, krs.get(o.id) ?? [], today, nowIso, repo).changed) summary.changed += 1;
        }
      });
    }
    return summary;
  },
};
