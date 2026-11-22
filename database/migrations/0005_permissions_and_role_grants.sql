-- Stage 2.3: the permission catalogue and role permissions (docs/permission-model.md sections 1 to 3).
-- Append-only and ADDITIVE: it creates two tables, inserts the catalogue, and gives every existing Owner role its
-- permissions. It never drops, rewrites or renames anything that exists, so the previous version of the app keeps
-- running against the upgraded database (that is what makes a rollback safe).

-- Global catalogue. The id equals the key, so a role's permission rows read plainly. A test keeps this identical to
-- backend/src/modules/permissions/catalog.ts.
CREATE TABLE permissions (
  id                        TEXT PRIMARY KEY,
  key                       TEXT NOT NULL UNIQUE,
  module                    TEXT NOT NULL,
  description               TEXT NOT NULL,
  allowed_scope_modes_json  TEXT NOT NULL,
  is_sensitive              INTEGER NOT NULL DEFAULT 0
);

-- A role's grants: one row per (permission, scope mode). A permission may appear twice for one role ("reports" and
-- "my_teams"), which is why scope_mode is part of the key. organization_id is repeated so the tenant check applies.
CREATE TABLE role_permissions (
  organization_id  TEXT NOT NULL REFERENCES organizations(id),
  role_id          TEXT NOT NULL REFERENCES roles(id),
  permission_id    TEXT NOT NULL REFERENCES permissions(id),
  scope_mode       TEXT NOT NULL CHECK (scope_mode IN ('own', 'my_teams', 'reports', 'all_in_scope')),
  created_at       TEXT NOT NULL,
  PRIMARY KEY (role_id, permission_id, scope_mode)
);
CREATE INDEX idx_role_permissions_org_role ON role_permissions (organization_id, role_id);

