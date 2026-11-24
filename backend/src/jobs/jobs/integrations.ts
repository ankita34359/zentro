import { createTenantDb } from "../../db/tenant.js";
import { OrganizationsRepository } from "../../modules/auth/repositories/organizations.js";
import type { WebhookService } from "../../modules/integrations/webhooks.js";
import type { JobDef } from "../registry.js";

/** Every minute the tick is called: turn new switched-on business events into webhook deliveries and make the attempts that are due (retries wait their backoff). */
export function dispatchJob(webhooks: WebhookService): JobDef {
  return {
    name: "integrations.dispatch",
    minIntervalSeconds: 60,
    run: async ({ db, budgetMs }) => {
      const total = { organizations: 0, queued: 0, sent: 0, failed: 0 };
      for (const org of new OrganizationsRepository(db).listAll()) {
        if (budgetMs() < 15_000) break; // out of time: the rest is still due next tick
        const tdb = createTenantDb(db, { userId: "", membershipId: "", organizationId: org.id, sessionId: "", requestId: "job:integrations.dispatch" });
        const r = await webhooks.dispatchFor(tdb, org.id);
        if (r.queued + r.sent + r.failed > 0) total.organizations += 1;
        total.queued += r.queued; total.sent += r.sent; total.failed += r.failed;
      }
      return total;
    },
  };
}
