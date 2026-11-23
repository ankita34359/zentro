import { createTenantDb } from "../../db/tenant.js";
import { OrganizationsRepository } from "../../modules/auth/repositories/organizations.js";
import { applySeriesAlerts, buildSeries, loadSeriesInput } from "../../modules/kpi/series.js";
import { todayIn } from "../../modules/tasks/dates.js";
import type { JobDef } from "../registry.js";

/**
 * Stage 3.4: every hour, for every organization, look at every KPI series again: tell the right people about a warning or
 * critical latest value (a threshold or a target may have changed since the value was written) and about a period that ended
 * with no value. Each notice and event has a dedupe key (KPI, subject, period, level), so running this again, or after a missed
 * run, never repeats one.
 */
export const kpiThresholdsJob: JobDef = {
  name: "kpi.thresholds",
  minIntervalSeconds: 60 * 60,
  run: ({ db, now, budgetMs }) => {
    const nowIso = now.toISOString();
    const summary = { organizations: 0, series: 0, notices: 0 };
    for (const org of new OrganizationsRepository(db).listAll()) {
      if (budgetMs() < 5_000) break;
      const today = todayIn(org.timezone, now);
      const tdb = createTenantDb(db, { userId: "", membershipId: "", organizationId: org.id, sessionId: "", requestId: "job:kpi.thresholds" });
      summary.organizations += 1;
      tdb.transaction(() => {
        const input = loadSeriesInput(tdb, today);
        const series = buildSeries(input);
        summary.series += series.length;
        summary.notices += applySeriesAlerts(tdb, input, series, nowIso, { missed: true });
      });
    }
    return summary;
  },
};
