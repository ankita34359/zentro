import type { ScopeMode } from "./catalog.js";

/**
 * The nine role templates seeded into every organization (docs/permission-model.md section 3). They are DATA: once
 * seeded the organization edits them freely (stage 2.4) and nothing in code looks at a role's key or name. This file
 * is the one place those keys appear (a test greps the rest of backend/src and fails on any other use).
 *
 * Mode letters: O = own, T = my_teams, R = reports, S = all_in_scope. "R+T" is two grants.
 */
export interface RoleTemplate {
  key: string;
  name: string;
  description: string;
  /** The scope a person is normally assigned this role at (the assignment screen, 2.4, uses it as the default). */
  defaultScope: "organization" | "department" | "team";
  grants: Readonly<Record<string, readonly ScopeMode[]>>;
}

const O: ScopeMode = "own";
const T: ScopeMode = "my_teams";
const R: ScopeMode = "reports";
const S: ScopeMode = "all_in_scope";

/** Permissions every administrator-level template holds at S (keys listed once, for readability). */
const ALL_S = (keys: string[]): Record<string, readonly ScopeMode[]> => Object.fromEntries(keys.map((k) => [k, [S] as const]));

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    key: "owner",
    name: "Owner",
    description: "Full control of the organization. The highest role inside it.",
    defaultScope: "organization",
    // Owner = every permission at S (the migration back-fills exactly this for organizations created before 2.3).
    grants: {},
  },
  {
    key: "ceo",
    name: "CEO",
    description: "Company-wide visibility and strategy; no daily-task grants.",
    defaultScope: "organization",
    grants: {
      ...ALL_S(["org.view", "people.view", "org.manage", "hierarchy.manage", "people.manage", "people.view_sensitive", "invitations.manage", "roles.view",
        "okr.view", "okr.create", "okr.edit", "okr.assign", "okr.archive", "okr.update_progress", "okr.publish", "kpi.view", "kpi.configure", "kpi.assign", "kpi.record",
        "task.view", "evidence.submit", "evidence.view", "performance.view_scores", "performance.view_components", "performance.compare", "reviews.write", "reviews.read_shared",
        "mentorship.view", "leadership.view", "ai.use", "ai.view_insights", "ai.approve"]),
    },
  },
  {
    key: "senior_management",
    name: "Senior Management",
    description: "Company-wide visibility without administration.",
    defaultScope: "organization",
    grants: {
      ...ALL_S(["org.view", "people.view", "okr.view", "okr.create", "okr.edit", "okr.assign", "okr.update_progress", "kpi.view", "kpi.record", "task.view", "evidence.submit", "evidence.view",
        "performance.view_scores", "performance.view_components", "reviews.write", "reviews.read_shared", "mentorship.view", "leadership.view", "ai.use", "ai.view_insights"]),
    },
  },
  {
    key: "department_head",
    name: "Department Head",
    description: "Runs one department: people, objectives, KPIs and tasks inside it.",
    defaultScope: "department",
    grants: {
      ...ALL_S(["org.view", "people.view", "org.manage", "hierarchy.manage", "people.manage", "people.view_sensitive", "invitations.manage", "okr.view", "okr.create", "okr.edit", "okr.assign", "okr.archive",
        "okr.update_progress", "kpi.view", "kpi.configure", "kpi.assign", "kpi.record", "task.view", "task.create", "task.assign", "task.edit", "task.review", "evidence.submit", "evidence.verify",
        "evidence.view", "evidence.view_restricted", "performance.view_scores", "performance.view_components", "performance.compare", "performance.recalculate", "reviews.write", "reviews.read_shared",
        "mentorship.view", "mentorship.manage", "mentorship.log", "ai.use", "ai.view_insights", "ai.approve"]),
    },
  },
  {
    key: "manager",
    name: "Manager",
    description: "Manages the people who report to them.",
    defaultScope: "organization",
    grants: {
      "org.view": [R, T], "people.view": [R, T], "people.manage": [R], "people.view_sensitive": [R],
      "okr.view": [R, T], "okr.create": [R], "okr.edit": [R], "okr.assign": [R], "okr.update_progress": [R],
      "kpi.view": [R, T], "kpi.assign": [R], "kpi.record": [R],
      "task.view": [R], "task.create": [R], "task.assign": [R], "task.edit": [R], "task.review": [R],
      "evidence.submit": [R], "evidence.verify": [R], "evidence.view": [R], "evidence.view_restricted": [R],
      "performance.view_scores": [R], "performance.view_components": [R], "performance.compare": [R], "performance.recalculate": [R],
      "reviews.write": [R], "reviews.read_shared": [R], "mentorship.view": [R], "mentorship.manage": [R], "mentorship.log": [R],
      "ai.use": [R], "ai.view_insights": [R], "ai.approve": [R],
    },
  },
  {
    key: "team_lead",
    name: "Team Lead",
    description: "Leads one team and its sub-teams.",
    defaultScope: "team",
    grants: {
      "org.view": [R, T], "people.view": [R, T],
      "okr.view": [R, T], "okr.create": [R], "okr.edit": [R], "okr.assign": [R], "okr.update_progress": [R],
      "kpi.view": [R, T], "kpi.assign": [R], "kpi.record": [R],
      "task.view": [R], "task.create": [R], "task.assign": [R], "task.edit": [R], "task.review": [R],
      "evidence.submit": [R], "evidence.verify": [R], "evidence.view": [R],
      "performance.view_scores": [R], "performance.view_components": [R], "reviews.write": [R], "reviews.read_shared": [R],
      "mentorship.view": [R], "mentorship.manage": [R], "mentorship.log": [R], "ai.use": [R], "ai.view_insights": [R], "ai.approve": [R],
    },
  },
  {
    key: "mentor",
    name: "Mentor",
    description: "Guides mentees; sees their team and their mentees' progress.",
    defaultScope: "organization",
    grants: {
      "org.view": [T], "people.view": [T],
      "okr.view": [T], "okr.create": [O], "okr.edit": [O], "okr.update_progress": [O],
      "kpi.view": [T], "kpi.record": [O],
      "task.view": [T], "task.create": [O], "task.review": [R],
      "evidence.submit": [O], "evidence.verify": [R], "evidence.view": [T],
      "performance.view_scores": [R], "performance.view_components": [R], "reviews.write": [R], "reviews.read_shared": [R],
      "mentorship.view": [O], "mentorship.log": [O], "ai.use": [T], "ai.view_insights": [T],
    },
  },
  {
    key: "employee",
    name: "Employee",
    description: "Works on their own objectives and tasks and sees their own score.",
    defaultScope: "organization",
    grants: {
      "org.view": [T], "people.view": [T], "people.view_sensitive": [O],
      "okr.view": [O, T], "okr.create": [O], "okr.edit": [O], "okr.update_progress": [O],
      "kpi.view": [O, T], "kpi.record": [O],
      "task.view": [O, T], "task.create": [O],
      "evidence.submit": [O], "evidence.view": [O],
      "mentorship.view": [O], "ai.use": [O], "ai.view_insights": [O],
    },
  },
  {
    key: "intern",
    name: "Intern",
    description: "Like an employee with fewer grants.",
    defaultScope: "organization",
    grants: {
      "org.view": [T], "people.view": [T], "people.view_sensitive": [O],
      "okr.view": [O, T], "okr.update_progress": [O],
      "kpi.view": [O], "kpi.record": [O],
      "task.view": [O, T], "task.create": [O],
      "evidence.submit": [O], "evidence.view": [O],
      "mentorship.view": [O], "ai.use": [O], "ai.view_insights": [O],
    },
  },
];

/** The template keys, for the few places that must name one (the demo seed). Everything else treats roles as data. */
export const TEMPLATE_KEYS = {
  owner: "owner",
  ceo: "ceo",
  seniorManagement: "senior_management",
  departmentHead: "department_head",
  manager: "manager",
  teamLead: "team_lead",
  mentor: "mentor",
  employee: "employee",
  intern: "intern",
} as const;

/** The template the person who creates an organization is assigned (organization-wide). */
export const CREATOR_ROLE_KEY = "owner";
