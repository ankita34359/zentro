import type { TenantCtx, TenantDb } from "../../db/tenant.js";
import { notFound } from "../../lib/errors.js";
import type { AuthStore } from "../auth/repositories/store.js";
import type { AuthContext, AuthService } from "../auth/service.js";
import type { Capabilities } from "../permissions/service.js";
import { cleanDay } from "./common.js";
import type { PeopleRepository, PersonRow } from "./repositories/people.js";

const MAX_TREE_DEPTH = 6;
const MAX_NODES = 400;

export interface TreeNode {
  /** `person`, `department` or `team`. */
  kind: "person" | "department" | "team";
  id: string;
  name: string;
  /** Designation for a person; a short description for a department or team (for example its head or lead). */
  subtitle: string | null;
  /** Visible children in total, whether or not they are included below. */
  childCount: number;
  /** null = not loaded (ask again with this node as the root). */
  children: TreeNode[] | null;
  /** People only: how this person is placed (teams) and whether they have a login. */
  detail?: string | null;
  isDemo?: boolean;
}

/** The chart (stage 2.7): the people tree in two views, loaded by depth. Read only. */
export class ChartService {
  constructor(private readonly o: { store: AuthStore; auth: AuthService }) {}

  private ctx(auth: AuthContext, requestId: string): TenantCtx {
    return this.o.auth.tenantCtx(auth, requestId);
  }
  private today = (): string => this.o.auth.iso().slice(0, 10);
  private repos(ctx: TenantCtx): { tdb: TenantDb; people: PeopleRepository } {
    const tdb = this.o.store.tenant(ctx);
    return { tdb, people: this.o.store.people(tdb) };
  }