INSERT INTO permissions (id, key, module, description, allowed_scope_modes_json, is_sensitive) VALUES
  ('org.view', 'org.view', 'Organization', 'See departments, teams, org chart', '["own","my_teams","reports","all_in_scope"]', 0),
  ('org.manage', 'org.manage', 'Organization', 'Create/rename/archive departments, teams, designations, role families', '["all_in_scope"]', 0),
  ('org.settings', 'org.settings', 'Organization', 'Organization settings (timezone, review cadence, defaults)', '["all_in_scope"]', 1),
  ('people.view', 'people.view', 'People', 'See people profiles (name, designation, team, manager)', '["own","my_teams","reports","all_in_scope"]', 0),
  ('people.manage', 'people.manage', 'People', 'Create, edit, move, archive people', '["reports","all_in_scope"]', 0),
  ('people.view_sensitive', 'people.view_sensitive', 'People', 'Employment details (start date, type, employee code)', '["own","reports","all_in_scope"]', 1),
  ('hierarchy.manage', 'hierarchy.manage', 'People', 'Change reporting relationships, team and department membership', '["reports","all_in_scope"]', 0),
  ('invitations.manage', 'invitations.manage', 'People', 'Create and revoke invitations', '["all_in_scope"]', 0),
  ('roles.view', 'roles.view', 'Access', 'See roles and who holds them', '["all_in_scope"]', 0),
  ('roles.manage', 'roles.manage', 'Access', 'Edit roles, permissions, assignments', '["all_in_scope"]', 1),
  ('audit.view', 'audit.view', 'Access', 'Read the audit log', '["all_in_scope"]', 1),
  ('okr.view', 'okr.view', 'OKRs', 'See objectives and key results', '["own","my_teams","reports","all_in_scope"]', 0),
  ('okr.create', 'okr.create', 'OKRs', 'Create objectives and key results', '["own","my_teams","reports","all_in_scope"]', 0),
  ('okr.edit', 'okr.edit', 'OKRs', 'Edit objectives and key results', '["own","my_teams","reports","all_in_scope"]', 0),
  ('okr.archive', 'okr.archive', 'OKRs', 'Archive/cancel objectives', '["reports","all_in_scope"]', 0),
  ('okr.assign', 'okr.assign', 'OKRs', 'Assign owners and link parents', '["my_teams","reports","all_in_scope"]', 0),
  ('okr.update_progress', 'okr.update_progress', 'OKRs', 'Record actual key-result values', '["own","my_teams","reports","all_in_scope"]', 0),
  ('okr.publish', 'okr.publish', 'OKRs', 'Publish an objective for organization-wide visibility (leadership objectives)', '["all_in_scope"]', 0),
  ('kpi.view', 'kpi.view', 'KPIs', 'See KPI definitions, targets, measurements', '["own","my_teams","reports","all_in_scope"]', 0),
  ('kpi.configure', 'kpi.configure', 'KPIs', 'Create/edit KPIs, thresholds', '["all_in_scope"]', 0),
  ('kpi.assign', 'kpi.assign', 'KPIs', 'Assign KPIs to roles, teams, people', '["my_teams","reports","all_in_scope"]', 0),
  ('kpi.record', 'kpi.record', 'KPIs', 'Record measurements (new rows, never overwrite)', '["own","my_teams","reports","all_in_scope"]', 0),
  ('task.view', 'task.view', 'Tasks', 'See tasks', '["own","my_teams","reports","all_in_scope"]', 0),
  ('task.create', 'task.create', 'Tasks', 'Create tasks', '["own","my_teams","reports","all_in_scope"]', 0),
  ('task.assign', 'task.assign', 'Tasks', 'Assign or reassign tasks', '["my_teams","reports","all_in_scope"]', 0),
  ('task.edit', 'task.edit', 'Tasks', 'Edit others'' tasks', '["my_teams","reports","all_in_scope"]', 0),
  ('task.review', 'task.review', 'Tasks', 'Record outcome quality on completed tasks', '["my_teams","reports","all_in_scope"]', 0),
  ('evidence.view', 'evidence.view', 'Evidence', 'See evidence (not restricted)', '["own","my_teams","reports","all_in_scope"]', 0),
  ('evidence.submit', 'evidence.submit', 'Evidence', 'Attach evidence', '["own","my_teams","reports","all_in_scope"]', 0),
  ('evidence.verify', 'evidence.verify', 'Evidence', 'Mark evidence verified/rejected', '["my_teams","reports","all_in_scope"]', 0),
  ('evidence.view_restricted', 'evidence.view_restricted', 'Evidence', 'See restricted evidence', '["reports","all_in_scope"]', 1),
  ('performance.view_scores', 'performance.view_scores', 'Performance', 'See others'' scorecards and totals', '["reports","all_in_scope"]', 1),
  ('performance.view_components', 'performance.view_components', 'Performance', 'See component breakdown and inputs', '["reports","all_in_scope"]', 1),
  ('performance.recalculate', 'performance.recalculate', 'Performance', 'Trigger recalculation', '["reports","all_in_scope"]', 0),
  ('performance.configure', 'performance.configure', 'Performance', 'Edit scoring models and weights', '["all_in_scope"]', 1),
  ('performance.manage_periods', 'performance.manage_periods', 'Performance', 'Open/close/lock periods', '["all_in_scope"]', 0),
  ('performance.compare', 'performance.compare', 'Performance', 'Run peer/department comparisons', '["reports","all_in_scope"]', 1),
  ('reviews.write', 'reviews.write', 'Performance', 'Write reviews for people in scope', '["reports","all_in_scope"]', 0),
  ('reviews.read_shared', 'reviews.read_shared', 'Performance', 'Read shared review summaries', '["reports","all_in_scope"]', 0),
  ('reviews.read_private', 'reviews.read_private', 'Performance', 'Read private review notes', '["reports","all_in_scope"]', 1),
  ('mentorship.view', 'mentorship.view', 'Mentorship', 'See assignments and effectiveness', '["own","my_teams","reports","all_in_scope"]', 0),
  ('mentorship.manage', 'mentorship.manage', 'Mentorship', 'Create/end assignments', '["reports","all_in_scope"]', 0),
  ('mentorship.log', 'mentorship.log', 'Mentorship', 'Log activities and progress', '["own","reports","all_in_scope"]', 0),
  ('leadership.view', 'leadership.view', 'Leadership', 'Leadership dashboard and executive KPIs', '["all_in_scope"]', 1),
  ('ai.use', 'ai.use', 'AI', 'Use the AI Intelligence Center chat', '["own","my_teams","reports","all_in_scope"]', 0),
  ('ai.view_insights', 'ai.view_insights', 'AI', 'See insights and risk alerts (visibility still follows subject scope)', '["own","my_teams","reports","all_in_scope"]', 0),
  ('ai.approve', 'ai.approve', 'AI', 'Approve AI proposals (must also hold the underlying action permission)', '["reports","all_in_scope"]', 1),
  ('ai.configure', 'ai.configure', 'AI', 'AI settings, agent enablement', '["all_in_scope"]', 1),
  ('integrations.view', 'integrations.view', 'Integrations', 'See connected apps and automation history', '["all_in_scope"]', 0),
  ('integrations.manage', 'integrations.manage', 'Integrations', 'Embed token, connect apps, manage slots and rules', '["all_in_scope"]', 1),
  ('automations.retry', 'automations.retry', 'Integrations', 'Retry or cancel failed events', '["all_in_scope"]', 0),
  ('system.view', 'system.view', 'Operations', 'System panel (jobs, outbox backlog)', '["all_in_scope"]', 0),
  ('data.export', 'data.export', 'Operations', 'Export organization data', '["all_in_scope"]', 1),
  ('demo.manage', 'demo.manage', 'Operations', 'Load/remove demo data, view as demo persona', '["all_in_scope"]', 1);

-- Back-fill for organizations created before this stage (2.1 and 2.2): the Owner role (a role row with no
-- permissions until now) receives EVERY permission at all_in_scope, so the people who administered the organization
-- through the temporary Owner check keep exactly that access under the real engine. The other eight role templates
-- are added by the start-up step ensureRoleTemplates() (it only creates what is missing).
INSERT INTO role_permissions (organization_id, role_id, permission_id, scope_mode, created_at)
SELECT r.organization_id, r.id, p.id, 'all_in_scope', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM roles r CROSS JOIN permissions p
WHERE r.key = 'owner' AND r.kind = 'template';
