import type { ScopeMode } from "./catalog.js";

/**
 * The scope resolver (docs/permission-model.md section 1.1). For a permission P the caller's scope set is the union,
 * over their ACTIVE assignments A and every role row (P, S) of A's role, of
 *
 *     modeSet(S, caller)  ∩  assignmentScope(A)
 *
 * This file is pure: it has no database access. The hierarchy (teams, departments, reporting lines) arrives through
 * `HierarchyProvider`. Those tables do not exist before stages 2.5 and 2.6, so until then the provider is
 * `noHierarchy`: nobody belongs to a team, nobody reports to anyone, and "reports" means the caller alone.
 */
export interface ScopeSet {
  /** Everyone, every team and every department in the organization. */
  readonly all: boolean;
  readonly members: ReadonlySet<string>;
  readonly teams: ReadonlySet<string>;
  readonly departments: ReadonlySet<string>;
}

export const EMPTY_SCOPE: ScopeSet = { all: false, members: new Set(), teams: new Set(), departments: new Set() };
export const ALL_SCOPE: ScopeSet = { all: true, members: new Set(), teams: new Set(), departments: new Set() };

export const isEmptyScope = (s: ScopeSet): boolean => !s.all && s.members.size === 0 && s.teams.size === 0 && s.departments.size === 0;
export const scopeContainsMember = (s: ScopeSet, membershipId: string): boolean => s.all || s.members.has(membershipId);
export const scopeContainsTeam = (s: ScopeSet, teamId: string): boolean => s.all || s.teams.has(teamId);
export const scopeContainsDepartment = (s: ScopeSet, departmentId: string): boolean => s.all || s.departments.has(departmentId);

export interface Unit {
  members: ReadonlySet<string>;
  teams: ReadonlySet<string>;
  departments: ReadonlySet<string>;
}

/** What the hierarchy tables will answer once they exist (2.5 and 2.6). All answers are "as of" the evaluation date. */
export interface HierarchyProvider {
  /** Active members of every team the person belongs to, and those teams. */
  myTeams(membershipId: string, asOf: string): Unit;
  /** The person plus everyone below them in the reporting tree; the teams led by them or their reports; the departments they or their reports head. */
  reports(membershipId: string, asOf: string): Unit;
  /** Active members of a department and its child departments, with the teams inside them. */
  departmentSubtree(departmentId: string, asOf: string): Unit;
  /** Active members of a team and its sub-teams. */
  teamSubtree(teamId: string, asOf: string): Unit;
}

const none: ReadonlySet<string> = new Set();
/** Before stages 2.5 and 2.6 there are no teams, departments or reporting lines. */
export const noHierarchy: HierarchyProvider = {
  myTeams: () => ({ members: none, teams: none, departments: none }),
  reports: (m) => ({ members: new Set([m]), teams: none, departments: none }),
  departmentSubtree: () => ({ members: none, teams: none, departments: none }),
  teamSubtree: () => ({ members: none, teams: none, departments: none }),
};

export interface Grant {
  /** The assignment's scope. */
  scopeType: "organization" | "department" | "team" | "self";
  scopeId: string | null;
  permission: string;
  mode: ScopeMode;
}

const fromUnit = (u: Unit): ScopeSet => ({ all: false, members: u.members, teams: u.teams, departments: u.departments });

function modeSet(mode: ScopeMode, caller: string, h: HierarchyProvider, asOf: string): ScopeSet {
  switch (mode) {
    case "own":
      return { all: false, members: new Set([caller]), teams: none, departments: none };
    case "my_teams":
      return fromUnit(h.myTeams(caller, asOf));
    case "reports":
      return fromUnit(h.reports(caller, asOf));
    case "all_in_scope":
      return ALL_SCOPE;
  }
}

function assignmentScope(g: Grant, caller: string, h: HierarchyProvider, asOf: string): ScopeSet {
  switch (g.scopeType) {
    case "organization":
      return ALL_SCOPE;
    case "self":
      return { all: false, members: new Set([caller]), teams: none, departments: none };
    case "department":
      return g.scopeId ? fromUnit(h.departmentSubtree(g.scopeId, asOf)) : EMPTY_SCOPE;
    case "team":
      return g.scopeId ? fromUnit(h.teamSubtree(g.scopeId, asOf)) : EMPTY_SCOPE;
  }
}

const intersectSets = (a: ReadonlySet<string>, b: ReadonlySet<string>): ReadonlySet<string> => new Set([...a].filter((x) => b.has(x)));

export function intersect(a: ScopeSet, b: ScopeSet): ScopeSet {
  if (a.all) return b;
  if (b.all) return a;
  return { all: false, members: intersectSets(a.members, b.members), teams: intersectSets(a.teams, b.teams), departments: intersectSets(a.departments, b.departments) };
}

export function union(a: ScopeSet, b: ScopeSet): ScopeSet {
  if (a.all || b.all) return ALL_SCOPE;
  return { all: false, members: new Set([...a.members, ...b.members]), teams: new Set([...a.teams, ...b.teams]), departments: new Set([...a.departments, ...b.departments]) };
}

/** The scope set for one permission, from the caller's active grants. Empty means "not allowed". */
export function resolveScope(grants: readonly Grant[], permission: string, caller: string, h: HierarchyProvider, asOf: string): ScopeSet {
  let out = EMPTY_SCOPE;
  for (const g of grants) {
    if (g.permission !== permission) continue;
    out = union(out, intersect(modeSet(g.mode, caller, h, asOf), assignmentScope(g, caller, h, asOf)));
    if (out.all) break;
  }
  return out;
}

/** The modes a person holds for a permission (the raw grants, not the resolved people). */
export const modesFor = (grants: readonly Grant[], permission: string): ScopeMode[] => [...new Set(grants.filter((g) => g.permission === permission).map((g) => g.mode))];
