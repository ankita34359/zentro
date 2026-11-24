import type Database from "better-sqlite3";
import { createTenantDb, type TenantCtx, type TenantDb } from "../../../db/tenant.js";
import { MembershipsRepository, OrganizationsRepository, RolesRepository } from "./organizations.js";
import { PermissionsCatalogRepository, RoleGrantsRepository } from "../../permissions/repositories/permissions.js";
import { AuthTokensRepository } from "./authTokens.js";
import { AuditRepository } from "../../audit/repositories/audit.js";
import { StructureRepository } from "../../organization/repositories/structure.js";
import { PeopleRepository } from "../../people/repositories/people.js";
import { TasksRepository } from "../../tasks/repositories/tasks.js";
import { NotificationsRepository } from "../../notifications/repositories/notifications.js";
import { AutomationEventsRepository } from "../../automation/repositories/events.js";
import { DemoRepository } from "../../demo/repositories/demo.js";
import { OkrRepository } from "../../okr/repositories/okr.js";
import { KpiRepository } from "../../kpi/repositories/kpi.js";
import { EvidenceRepository } from "../../evidence/repositories/evidence.js";
import { ExportRepository } from "../../exports/repositories/export.js";
import { AiRepository } from "../../ai/repositories/ai.js";
import { ReviewRepository } from "../../reviews/repositories/reviews.js";
import { MentorshipRepository } from "../../mentorship/repositories/mentorship.js";
import { ScorecardRepository, ScoringRepository } from "../../scoring/repositories/scoring.js";
import { ErasureRepository } from "./erasure.js";
import { InvitationsRepository } from "./invitations.js";
import { SessionsRepository } from "./sessions.js";
import { UsersRepository } from "./users.js";

/** The one place the auth module touches the database handle: it builds the repositories and the transaction wrapper. */
export interface AuthStore {
  users: UsersRepository;
  sessions: SessionsRepository;
  orgs: OrganizationsRepository;
  tokens: AuthTokensRepository;
  permissions: PermissionsCatalogRepository;
  erasure: ErasureRepository;
  tenant(ctx: TenantCtx): TenantDb;
  memberships(tdb: TenantDb): MembershipsRepository;
  roles(tdb: TenantDb): RolesRepository;
  invitations(tdb: TenantDb): InvitationsRepository;
  grants(tdb: TenantDb): RoleGrantsRepository;
  audit(tdb: TenantDb): AuditRepository;
  structure(tdb: TenantDb): StructureRepository;
  people(tdb: TenantDb): PeopleRepository;
  tasks(tdb: TenantDb): TasksRepository;
  notifications(tdb: TenantDb): NotificationsRepository;
  events(tdb: TenantDb): AutomationEventsRepository;
  demo(tdb: TenantDb): DemoRepository;
  okr(tdb: TenantDb): OkrRepository;
  kpi(tdb: TenantDb): KpiRepository;
  scoring(tdb: TenantDb): ScoringRepository;
  scorecards(tdb: TenantDb): ScorecardRepository;
  mentorship(tdb: TenantDb): MentorshipRepository;
  reviews(tdb: TenantDb): ReviewRepository;
  evidence(tdb: TenantDb): EvidenceRepository;
  ai(tdb: TenantDb): AiRepository;
  exports(tdb: TenantDb): ExportRepository;
  transaction<T>(fn: () => T): T;
}

export function createAuthStore(db: Database.Database): AuthStore {
  return {
    users: new UsersRepository(db),
    sessions: new SessionsRepository(db),
    orgs: new OrganizationsRepository(db),
    tokens: new AuthTokensRepository(db),
    permissions: new PermissionsCatalogRepository(db),
    erasure: new ErasureRepository(db),
    tenant: (ctx) => createTenantDb(db, ctx),
    memberships: (tdb) => new MembershipsRepository(tdb),
    roles: (tdb) => new RolesRepository(tdb),
    invitations: (tdb) => new InvitationsRepository(tdb),
    grants: (tdb) => new RoleGrantsRepository(tdb),
    audit: (tdb) => new AuditRepository(tdb),
    structure: (tdb) => new StructureRepository(tdb),
    people: (tdb) => new PeopleRepository(tdb),
    tasks: (tdb) => new TasksRepository(tdb),
    notifications: (tdb) => new NotificationsRepository(tdb),
    events: (tdb) => new AutomationEventsRepository(tdb),
    demo: (tdb) => new DemoRepository(tdb),
    okr: (tdb) => new OkrRepository(tdb),
    kpi: (tdb) => new KpiRepository(tdb),
    scoring: (tdb) => new ScoringRepository(tdb),
    scorecards: (tdb) => new ScorecardRepository(tdb),
    mentorship: (tdb) => new MentorshipRepository(tdb),
    reviews: (tdb) => new ReviewRepository(tdb),
    evidence: (tdb) => new EvidenceRepository(tdb),
    ai: (tdb) => new AiRepository(tdb),
    exports: (tdb) => new ExportRepository(tdb),
    transaction: (fn) => db.transaction(fn)(),
  };
}
