import type { TenantDb } from "../../db/tenant.js";
import { PeopleRepository } from "../people/repositories/people.js";
import { StructureRepository } from "../organization/repositories/structure.js";
import type { KpiAssignmentRow } from "./repositories/kpi.js";

/** Who is in which team, department, designation and role family TODAY: what KPI assignments are resolved against. */
export function loadDirectory(tdb: TenantDb, today: string) {
  const people = new PeopleRepository(tdb);
  const structure = new StructureRepository(tdb);
  const all = people.people();
  const live = all.filter((p) => p.archived_at === null && p.status !== "left");
  const liveIds = new Set(live.map((p) => p.id));
  const names = new Map(all.map((p) => [p.id, p.display_name]));
  const teams = new Map(structure.teams().map((t) => [t.id, t]));
  const depts = new Map(structure.departments().map((d) => [d.id, d]));
  const designations = new Map(structure.designations().map((d) => [d.id, d]));
  const families = new Map(structure.roleFamilies().map((f) => [f.id, f]));
  const teamRows = people.teamRows({ asOf: today });
  const deptRows = people.deptRows({ asOf: today });
  const teamMembers = new Map<string, Set<string>>();
  for (const r of teamRows) teamMembers.set(r.team_id, new Set([...(teamMembers.get(r.team_id) ?? []), r.membership_id]));
  const deptMembers = new Map<string, Set<string>>();
  for (const r of deptRows) deptMembers.set(r.department_id, new Set([...(deptMembers.get(r.department_id) ?? []), r.membership_id]));
  const managers = new Map<string, string[]>();
  for (const r of people.reportingRows({ asOf: today })) if (r.relationship_type === "primary") managers.set(r.subordinate_membership_id, [...(managers.get(r.subordinate_membership_id) ?? []), r.manager_membership_id]);

  /** The people a person, designation or role-family assignment covers today (a team or department assignment belongs to the team or department itself). */
  const holders = (a: KpiAssignmentRow): string[] => {
    if (a.membership_id) return liveIds.has(a.membership_id) ? [a.membership_id] : [];
    if (a.team_id) return [...(teamMembers.get(a.team_id) ?? [])].filter((m) => liveIds.has(m));
    if (a.department_id) return [...(deptMembers.get(a.department_id) ?? [])].filter((m) => liveIds.has(m));
    if (a.designation_id) return live.filter((p) => p.designation_id === a.designation_id).map((p) => p.id);
    const fam = a.role_family_id;
    return live.filter((p) => p.designation_id && designations.get(p.designation_id)?.role_family_id === fam).map((p) => p.id);
  };
  /** Who should hear about a subject's KPI: the person and their manager; a team's leads; a department's heads. */
  const listeners = (kind: "person" | "team" | "department" | "organization", id: string | null): string[] => {
    const out = new Set<string>();
    if (kind === "person" && id) {
      out.add(id);
      for (const m of managers.get(id) ?? []) out.add(m);
    } else if (kind === "team" && id) {
      for (const r of teamRows) if (r.team_id === id && (r.membership_type === "lead" || r.membership_type === "deputy_lead")) out.add(r.membership_id);
    } else if (kind === "department" && id) {
      for (const r of deptRows) if (r.department_id === id && r.membership_type === "head") out.add(r.membership_id);
    }
    return [...out].filter((m) => liveIds.has(m));
  };
  return { live, liveIds, names, teams, depts, designations, families, teamMembers, deptMembers, holders, listeners, people, structure };
}
export type Directory = ReturnType<typeof loadDirectory>;
