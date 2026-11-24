import express, { type Express } from "express";
import type Database from "better-sqlite3";
import type { Config } from "./config/env.js";
import { apiNotFound, errorHandler } from "./http/errorHandler.js";
import { revalidateHealthz } from "./http/cacheHeaders.js";
import { compressText } from "./http/compress.js";
import { requestId } from "./http/requestId.js";
import { requestLog } from "./http/requestLog.js";
import { sameOriginCheck } from "./http/sameOrigin.js";
import { assertAllRegistered, RouteRegistry, type Guards } from "./http/registry.js";
import { mountSpa } from "./http/spa.js";
import { defaultJobs } from "./jobs/index.js";
import type { JobRegistry } from "./jobs/registry.js";
import { createTick } from "./jobs/tick.js";
import type { Logger } from "./lib/logger.js";
import { AccountService } from "./modules/auth/accounts.js";
import { registerAccountRoutes } from "./modules/auth/accountRoutes.js";
import { noDelivery, type LinkDelivery } from "./modules/auth/delivery.js";
import { InvitationService } from "./modules/auth/invitations.js";
import { AdminService } from "./modules/permissions/admin.js";
import { StructureService } from "./modules/organization/service.js";
import { registerStructureRoutes } from "./modules/organization/routes.js";
import { AuditService } from "./modules/audit/service.js";
import { registerAuditRoutes } from "./modules/audit/routes.js";
import { PermissionService } from "./modules/permissions/service.js";
import type { HierarchyProvider } from "./modules/permissions/resolver.js";
import { DbHierarchy } from "./modules/people/hierarchy.js";
import { ChartService } from "./modules/people/chartService.js";
import { registerChartRoutes } from "./modules/people/chartRoutes.js";
import { HierarchyService } from "./modules/people/hierarchyService.js";
import { PeopleService } from "./modules/people/service.js";
import { DemoService } from "./modules/demo/service.js";
import { registerDemoRoutes } from "./modules/demo/routes.js";
import { EventWriter } from "./modules/automation/events.js";
import { NotificationService } from "./modules/notifications/service.js";
import { registerNotificationRoutes } from "./modules/notifications/routes.js";
import { TaskService } from "./modules/tasks/service.js";
import { EvidenceService } from "./modules/evidence/service.js";
import { registerEvidenceRoutes } from "./modules/evidence/routes.js";
import { DashboardService } from "./modules/dashboards/service.js";
import { registerDashboardRoutes } from "./modules/dashboards/routes.js";
import { securityHeaders } from "./http/securityHeaders.js";
import { apiLimit } from "./http/apiLimit.js";
import { registerExportRoutes } from "./modules/exports/routes.js";
import { ExportService } from "./modules/exports/service.js";
import { registerAiRoutes } from "./modules/ai/routes.js";
import { AiService } from "./modules/ai/service.js";
import { AiContextBuilder } from "./modules/ai/context.js";
import { AnthropicProvider, type AiProvider } from "./modules/ai/provider.js";
import { OverviewService } from "./modules/overview/service.js";
import { registerOverviewRoutes } from "./modules/overview/routes.js";
import { OkrService } from "./modules/okr/service.js";
import { KpiService } from "./modules/kpi/service.js";
import { registerKpiRoutes } from "./modules/kpi/routes.js";
import { MeasurementService } from "./modules/kpi/measurements.js";
import { ModelService } from "./modules/scoring/models.js";
import { registerModelRoutes } from "./modules/scoring/modelRoutes.js";
import { PerformanceService } from "./modules/scoring/performance.js";
import { ReviewService } from "./modules/reviews/service.js";
import { registerReviewRoutes } from "./modules/reviews/routes.js";
import { MentorshipService } from "./modules/mentorship/service.js";
import { registerMentorshipRoutes } from "./modules/mentorship/routes.js";
import { ComparisonService } from "./modules/scoring/comparison.js";
import { registerComparisonRoutes } from "./modules/scoring/comparisonRoutes.js";
import { registerPerformanceRoutes } from "./modules/scoring/performanceRoutes.js";
import { registerMeasurementRoutes } from "./modules/kpi/measurementRoutes.js";
import { AlignmentService } from "./modules/okr/alignment.js";
import { registerAlignmentRoutes } from "./modules/okr/alignmentRoutes.js";
import { registerOkrRoutes } from "./modules/okr/routes.js";
import { registerTaskRoutes } from "./modules/tasks/routes.js";
import { registerPeopleRoutes } from "./modules/people/routes.js";
import { registerRoleRoutes } from "./modules/permissions/routes.js";
import { createAuthGuards } from "./modules/auth/guards.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { createAuthStore } from "./modules/auth/repositories/store.js";
import { AuthService } from "./modules/auth/service.js";
import { registerSystemRoutes } from "./routes/system.js";

