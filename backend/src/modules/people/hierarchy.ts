import type { HierarchyProvider, Unit } from "../permissions/resolver.js";
import type { StructureRepository } from "../organization/repositories/structure.js";
import type { PeopleRepository } from "./repositories/people.js";

/** Reporting lines that count towards "reports" (docs/permission-model.md section 1.2). Dotted and project lines are display only. */
export const SCOPE_LINE_TYPES: ReadonlySet<string> = new Set(["primary", "secondary"]);

const day = (asOf: string): string => asOf.slice(0, 10);
const set = (xs: Iterable<string>): Set<string> => new Set(xs);
const EMPTY: ReadonlySet<string> = new Set();

interface Snapshot {
  /** manager -> direct subordinates over primary and secondary lines active that day */
  under: Map<string, string[]>;
  teamMembers: Map<string, { id: string; type: string }[]>;
  teamsOfPerson: Map<string, string[]>;
  deptMembers: Map<string, { id: string; type: string }[]>;
  childDepts: Map<string, string[]>;
  childTeams: Map<string, string[]>;
  teamsInDept: Map<string, string[]>;
  people: ReadonlySet<string>;
}

const push = <V>(m: Map<string, V[]>, k: string, v: V) => m.set(k, [...(m.get(k) ?? []), v]);

/**
 * The real hierarchy for one organization, built from the tables on first use and kept for the life of the request
 * (a new instance is made per request, so a change is visible on the very next request). The scope resolver asks it the
 * four questions of `HierarchyProvider`; every answer is "as of" a day and only ever contains people who still belong.
 */
export class DbHierarchy implements HierarchyProvider {
  private readonly cache = new Map<string, Snapshot>();
  constructor(
    private readonly people: PeopleRepository,
    private readonly structure: StructureRepository,
  ) {}

  private snap(asOf: string): Snapshot {
    const d = day(asOf);
    let s = this.cache.get(d);
    if (s) return s;
    const under = new Map<string, string[]>();
    for (const r of this.people.reportingRows({ asOf: d })) if (SCOPE_LINE_TYPES.has(r.relationship_type)) push(under, r.manager_membership_id, r.subordinate_membership_id);
    const teamMembers = new Map<string, { id: string; type: string }[]>();
    const teamsOfPerson = new Map<string, string[]>();
    for (const r of this.people.teamRows({ asOf: d })) {
      push(teamMembers, r.team_id, { id: r.membership_id, type: r.membership_type });
      push(teamsOfPerson, r.membership_id, r.team_id);
    }
    const deptMembers = new Map<string, { id: string; type: string }[]>();
    for (const r of this.people.deptRows({ asOf: d })) push(deptMembers, r.department_id, { id: r.membership_id, type: r.membership_type });
    const childDepts = new Map<string, string[]>();
    for (const x of this.structure.departments()) if (x.parent_id) push(childDepts, x.parent_id, x.id);
    const childTeams = new Map<string, string[]>();
    const teamsInDept = new Map<string, string[]>();
    for (const t of this.structure.teams()) {
      if (t.parent_team_id) push(childTeams, t.parent_team_id, t.id);
      push(teamsInDept, t.department_id, t.id);
    }
    s = { under, teamMembers, teamsOfPerson, deptMembers, childDepts, childTeams, teamsInDept, people: set(this.people.activePersonIds()) };
    this.cache.set(d, s);
    return s;
  }

  private descendantsOf(start: string, kids: Map<string, string[]>): Set<string> {
    const out = new Set<string>([start]);
    const queue = [start];
    while (queue.length) for (const k of kids.get(queue.shift()!) ?? []) if (!out.has(k)) { out.add(k); queue.push(k); }
    return out;
  }

  private membersOfTeams(s: Snapshot, teams: Iterable<string>): Set<string> {
    const out = new Set<string>();
    for (const t of teams) for (const m of s.teamMembers.get(t) ?? []) if (s.people.has(m.id)) out.add(m.id);
    return out;
  }

  myTeams(membershipId: string, asOf: string): Unit {
    const s = this.snap(asOf);
    const teams = set(s.teamsOfPerson.get(membershipId) ?? []);
    return { members: this.membersOfTeams(s, teams), teams, departments: EMPTY };
  }

  reports(membershipId: string, asOf: string): Unit {
    const s = this.snap(asOf);
    const members = this.descendantsOf(membershipId, s.under);
    for (const m of [...members]) if (m !== membershipId && !s.people.has(m)) members.delete(m);
    // teams the person belongs to, plus teams led by them or anyone below them (with their sub-teams)
    const teams = set(s.teamsOfPerson.get(membershipId) ?? []);
    for (const [teamId, ms] of s.teamMembers) {
      if (ms.some((x) => x.type === "lead" && members.has(x.id))) for (const t of this.descendantsOf(teamId, s.childTeams)) teams.add(t);
    }
    // departments headed by them or anyone below them (with their sub-departments)
    const departments = new Set<string>();
    for (const [deptId, ms] of s.deptMembers) {
      if (ms.some((x) => x.type === "head" && members.has(x.id))) for (const d of this.descendantsOf(deptId, s.childDepts)) departments.add(d);
    }
    return { members, teams, departments };
  }

  departmentSubtree(departmentId: string, asOf: string): Unit {
    const s = this.snap(asOf);
    const departments = this.descendantsOf(departmentId, s.childDepts);
    const teams = new Set<string>();
    for (const d of departments) for (const t of s.teamsInDept.get(d) ?? []) teams.add(t);
    const members = this.membersOfTeams(s, teams);
    for (const d of departments) for (const m of s.deptMembers.get(d) ?? []) if (s.people.has(m.id)) members.add(m.id);
    return { members, teams, departments };
  }

  teamSubtree(teamId: string, asOf: string): Unit {
    const s = this.snap(asOf);
    const teams = this.descendantsOf(teamId, s.childTeams);
    return { members: this.membersOfTeams(s, teams), teams, departments: EMPTY };
  }
}
