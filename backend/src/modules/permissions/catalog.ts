/**
 * The permission catalogue: global, code-referenced keys (docs/permission-model.md section 2). The database copy is
 * seeded by migration 0005 and a test checks the two stay identical. Code refers to KEYS only; roles are data.
 */
export type ScopeMode = "own" | "my_teams" | "reports" | "all_in_scope";
export const SCOPE_MODES: readonly ScopeMode[] = ["own", "my_teams", "reports", "all_in_scope"];

export interface PermissionDef {
  key: string;
  module: string;
  description: string;
  /** The modes the role editor may give this permission. */
  modes: readonly ScopeMode[];
  /** Exposes confidential material or changes access: the UI warns when granting it and an audit row is always written. */
  sensitive: boolean;
}

const O: ScopeMode = "own";
const T: ScopeMode = "my_teams";
const R: ScopeMode = "reports";
const S: ScopeMode = "all_in_scope";
const OTRS = [O, T, R, S] as const;

const p = (module: string, key: string, description: string, modes: readonly ScopeMode[], sensitive = false): PermissionDef => ({ key, module, description, modes, sensitive });

export const PERMISSIONS: readonly PermissionDef[] = [
  p("Organization", "org.view", "See departments, teams, org chart", OTRS),
  p("Organization", "org.manage", "Create/rename/archive departments, teams, designations, role families", [S]),
  p("Organization", "org.settings", "Organization settings (timezone, review cadence, defaults)", [S], true),
  p("People", "people.view", "See people profiles (name, designation, team, manager)", OTRS),
  p("People", "people.manage", "Create, edit, move, archive people", [R, S]),
  p("People", "people.view_sensitive", "Employment details (start date, type, employee code)", [O, R, S], true),
  p("People", "hierarchy.manage", "Change reporting relationships, team and department membership", [R, S]),
  p("People", "invitations.manage", "Create and revoke invitations", [S]),
  p("Access", "roles.view", "See roles and who holds them", [S]),
  p("Access", "roles.manage", "Edit roles, permissions, assignments", [S], true),
  p("Access", "audit.view", "Read the audit log", [S], true),
  p("OKRs", "okr.view", "See objectives and key results", OTRS),
  p("OKRs", "okr.create", "Create objectives and key results", OTRS),
  p("OKRs", "okr.edit", "Edit objectives and key results", OTRS),
  p("OKRs", "okr.archive", "Archive/cancel objectives", [R, S]),
  p("OKRs", "okr.assign", "Assign owners and link parents", [T, R, S]),
  p("OKRs", "okr.update_progress", "Record actual key-result values", OTRS),
  p("OKRs", "okr.publish", "Publish an objective for organization-wide visibility (leadership objectives)", [S]),
  p("KPIs", "kpi.view", "See KPI definitions, targets, measurements", OTRS),
  p("KPIs", "kpi.configure", "Create/edit KPIs, thresholds", [S]),
  p("KPIs", "kpi.assign", "Assign KPIs to roles, teams, people", [T, R, S]),
  p("KPIs", "kpi.record", "Record measurements (new rows, never overwrite)", OTRS),
  p("Tasks", "task.view", "See tasks", OTRS),
  p("Tasks", "task.create", "Create tasks", OTRS),
  p("Tasks", "task.assign", "Assign or reassign tasks", [T, R, S]),
  p("Tasks", "task.edit", "Edit others' tasks", [T, R, S]),
  p("Tasks", "task.review", "Record outcome quality on completed tasks", [T, R, S]),
  p("Evidence", "evidence.view", "See evidence (not restricted)", OTRS),
  p("Evidence", "evidence.submit", "Attach evidence", OTRS),
  p("Evidence", "evidence.verify", "Mark evidence verified/rejected", [T, R, S]),
  p("Evidence", "evidence.view_restricted", "See restricted evidence", [R, S], true),
  p("Performance", "performance.view_scores", "See others' scorecards and totals", [R, S], true),
  p("Performance", "performance.view_components", "See component breakdown and inputs", [R, S], true),
  p("Performance", "performance.recalculate", "Trigger recalculation", [R, S]),
  p("Performance", "performance.configure", "Edit scoring models and weights", [S], true),
  p("Performance", "performance.manage_periods", "Open/close/lock periods", [S]),
  p("Performance", "performance.compare", "Run peer/department comparisons", [R, S], true),
  p("Performance", "reviews.write", "Write reviews for people in scope", [R, S]),
  p("Performance", "reviews.read_shared", "Read shared review summaries", [R, S]),
  p("Performance", "reviews.read_private", "Read private review notes", [R, S], true),
  p("Mentorship", "mentorship.view", "See assignments and effectiveness", OTRS),
  p("Mentorship", "mentorship.manage", "Create/end assignments", [R, S]),
  p("Mentorship", "mentorship.log", "Log activities and progress", [O, R, S]),
  p("Leadership", "leadership.view", "Leadership dashboard and executive KPIs", [S], true),
  p("AI", "ai.use", "Use the AI Intelligence Center chat", OTRS),
  p("AI", "ai.view_insights", "See insights and risk alerts (visibility still follows subject scope)", OTRS),
  p("AI", "ai.approve", "Approve AI proposals (must also hold the underlying action permission)", [R, S], true),
  p("AI", "ai.configure", "AI settings, agent enablement", [S], true),
  p("Integrations", "integrations.view", "See connected apps and automation history", [S]),
  p("Integrations", "integrations.manage", "Embed token, connect apps, manage slots and rules", [S], true),
  p("Integrations", "automations.retry", "Retry or cancel failed events", [S]),
  p("Operations", "system.view", "System panel (jobs, outbox backlog)", [S]),
  p("Operations", "data.export", "Export organization data", [S], true),
  p("Operations", "demo.manage", "Load/remove demo data, view as demo persona", [S], true),
];

export const PERMISSION_KEYS: ReadonlySet<string> = new Set(PERMISSIONS.map((x) => x.key));
export const permissionByKey = (key: string): PermissionDef | undefined => PERMISSIONS.find((x) => x.key === key);

/** Rights every signed-in person has, which no role edit can remove (docs/permission-model.md section 2.1). They are not permission keys. */
export const BASELINE_RIGHTS: readonly { key: string; description: string }[] = [
  { key: "self.profile", description: "Read your own profile, and change your own password" },
  { key: "self.work", description: "Read your own tasks, objectives, key results and KPI measurements" },
  { key: "self.performance", description: "Read your own score, its components and the inputs behind them, and the shared parts of your own reviews" },
  { key: "self.notifications", description: "Read your own notifications and manage your own preferences" },
  { key: "org.published_objectives", description: "Read objectives published organization-wide (leadership objectives), read-only" },
];