export interface AppOptions {
  db: Database.Database;
  config: Config;
  version: string;
  cronSecret: string | undefined;
  migrationsTotal: number;
  log: Logger;
  /** Folder holding the Vite build (index.html). Omit in API-only tests. */
  staticDir?: string;
  /** Replace the job list (tests). */
  jobs?: JobRegistry;
  /** Add routes (tests, later stages). They go through the same registry and boot check. */
  extraRoutes?: (registry: RouteRegistry) => void;
  /** Replace the sign-in guards (stage 2.1 supplies real ones; the default refuses everyone). */
  guards?: Guards;
  /** Where invitation and reset links go besides the administrator's screen. Stage 2.2 default: nowhere (administrators copy links). Stage 8 supplies email. */
  delivery?: LinkDelivery;
  /** The AI provider. Production uses Anthropic (key from the server's settings); tests pass a fake and never touch the network. */
  aiProvider?: AiProvider;
  /** Calls one address may make to the API in a minute (a gentle general limit; sign-in, reset, invitations and uploads have strict ones of their own). Tests lower it. */
  apiRequestsPerMinute?: number;
  /** Teams, departments and reporting lines. The default reads the real tables (stage 2.6); tests may inject a fake. */
  hierarchy?: HierarchyProvider;
}

export function createApp(opts: AppOptions): { app: Express; registry: RouteRegistry; tick: ReturnType<typeof createTick>; auth: AuthService; permissions: PermissionService } {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", opts.config.trustProxy);

  const jobs = opts.jobs ?? defaultJobs();
  const tick = createTick(opts.db, jobs, opts.log);
  const registry = new RouteRegistry();

  const store = createAuthStore(opts.db);
  const fake = opts.hierarchy;
  const permissions = new PermissionService(store, fake ? () => fake : (tdb) => new DbHierarchy(store.people(tdb), store.structure(tdb)));
  const audit = new AuditService(store);
  const auth = new AuthService({ store, permissions, audit, config: opts.config, log: opts.log });
  const structure = new StructureService({ store, auth, audit });
  const peopleService = new PeopleService({ store, auth, audit });
  const hierarchyService = new HierarchyService({ store, auth, audit });
  const chartService = new ChartService({ store, auth });
  const events = new EventWriter(store);
  const notifications = new NotificationService(store, auth);
  const okrService = new OkrService({ store, auth, audit });
  const performanceService = new PerformanceService({ store, auth, audit });
  const demoService = new DemoService({ store, auth, audit, performance: performanceService });
  const taskService = new TaskService({ store, auth, audit, events, notifications, okr: okrService });
  const admin = new AdminService({ store, auth, permissions, audit });
  // Stage 2.2 sends no email: administrators copy links. Stage 8 swaps `noDelivery` for the outbox-backed delivery.
  const delivery = opts.delivery ?? noDelivery;
  const accounts = new AccountService({ store, auth, permissions, audit, log: opts.log, delivery });
  const invitations = new InvitationService({ store, auth, permissions, audit, log: opts.log, delivery });
  registerSystemRoutes(registry, { db: opts.db, version: opts.version, migrationsTotal: opts.migrationsTotal, tick, registration: opts.config.registration.mode });
  registerAuthRoutes(registry, auth, { sessionSecret: opts.config.sessionSecret, nodeEnv: opts.config.nodeEnv });
  registerRoleRoutes(registry, { auth, permissions, admin });
  registerAuditRoutes(registry, { auth, audit });
  registerStructureRoutes(registry, { auth, permissions, structure });
  registerPeopleRoutes(registry, { permissions, people: peopleService, hierarchy: hierarchyService });
  registerChartRoutes(registry, { permissions, chart: chartService });
  registerTaskRoutes(registry, { permissions, tasks: taskService });
  registerNotificationRoutes(registry, { notifications });
  registerAlignmentRoutes(registry, { permissions, alignment: new AlignmentService({ store, auth, audit, okr: okrService }), tasks: taskService });
  registerOkrRoutes(registry, { permissions, okr: okrService });
  const measurementService = new MeasurementService({ store, auth, audit, events });
  registerMeasurementRoutes(registry, { permissions, measurements: measurementService });
  registerModelRoutes(registry, { permissions, models: new ModelService({ store, auth, audit }) });
  registerPerformanceRoutes(registry, { permissions, performance: performanceService });
  registerEvidenceRoutes(registry, { permissions, evidence: new EvidenceService({ store, auth, audit, tasks: taskService, okr: okrService }) });
  registerReviewRoutes(registry, { permissions, reviews: new ReviewService({ store, auth, audit }) });
  const mentorshipService = new MentorshipService({ store, auth, audit });
  registerMentorshipRoutes(registry, { permissions, mentorship: mentorshipService });
  registerComparisonRoutes(registry, { permissions, comparison: new ComparisonService({ store, auth, audit }) });
  const kpiService = new KpiService({ store, auth, audit });
  registerKpiRoutes(registry, { permissions, kpis: kpiService });
  const overviewService = new OverviewService({ store, auth, tasks: taskService, okr: okrService, measurements: measurementService });
  registerOverviewRoutes(registry, { permissions, overview: overviewService });
  const alignmentService = new AlignmentService({ store, auth, audit, okr: okrService });
  const dashboardService = new DashboardService({ store, auth, okr: okrService, alignment: alignmentService, measurements: measurementService, performance: performanceService, mentorship: mentorshipService });
  registerDashboardRoutes(registry, { permissions, dashboards: dashboardService });
  registerExportRoutes(registry, { permissions, exports: new ExportService({ store, auth, audit }) });
  const aiProvider: AiProvider = opts.aiProvider ?? new AnthropicProvider();
  registerAiRoutes(registry, { permissions, ai: new AiService({ store, auth, audit, provider: aiProvider, builder: new AiContextBuilder({ overview: overviewService, dashboards: dashboardService, okr: okrService, kpi: kpiService, tasks: taskService }) }) });
  registerDemoRoutes(registry, { auth, permissions, demo: demoService, sessionSecret: opts.config.sessionSecret, nodeEnv: opts.config.nodeEnv });
  registerAccountRoutes(registry, { auth, permissions, accounts, invitations, sessionSecret: opts.config.sessionSecret, nodeEnv: opts.config.nodeEnv });
  opts.extraRoutes?.(registry);

  app.use(requestId);
  app.use(securityHeaders);
  app.use(requestLog(opts.log));
  app.use("/api", apiLimit({ perMinute: opts.apiRequestsPerMinute ?? 600, log: opts.log }));
  app.use(compressText());
  app.use(revalidateHealthz);
  app.use(sameOriginCheck(opts.config.appUrl));
  app.use("/api/evidence", express.json({ limit: "3.5mb" })); // a base64 file of at most 2 MB; every other route keeps the small limit
  app.use(express.json({ limit: "100kb" }));
  registry.mount(app, opts.guards ?? createAuthGuards(auth, permissions, opts.config.sessionSecret, opts.config.nodeEnv, opts.cronSecret));
  assertAllRegistered(app, registry);

  app.use("/api", apiNotFound);
  mountSpa(app, opts.staticDir);
  app.use(apiNotFound);
  app.use(errorHandler(opts.log));
  return { app, registry, tick, auth, permissions };
}
