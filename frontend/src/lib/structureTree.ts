import type { DepartmentItem, Structure, TeamItem } from "@/services/structure";

/** Child lists for drawing the tree. An item whose parent is not in the list (a scoped viewer) is drawn as a root. */
export interface StructureIndex {
  rootDepartments: DepartmentItem[];
  subDepartments: Map<string, DepartmentItem[]>;
  topTeams: Map<string, TeamItem[]>;
  subTeams: Map<string, TeamItem[]>;
}

export function indexStructure(s: Structure, includeArchived: boolean): StructureIndex {
  const keep = <T extends { archived: boolean }>(x: T) => includeArchived || !x.archived;
  const depts = s.departments.filter(keep);
  const teams = s.teams.filter(keep);
  const deptIds = new Set(depts.map((d) => d.id));
  const teamIds = new Set(teams.map((t) => t.id));
  const idx: StructureIndex = { rootDepartments: [], subDepartments: new Map(), topTeams: new Map(), subTeams: new Map() };
  const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => m.set(k, [...(m.get(k) ?? []), v]);
  for (const d of depts) {
    if (d.parentId && deptIds.has(d.parentId)) push(idx.subDepartments, d.parentId, d);
    else idx.rootDepartments.push(d);
  }
  for (const t of teams) {
    if (t.parentTeamId && teamIds.has(t.parentTeamId)) push(idx.subTeams, t.parentTeamId, t);
    else push(idx.topTeams, t.departmentId, t);
  }
  return idx;
}

/** The ids below `id` (not including it). */
export function descendantsOf<T extends { id: string }>(rows: T[], parentOf: (r: T) => string | null, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const r of rows) if (parentOf(r) === cur && !out.has(r.id)) {
      out.add(r.id);
      stack.push(r.id);
    }
  }
  return out;
}

/** "Level" of an item: 1 for a top-level one. */
export function levelOf<T extends { id: string }>(rows: T[], parentOf: (r: T) => string | null, id: string): number {
  const byId = new Map(rows.map((r) => [r.id, r]));
  let n = 0;
  for (let cur: string | null = id; cur && n < 20; cur = byId.get(cur) ? parentOf(byId.get(cur)!) : null) n += 1;
  return n;
}
