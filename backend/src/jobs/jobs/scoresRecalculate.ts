import { createTenantDb } from "../../db/tenant.js";
import { AuditRepository } from "../../modules/audit/repositories/audit.js";
import { OrganizationsRepository } from "../../modules/auth/repositories/organizations.js";
import { PeopleRepository } from "../../modules/people/repositories/people.js";
import { todayIn } from "../../modules/tasks/dates.js";
import { newId } from "../../lib/ids.js";
import { Collector } from "../../modules/scoring/collector.js";
import { ScorecardRepository, ScoringRepository } from "../../modules/scoring/repositories/scoring.js";
import { runScore } from "../../modules/scoring/runner.js";
import type { JobDef } from "../registry.js";

/**
 * Stage 5.3: every night, for every organization that uses scoring, recompute the scores of every OPEN period that has started
 * (time passes and records change even when nobody presses "calculate"). A new run is stored only when the inputs or the
 * outcome changed, so a quiet night adds nothing. Closed and locked periods are never touched. One audit line per organization,
 * written only when something was added. An organization that has no scoring models yet (nobody opened Scoring) is skipped.
 */
export const scoresRecalculateJob: JobDef = {
  name: "scores.recalculate",
  minIntervalSeconds: 23 * 60 * 60,
  run: ({ db, now, budgetMs }) => {
    const nowIso = now.toISOString();
    const summary = { organizations: 0, periods: 0, people: 0, newRuns: 0 };
    for (const org of new OrganizationsRepository(db).listAll()) {
      if (budgetMs() < 10_000) break;
      const today = todayIn(org.timezone, now);
      const tdb = createTenantDb(db, { userId: "", membershipId: "", organizationId: org.id, sessionId: "", requestId: "job:scores.recalculate" });
      const cards = new ScorecardRepository(tdb);
      const models = new ScoringRepository(tdb);
      const open = cards.periods().filter((p) => p.status === "open" && p.start_date <= today);
      if (open.length === 0 || models.realModelCount() === 0) continue;
      const people = new PeopleRepository(tdb).people().filter((p) => p.archived_at === null && p.status !== "left");
      summary.organizations += 1;
      tdb.transaction(() => {
        let added = 0;
        for (const period of open) {
          const collector = new Collector(tdb, { id: period.id, start: period.start_date, end: period.end_date, open: true }, today);
          summary.periods += 1;
          // a demo period scores the demo company only: the organization's own people are not pulled into it
          for (const person of period.is_demo === 1 ? people.filter((x) => x.is_demo === 1) : people) {
            summary.people += 1;
            const r = runScore({ cards, models, now: nowIso }, collector, period, person.id, person.display_name, "scheduled", { by: null, isDemo: period.is_demo === 1 });
            if (r?.created) added += 1;
          }
        }
        summary.newRuns += added;
        if (added > 0) new AuditRepository(tdb).insert({ id: newId(), actorType: "system", actorUserId: null, actorMembershipId: null, action: "performance.scheduled_recalculation", entityType: "performance_period", entityId: null, summary: `Nightly update: ${added} new score ${added === 1 ? "run" : "runs"} across ${open.length} open ${open.length === 1 ? "period" : "periods"}`, beforeJson: null, afterJson: JSON.stringify({ newRuns: added, periods: open.length }), requestId: "job:scores.recalculate", now: nowIso });
      });
    }
    return summary;
  },
};