  /**
   * The tree for the organization chart. `view=reporting` follows PRIMARY reporting lines; `view=organization` follows
   * department → sub-department / team → sub-team → people. `root` is a person (reporting) or a department / team
   * (organization, with `rootKind`); without it the top level is returned. `depth` levels below the root are included and
   * deeper nodes arrive on demand. A viewer sees only the part their `org.view` scope reaches.
   */
  tree(auth: AuthContext, requestId: string, caps: Capabilities, q: { view: "reporting" | "organization"; root?: string; rootKind?: "department" | "team"; depth?: number; asOf?: string }): { view: string; asOf: string; nodes: TreeNode[]; partial: boolean } {
    const ctx = this.ctx(auth, requestId);
    const { tdb, people } = this.repos(ctx);
    const asOf = cleanDay(q.asOf, "asOf") ?? this.today();
    const depth = Math.min(Math.max(q.depth ?? 2, 1), MAX_TREE_DEPTH);
    const scope = caps.scope("org.view");
    const live = people.people().filter((p) => p.archived_at === null && p.status !== "left" && (scope.all || p.id === auth.membershipId || scope.members.has(p.id)));
    const visible = new Set(live.map((p) => p.id));
    const byId = new Map(live.map((p) => [p.id, p]));
    const structure = this.o.store.structure(tdb);
    const designations = new Map(structure.designations().map((d) => [d.id, d.name]));
    const budget = { left: MAX_NODES };

    const personNode = (p: PersonRow, kids: TreeNode[] | null, count: number, detail: string | null): TreeNode => ({
      kind: "person", id: p.id, name: p.display_name, subtitle: p.designation_id ? designations.get(p.designation_id) ?? null : null, childCount: count, children: kids, detail,
    });

    if (q.view === "reporting") {
      const kids = new Map<string, string[]>();
      const hasPrimary = new Set<string>();
      for (const r of people.reportingRows({ asOf })) {
        if (r.relationship_type !== "primary" || !visible.has(r.subordinate_membership_id) || !visible.has(r.manager_membership_id)) continue;
        kids.set(r.manager_membership_id, [...(kids.get(r.manager_membership_id) ?? []), r.subordinate_membership_id]);
        hasPrimary.add(r.subordinate_membership_id);
      }
      const teamNames = this.teamNames(people, structure, asOf);
      const build = (id: string, level: number, path: Set<string>): TreeNode => {
        const p = byId.get(id)!;
        const children = (kids.get(id) ?? []).filter((k) => !path.has(k)).sort((a, b) => byId.get(a)!.display_name.localeCompare(byId.get(b)!.display_name));
        budget.left -= 1;
        const next = new Set(path).add(id);
        const loaded = level < depth && budget.left > 0 ? children.map((k) => build(k, level + 1, next)) : null;
        return personNode(p, loaded, children.length, teamNames.get(id) ?? null);
      };
      let roots: string[];
      if (q.root) {
        if (!visible.has(q.root)) throw notFound();
        roots = [q.root];
      } else {
        roots = live.filter((p) => !hasPrimary.has(p.id)).map((p) => p.id);
      }
      const nodes = roots.sort((a, b) => byId.get(a)!.display_name.localeCompare(byId.get(b)!.display_name)).map((id) => build(id, 1, new Set()));
      return { view: "reporting", asOf, nodes, partial: !scope.all };
    }

    // organization view
    const depts = structure.departments().filter((d) => d.archived_at === null && (scope.all || scope.departments.has(d.id)));
    const teams = structure.teams().filter((t) => t.archived_at === null && (scope.all || scope.teams.has(t.id)));
    const deptIds = new Set(depts.map((d) => d.id));
    const teamIds = new Set(teams.map((t) => t.id));
    const deptRows = people.deptRows({ asOf });
    const teamRows = people.teamRows({ asOf });
    const headOf = new Map(deptRows.filter((r) => r.membership_type === "head" && visible.has(r.membership_id)).map((r) => [r.department_id, byId.get(r.membership_id)!.display_name]));
    const leadOf = new Map(teamRows.filter((r) => r.membership_type === "lead" && visible.has(r.membership_id)).map((r) => [r.team_id, byId.get(r.membership_id)!.display_name]));
    const membersOfTeam = (teamId: string) => teamRows.filter((r) => r.team_id === teamId && visible.has(r.membership_id)).sort((a, b) => (a.membership_type === "lead" ? -1 : 0) - (b.membership_type === "lead" ? -1 : 0) || byId.get(a.membership_id)!.display_name.localeCompare(byId.get(b.membership_id)!.display_name));
    const looseInDept = (deptId: string) => deptRows.filter((r) => r.department_id === deptId && visible.has(r.membership_id) && !teamRows.some((t) => t.membership_id === r.membership_id && teamIds.has(t.team_id) && structure.team(t.team_id)?.department_id === deptId));

    const personLeaf = (membershipId: string, type: string): TreeNode => {
      budget.left -= 1;
      const p = byId.get(membershipId)!;
      return { kind: "person", id: p.id, name: p.display_name, subtitle: p.designation_id ? designations.get(p.designation_id) ?? null : null, childCount: 0, children: [], detail: type === "member" ? null : type.replace("_", " ") };
    };
    const buildTeam = (id: string, level: number): TreeNode => {
      const t = structure.team(id)!;
      const subs = teams.filter((x) => x.parent_team_id === id);
      const members = membersOfTeam(id);
      budget.left -= 1;
      const total = subs.length + members.length;
      const kids = level < depth && budget.left > 0 ? [...subs.map((s) => buildTeam(s.id, level + 1)), ...members.map((m) => personLeaf(m.membership_id, m.membership_type))] : null;
      return { kind: "team", id, name: t.name, subtitle: leadOf.has(id) ? `Lead: ${leadOf.get(id)}` : null, childCount: total, children: kids };
    };
    const buildDept = (id: string, level: number): TreeNode => {
      const d = structure.department(id)!;
      const subs = depts.filter((x) => x.parent_id === id);
      const ts = teams.filter((t) => t.department_id === id && t.parent_team_id === null);
      const loose = looseInDept(id);
      budget.left -= 1;
      const total = subs.length + ts.length + loose.length;
      const kids = level < depth && budget.left > 0 ? [...subs.map((s) => buildDept(s.id, level + 1)), ...ts.map((t) => buildTeam(t.id, level + 1)), ...loose.map((m) => personLeaf(m.membership_id, m.membership_type))] : null;
      return { kind: "department", id, name: d.name, subtitle: headOf.has(id) ? `Head: ${headOf.get(id)}` : null, childCount: total, children: kids };
    };
    let nodes: TreeNode[];
    if (q.root) {
      if (q.rootKind === "team") {
        if (!teamIds.has(q.root)) throw notFound();
        nodes = [buildTeam(q.root, 1)];
      } else {
        if (!deptIds.has(q.root)) throw notFound();
        nodes = [buildDept(q.root, 1)];
      }
    } else {
      // top level: departments whose parent is not visible (or that have none)
      nodes = depts.filter((d) => !d.parent_id || !deptIds.has(d.parent_id)).map((d) => buildDept(d.id, 1));
    }
    return { view: "organization", asOf, nodes, partial: !scope.all };
  }

  /** "Core, Infra" style team names per person for the reporting chart. */
  private teamNames(people: PeopleRepository, structure: ReturnType<AuthStore["structure"]>, asOf: string): Map<string, string> {
    const names = new Map(structure.teams().map((t) => [t.id, t.name]));
    const out = new Map<string, string[]>();
    for (const r of people.teamRows({ asOf })) out.set(r.membership_id, [...(out.get(r.membership_id) ?? []), names.get(r.team_id) ?? ""]);
    return new Map([...out].map(([k, v]) => [k, v.filter(Boolean).join(", ")]));
  }
}
