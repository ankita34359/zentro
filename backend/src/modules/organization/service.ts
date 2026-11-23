import type { TenantCtx } from "../../db/tenant.js";
import { HttpError, notFound, permissionDenied } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import type { AuditService } from "../audit/service.js";
import type { AuthStore } from "../auth/repositories/store.js";
import type { AuthContext, AuthService } from "../auth/service.js";
import type { Capabilities } from "../permissions/service.js";
import type { DepartmentRow, DesignationRow, Kind, RoleFamilyRow, StructureRepository, TeamRow } from "./repositories/structure.js";

/** Departments and teams may nest this many levels (a top-level department is level 1). Free depth below the cap. */
export const MAX_DEPTH = 8;

export interface DepartmentView { id: string; parentId: string | null; name: string; description: string; archived: boolean; archivedAt: string | null }
export interface TeamView { id: string; departmentId: string; parentTeamId: string | null; name: string; description: string; archived: boolean; archivedAt: string | null }
export interface RoleFamilyView { id: string; name: string; description: string; archived: boolean; archivedAt: string | null }
export interface DesignationView { id: string; roleFamilyId: string | null; name: string; description: string; archived: boolean; archivedAt: string | null }
export interface StructureView {
  departments: DepartmentView[];
  teams: TeamView[];
  roleFamilies: RoleFamilyView[];
  designations: DesignationView[];
  limits: { maxDepth: number };
  /** True when the caller sees only part of the structure (a scoped `org.view`). */
  partial: boolean;
}

const dept = (r: DepartmentRow): DepartmentView => ({ id: r.id, parentId: r.parent_id, name: r.name, description: r.description, archived: r.archived_at !== null, archivedAt: r.archived_at });
const team = (r: TeamRow): TeamView => ({ id: r.id, departmentId: r.department_id, parentTeamId: r.parent_team_id, name: r.name, description: r.description, archived: r.archived_at !== null, archivedAt: r.archived_at });
const family = (r: RoleFamilyRow): RoleFamilyView => ({ id: r.id, name: r.name, description: r.description, archived: r.archived_at !== null, archivedAt: r.archived_at });
const desig = (r: DesignationRow): DesignationView => ({ id: r.id, roleFamilyId: r.role_family_id, name: r.name, description: r.description, archived: r.archived_at !== null, archivedAt: r.archived_at });

const LABEL: Record<Kind, string> = { department: "department", team: "team", roleFamily: "role family", designation: "designation" };

/** Single spaces, trimmed, 1 to 80 characters, no control characters. */
export function cleanName(raw: string): string {
  const n = raw.replace(/\s+/g, " ").trim();
  // eslint-disable-next-line no-control-regex
  if (n.length < 1 || n.length > 80 || /[\u0000-\u001f\u007f]/.test(n)) throw new HttpError(400, "invalid_name", "A name is 1 to 80 characters, without control characters.");
  return n;
}
const cleanDescription = (raw: string | undefined, fallback = ""): string => {
  const d = (raw ?? fallback).trim();
  if (d.length > 500) throw new HttpError(400, "invalid_description", "A description is at most 500 characters.");
  return d;
};

/**
 * The organization's structure (stage 2.5). Every change is one transaction that also writes its audit row. Nothing is
 * ever deleted: archived items stay in the tables and can be restored. Rules: a name is unique among active siblings
 * (any letter case); departments nest at most MAX_DEPTH levels and a department cannot move under itself; a team
 * belongs to one department, its sub-teams share it, and sub-teams nest at most MAX_DEPTH levels; an item with active
 * children cannot be archived; a restore needs an active parent. Heads, leads and members arrive in stage 2.6.
 */
export class StructureService {
  constructor(private readonly o: { store: AuthStore; auth: AuthService; audit: AuditService }) {}

  private ctx(auth: AuthContext, requestId: string): TenantCtx {
    return this.o.auth.tenantCtx(auth, requestId);
  }
  private now = (): string => this.o.auth.iso();
  private repo(ctx: TenantCtx): StructureRepository {
    return this.o.store.structure(this.o.store.tenant(ctx));
  }
  /** Creating, renaming, moving and archiving structure needs `org.manage` for the whole organization. */
  private requireManage(caps: Capabilities): void {
    if (!caps.scope("org.manage").all) throw permissionDenied();
  }

  // ---------- organization settings ----------

  /** Renames the organization (the display name; the slug and the id never change). Needs the sensitive `org.settings`. */
  renameOrganization(auth: AuthContext, requestId: string, caps: Capabilities, rawName: string): { id: string; name: string } {
    if (!caps.scope("org.settings").all) throw permissionDenied();
    const ctx = this.ctx(auth, requestId);
    const name = cleanName(rawName);
    const cur = this.o.store.orgs.findById(ctx.organizationId);
    if (!cur) throw notFound();
    if (cur.name !== name) {
      this.o.store.transaction(() => {
        this.o.store.orgs.rename(ctx.organizationId, name, this.now());
        this.o.audit.record(this.o.store.tenant(ctx), ctx, { action: "organization.rename", entityType: "organization", entityId: ctx.organizationId, summary: `Renamed the organization from "${cur.name}" to "${name}"`, before: { name: cur.name }, after: { name } });
      });
    }
    return { id: ctx.organizationId, name };
  }

  // ---------- reading ----------

  view(auth: AuthContext, requestId: string, caps: Capabilities): StructureView {
    const r = this.repo(this.ctx(auth, requestId));
    const scope = caps.scope("org.view");
    let departments = r.departments().map(dept);
    let teams = r.teams().map(team);
    if (!scope.all) {
      // A scoped viewer sees the departments and teams in their scope, and the departments above them so the tree still reads.
      const keepT = new Set(scope.teams);
      const keepD = new Set(scope.departments);
      for (const t of teams) if (keepT.has(t.id)) keepD.add(t.departmentId);
      const byId = new Map(departments.map((d) => [d.id, d]));
      for (const id of [...keepD]) for (let p = byId.get(id)?.parentId; p; p = byId.get(p)?.parentId) keepD.add(p);
      departments = departments.filter((d) => keepD.has(d.id));
      teams = teams.filter((t) => keepT.has(t.id));
    }
    return { departments, teams, roleFamilies: r.roleFamilies().map(family), designations: r.designations().map(desig), limits: { maxDepth: MAX_DEPTH }, partial: !scope.all };
  }

  // ---------- generic helpers ----------

  private audit(ctx: TenantCtx, tdbAction: string, kind: Kind, id: string, summary: string, before?: unknown, after?: unknown): void {
    this.o.audit.record(this.o.store.tenant(ctx), ctx, { action: `${kind === "roleFamily" ? "role_family" : kind}.${tdbAction}`, entityType: kind === "roleFamily" ? "role_family" : kind, entityId: id, summary, before, after });
  }

  private taken(kind: Kind): HttpError {
    return new HttpError(409, "name_taken", `There is already an active ${LABEL[kind]} with that name here. Choose another name.`);
  }

  /** Levels of a department chain from the root to this department (a top-level department is 1). */
  private deptLevel(all: Map<string, DepartmentRow>, id: string | null): number {
    let n = 0;
    for (let cur = id; cur; cur = all.get(cur)?.parent_id ?? null) {
      n += 1;
      if (n > MAX_DEPTH + 2) break; // a corrupt chain can never loop forever
    }
    return n;
  }
  private teamLevel(all: Map<string, TeamRow>, id: string | null): number {
    let n = 0;
    for (let cur = id; cur; cur = all.get(cur)?.parent_team_id ?? null) {
      n += 1;
      if (n > MAX_DEPTH + 2) break;
    }
    return n;
  }
  /** Height of the subtree under `id`, counting `id` itself as 1. */
  private height<T extends { id: string }>(rows: T[], parentOf: (r: T) => string | null, id: string): number {
    const kids = new Map<string, T[]>();
    for (const r of rows) {
      const p = parentOf(r);
      if (p) kids.set(p, [...(kids.get(p) ?? []), r]);
    }
    const walk = (cur: string, depth: number): number => (kids.get(cur) ?? []).reduce((m, k) => Math.max(m, walk(k.id, depth + 1)), depth);
    return walk(id, 1);
  }
  private descendants<T extends { id: string }>(rows: T[], parentOf: (r: T) => string | null, id: string): Set<string> {
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
  private tooDeep(kind: "department" | "team"): HttpError {
    return new HttpError(400, "depth_exceeded", `A ${kind} can be nested at most ${MAX_DEPTH} levels deep.`);
  }
  private parentArchived(kind: Kind): HttpError {
    return new HttpError(409, "parent_archived", `The parent ${LABEL[kind]} is archived. Restore it first.`);
  }

  // ---------- departments ----------

  createDepartment(auth: AuthContext, requestId: string, caps: Capabilities, input: { name: string; description?: string; parentId?: string | null }): DepartmentView {
    this.requireManage(caps);
    const ctx = this.ctx(auth, requestId);
    const r = this.repo(ctx);
    const name = cleanName(input.name);
    const parentId = input.parentId ?? null;
    if (parentId) {
      const all = new Map(r.departments().map((d) => [d.id, d]));
      const parent = all.get(parentId);
      if (!parent) throw notFound();
      if (parent.archived_at) throw this.parentArchived("department");
      if (this.deptLevel(all, parentId) + 1 > MAX_DEPTH) throw this.tooDeep("department");
    }
    if (r.departmentNameTaken(parentId, name, null)) throw this.taken("department");
    const id = newId();
    this.o.store.transaction(() => {
      r.insertDepartment({ id, parentId, name, description: cleanDescription(input.description), now: this.now() });
      this.audit(ctx, "create", "department", id, `Created the department "${name}"`, undefined, { name, parentId });
    });
    return dept(r.department(id)!);
  }

  updateDepartment(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: { name?: string; description?: string; parentId?: string | null }): DepartmentView {
    this.requireManage(caps);
    const ctx = this.ctx(auth, requestId);
    const r = this.repo(ctx);
    const rows = r.departments();
    const all = new Map(rows.map((d) => [d.id, d]));
    const cur = all.get(id);
    if (!cur) throw notFound();
    if (cur.archived_at) throw new HttpError(409, "archived", "This department is archived. Restore it before changing it.");
    const name = input.name !== undefined ? cleanName(input.name) : cur.name;
    const description = cleanDescription(input.description, cur.description);
    const moving = input.parentId !== undefined && input.parentId !== cur.parent_id;
    const parentId = input.parentId === undefined ? cur.parent_id : input.parentId;
    if (moving && parentId) {
      const parent = all.get(parentId);
      if (!parent) throw notFound();
      if (parent.archived_at) throw this.parentArchived("department");
      if (parentId === id || this.descendants(rows, (d) => d.parent_id, id).has(parentId)) {
        throw new HttpError(409, "would_create_cycle", "A department cannot be moved under itself or one of its own sub-departments.");
      }
      if (this.deptLevel(all, parentId) + this.height(rows, (d) => d.parent_id, id) > MAX_DEPTH) throw this.tooDeep("department");
    }
    if ((moving || name !== cur.name) && r.departmentNameTaken(parentId, name, id)) throw this.taken("department");
    if (!moving && name === cur.name && description === cur.description) return dept(cur);
    this.o.store.transaction(() => {
      r.updateDepartment({ id, parentId, name, description, now: this.now() });
      const parentName = parentId ? all.get(parentId)?.name : null;
      const action = moving ? "move" : name !== cur.name ? "rename" : "update";
      const summary = moving ? `Moved the department "${cur.name}" ${parentName ? `under "${parentName}"` : "to the top level"}` : name !== cur.name ? `Renamed the department "${cur.name}" to "${name}"` : `Changed the description of the department "${cur.name}"`;
      this.audit(ctx, action, "department", id, summary, { name: cur.name, parentId: cur.parent_id, description: cur.description }, { name, parentId, description });
    });
    return dept(r.department(id)!);
  }

  archiveDepartment(auth: AuthContext, requestId: string, caps: Capabilities, id: string): void {
    this.requireManage(caps);
    const ctx = this.ctx(auth, requestId);
    const r = this.repo(ctx);
    const cur = r.department(id);
    if (!cur) throw notFound();
    if (cur.archived_at) throw new HttpError(409, "already_archived", "This department is already archived.");
    const subs = r.departments().filter((d) => d.parent_id === id && !d.archived_at).length;
    const teams = r.teams().filter((t) => t.department_id === id && !t.archived_at).length;
    if (subs + teams > 0) {
      throw new HttpError(409, "has_active_children", `This department still has ${subs} active sub-${subs === 1 ? "department" : "departments"} and ${teams} active ${teams === 1 ? "team" : "teams"}. Move or archive them first.`, { subDepartments: subs, teams });
    }
    const inside = this.o.store.people(this.o.store.tenant(ctx)).openDeptMemberCount(id);
    if (inside > 0) throw new HttpError(409, "has_active_members", `${inside} ${inside === 1 ? "person is" : "people are"} still in this department. Move or end their membership first.`, { members: inside });
    this.o.store.transaction(() => {
      r.setArchived("department", id, this.now(), this.now());
      this.audit(ctx, "archive", "department", id, `Archived the department "${cur.name}"`);
    });
  }

  restoreDepartment(auth: AuthContext, requestId: string, caps: Capabilities, id: string): DepartmentView {
    this.requireManage(caps);
    const ctx = this.ctx(auth, requestId);
    const r = this.repo(ctx);
    const all = new Map(r.departments().map((d) => [d.id, d]));
    const cur = all.get(id);
    if (!cur) throw notFound();
    if (!cur.archived_at) throw new HttpError(409, "not_archived", "This department is not archived.");
    if (cur.parent_id && all.get(cur.parent_id)?.archived_at) throw this.parentArchived("department");
    if (r.departmentNameTaken(cur.parent_id, cur.name, id)) throw this.taken("department");
    this.o.store.transaction(() => {
      r.setArchived("department", id, null, this.now());
      this.audit(ctx, "restore", "department", id, `Restored the department "${cur.name}"`);
    });
    return dept(r.department(id)!);
  }

  // ---------- teams (and sub-teams) ----------

  createTeam(auth: AuthContext, requestId: string, caps: Capabilities, input: { name: string; description?: string; departmentId: string; parentTeamId?: string | null }): TeamView {
    this.requireManage(caps);
    const ctx = this.ctx(auth, requestId);
    const r = this.repo(ctx);
    const name = cleanName(input.name);
    const department = r.department(input.departmentId);
    if (!department) throw notFound();
    if (department.archived_at) throw this.parentArchived("department");
    const parentTeamId = input.parentTeamId ?? null;
    if (parentTeamId) {
      const all = new Map(r.teams().map((t) => [t.id, t]));
      const parent = all.get(parentTeamId);
      if (!parent) throw notFound();
      if (parent.archived_at) throw this.parentArchived("team");
      if (parent.department_id !== department.id) throw new HttpError(400, "wrong_department", "A sub-team must be in the same department as its parent team.");
      if (this.teamLevel(all, parentTeamId) + 1 > MAX_DEPTH) throw this.tooDeep("team");
    }
    if (r.teamNameTaken(department.id, parentTeamId, name, null)) throw this.taken("team");
    const id = newId();
    this.o.store.transaction(() => {
      r.insertTeam({ id, departmentId: department.id, parentTeamId, name, description: cleanDescription(input.description), now: this.now() });
      this.audit(ctx, "create", "team", id, `Created the ${parentTeamId ? "sub-team" : "team"} "${name}" in "${department.name}"`, undefined, { name, departmentId: department.id, parentTeamId });
    });
    return team(r.team(id)!);
  }

  /**
   * Rename, change the description, or move. `departmentId` moves the team (and its sub-teams) to another department;
   * if `parentTeamId` is not given in that case the team becomes a top-level team there. `parentTeamId: null` makes it top-level.
   */
  updateTeam(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: { name?: string; description?: string; departmentId?: string; parentTeamId?: string | null }): TeamView {
    this.requireManage(caps);
    const ctx = this.ctx(auth, requestId);
    const r = this.repo(ctx);
    const rows = r.teams();
    const all = new Map(rows.map((t) => [t.id, t]));
    const cur = all.get(id);
    if (!cur) throw notFound();
    if (cur.archived_at) throw new HttpError(409, "archived", "This team is archived. Restore it before changing it.");
    const name = input.name !== undefined ? cleanName(input.name) : cur.name;
    const description = cleanDescription(input.description, cur.description);
    const departmentId = input.departmentId ?? cur.department_id;
    const deptChanged = departmentId !== cur.department_id;
    const parentTeamId = input.parentTeamId !== undefined ? input.parentTeamId : deptChanged ? null : cur.parent_team_id;
    const moving = deptChanged || parentTeamId !== cur.parent_team_id;
    let departmentName = "";
    if (moving) {
      const department = r.department(departmentId);
      if (!department) throw notFound();
      if (department.archived_at) throw this.parentArchived("department");
      departmentName = department.name;
      if (parentTeamId) {
        const parent = all.get(parentTeamId);
        if (!parent) throw notFound();
        if (parent.archived_at) throw this.parentArchived("team");
        if (parent.department_id !== departmentId) throw new HttpError(400, "wrong_department", "A sub-team must be in the same department as its parent team.");
        if (parentTeamId === id || this.descendants(rows, (t) => t.parent_team_id, id).has(parentTeamId)) {
          throw new HttpError(409, "would_create_cycle", "A team cannot be moved under itself or one of its own sub-teams.");
        }
      }
      if (this.teamLevel(all, parentTeamId) + this.height(rows, (t) => t.parent_team_id, id) > MAX_DEPTH) throw this.tooDeep("team");
    }
    if ((moving || name !== cur.name) && r.teamNameTaken(departmentId, parentTeamId, name, id)) throw this.taken("team");
    if (!moving && name === cur.name && description === cur.description) return team(cur);
    this.o.store.transaction(() => {
      r.updateTeam({ id, departmentId, parentTeamId, name, description, now: this.now() });
      if (deptChanged) for (const d of this.descendants(rows, (t) => t.parent_team_id, id)) r.setTeamDepartment(d, departmentId, this.now());
      const action = moving ? "move" : name !== cur.name ? "rename" : "update";
      const summary = moving ? `Moved the team "${cur.name}" to "${departmentName}"${parentTeamId ? ` under "${all.get(parentTeamId)?.name}"` : ""}` : name !== cur.name ? `Renamed the team "${cur.name}" to "${name}"` : `Changed the description of the team "${cur.name}"`;
      this.audit(ctx, action, "team", id, summary, { name: cur.name, departmentId: cur.department_id, parentTeamId: cur.parent_team_id, description: cur.description }, { name, departmentId, parentTeamId, description });
    });
    return team(r.team(id)!);
  }

  archiveTeam(auth: AuthContext, requestId: string, caps: Capabilities, id: string): void {
    this.requireManage(caps);
    const ctx = this.ctx(auth, requestId);
    const r = this.repo(ctx);
    const cur = r.team(id);
    if (!cur) throw notFound();
    if (cur.archived_at) throw new HttpError(409, "already_archived", "This team is already archived.");
    const subs = r.teams().filter((t) => t.parent_team_id === id && !t.archived_at).length;
    if (subs > 0) throw new HttpError(409, "has_active_children", `This team still has ${subs} active ${subs === 1 ? "sub-team" : "sub-teams"}. Move or archive ${subs === 1 ? "it" : "them"} first.`, { subTeams: subs });
    const inside = this.o.store.people(this.o.store.tenant(ctx)).openTeamMemberCount(id);
    if (inside > 0) throw new HttpError(409, "has_active_members", `${inside} ${inside === 1 ? "person is" : "people are"} still in this team. Move or end their membership first.`, { members: inside });
    this.o.store.transaction(() => {
      r.setArchived("team", id, this.now(), this.now());
      this.audit(ctx, "archive", "team", id, `Archived the team "${cur.name}"`);
    });
  }

  restoreTeam(auth: AuthContext, requestId: string, caps: Capabilities, id: string): TeamView {
    this.requireManage(caps);
    const ctx = this.ctx(auth, requestId);
    const r = this.repo(ctx);
    const all = new Map(r.teams().map((t) => [t.id, t]));
    const cur = all.get(id);
    if (!cur) throw notFound();
    if (!cur.archived_at) throw new HttpError(409, "not_archived", "This team is not archived.");
    if (r.department(cur.department_id)?.archived_at) throw this.parentArchived("department");
    if (cur.parent_team_id && all.get(cur.parent_team_id)?.archived_at) throw this.parentArchived("team");
    if (r.teamNameTaken(cur.department_id, cur.parent_team_id, cur.name, id)) throw this.taken("team");
    this.o.store.transaction(() => {
      r.setArchived("team", id, null, this.now());
      this.audit(ctx, "restore", "team", id, `Restored the team "${cur.name}"`);
    });
    return team(r.team(id)!);
  }

  // ---------- role families ----------

  createRoleFamily(auth: AuthContext, requestId: string, caps: Capabilities, input: { name: string; description?: string }): RoleFamilyView {
    this.requireManage(caps);
    const ctx = this.ctx(auth, requestId);
    const r = this.repo(ctx);
    const name = cleanName(input.name);
    if (r.roleFamilyNameTaken(name, null)) throw this.taken("roleFamily");
    const id = newId();
    this.o.store.transaction(() => {
      r.insertRoleFamily({ id, name, description: cleanDescription(input.description), now: this.now() });
      this.audit(ctx, "create", "roleFamily", id, `Created the role family "${name}"`, undefined, { name });
    });
    return family(r.roleFamily(id)!);
  }

  updateRoleFamily(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: { name?: string; description?: string }): RoleFamilyView {
    this.requireManage(caps);
    const ctx = this.ctx(auth, requestId);
    const r = this.repo(ctx);
    const cur = r.roleFamily(id);
    if (!cur) throw notFound();
    if (cur.archived_at) throw new HttpError(409, "archived", "This role family is archived. Restore it before changing it.");
    const name = input.name !== undefined ? cleanName(input.name) : cur.name;
    const description = cleanDescription(input.description, cur.description);
    if (name !== cur.name && r.roleFamilyNameTaken(name, id)) throw this.taken("roleFamily");
    if (name === cur.name && description === cur.description) return family(cur);
    this.o.store.transaction(() => {
      r.updateRoleFamily({ id, name, description, now: this.now() });
      this.audit(ctx, name !== cur.name ? "rename" : "update", "roleFamily", id, name !== cur.name ? `Renamed the role family "${cur.name}" to "${name}"` : `Changed the description of the role family "${cur.name}"`, { name: cur.name, description: cur.description }, { name, description });
    });
    return family(r.roleFamily(id)!);
  }

  archiveRoleFamily(auth: AuthContext, requestId: string, caps: Capabilities, id: string): void {
    this.requireManage(caps);
    const ctx = this.ctx(auth, requestId);
    const r = this.repo(ctx);
    const cur = r.roleFamily(id);
    if (!cur) throw notFound();
    if (cur.archived_at) throw new HttpError(409, "already_archived", "This role family is already archived.");
    const n = r.designations().filter((d) => d.role_family_id === id && !d.archived_at).length;
    if (n > 0) throw new HttpError(409, "has_active_children", `This role family still has ${n} active ${n === 1 ? "designation" : "designations"}. Move or archive ${n === 1 ? "it" : "them"} first.`, { designations: n });
    this.o.store.transaction(() => {
      r.setArchived("roleFamily", id, this.now(), this.now());
      this.audit(ctx, "archive", "roleFamily", id, `Archived the role family "${cur.name}"`);
    });
  }

  restoreRoleFamily(auth: AuthContext, requestId: string, caps: Capabilities, id: string): RoleFamilyView {
    this.requireManage(caps);
    const ctx = this.ctx(auth, requestId);
    const r = this.repo(ctx);
    const cur = r.roleFamily(id);
    if (!cur) throw notFound();
    if (!cur.archived_at) throw new HttpError(409, "not_archived", "This role family is not archived.");
    if (r.roleFamilyNameTaken(cur.name, id)) throw this.taken("roleFamily");
    this.o.store.transaction(() => {
      r.setArchived("roleFamily", id, null, this.now());
      this.audit(ctx, "restore", "roleFamily", id, `Restored the role family "${cur.name}"`);
    });
    return family(r.roleFamily(id)!);
  }

  // ---------- designations ----------

  private requireActiveFamily(r: StructureRepository, familyId: string | null): void {
    if (!familyId) return;
    const f = r.roleFamily(familyId);
    if (!f) throw notFound();
    if (f.archived_at) throw this.parentArchived("roleFamily");
  }

  createDesignation(auth: AuthContext, requestId: string, caps: Capabilities, input: { name: string; description?: string; roleFamilyId?: string | null }): DesignationView {
    this.requireManage(caps);
    const ctx = this.ctx(auth, requestId);
    const r = this.repo(ctx);
    const name = cleanName(input.name);
    const roleFamilyId = input.roleFamilyId ?? null;
    this.requireActiveFamily(r, roleFamilyId);
    if (r.designationNameTaken(name, null)) throw this.taken("designation");
    const id = newId();
    this.o.store.transaction(() => {
      r.insertDesignation({ id, roleFamilyId, name, description: cleanDescription(input.description), now: this.now() });
      this.audit(ctx, "create", "designation", id, `Created the designation "${name}"`, undefined, { name, roleFamilyId });
    });
    return desig(r.designation(id)!);
  }

  updateDesignation(auth: AuthContext, requestId: string, caps: Capabilities, id: string, input: { name?: string; description?: string; roleFamilyId?: string | null }): DesignationView {
    this.requireManage(caps);
    const ctx = this.ctx(auth, requestId);
    const r = this.repo(ctx);
    const cur = r.designation(id);
    if (!cur) throw notFound();
    if (cur.archived_at) throw new HttpError(409, "archived", "This designation is archived. Restore it before changing it.");
    const name = input.name !== undefined ? cleanName(input.name) : cur.name;
    const description = cleanDescription(input.description, cur.description);
    const roleFamilyId = input.roleFamilyId === undefined ? cur.role_family_id : input.roleFamilyId;
    if (roleFamilyId !== cur.role_family_id) this.requireActiveFamily(r, roleFamilyId);
    if (name !== cur.name && r.designationNameTaken(name, id)) throw this.taken("designation");
    if (name === cur.name && description === cur.description && roleFamilyId === cur.role_family_id) return desig(cur);
    this.o.store.transaction(() => {
      r.updateDesignation({ id, roleFamilyId, name, description, now: this.now() });
      const action = name !== cur.name ? "rename" : roleFamilyId !== cur.role_family_id ? "move" : "update";
      this.audit(ctx, action, "designation", id, name !== cur.name ? `Renamed the designation "${cur.name}" to "${name}"` : roleFamilyId !== cur.role_family_id ? `Changed the role family of the designation "${cur.name}"` : `Changed the description of the designation "${cur.name}"`, { name: cur.name, roleFamilyId: cur.role_family_id, description: cur.description }, { name, roleFamilyId, description });
    });
    return desig(r.designation(id)!);
  }

  archiveDesignation(auth: AuthContext, requestId: string, caps: Capabilities, id: string): void {
    this.requireManage(caps);
    const ctx = this.ctx(auth, requestId);
    const r = this.repo(ctx);
    const cur = r.designation(id);
    if (!cur) throw notFound();
    if (cur.archived_at) throw new HttpError(409, "already_archived", "This designation is already archived.");
    this.o.store.transaction(() => {
      r.setArchived("designation", id, this.now(), this.now());
      this.audit(ctx, "archive", "designation", id, `Archived the designation "${cur.name}"`);
    });
  }

  restoreDesignation(auth: AuthContext, requestId: string, caps: Capabilities, id: string): DesignationView {
    this.requireManage(caps);
    const ctx = this.ctx(auth, requestId);
    const r = this.repo(ctx);
    const cur = r.designation(id);
    if (!cur) throw notFound();
    if (!cur.archived_at) throw new HttpError(409, "not_archived", "This designation is not archived.");
    this.requireActiveFamily(r, cur.role_family_id);
    if (r.designationNameTaken(cur.name, id)) throw this.taken("designation");
    this.o.store.transaction(() => {
      r.setArchived("designation", id, null, this.now());
      this.audit(ctx, "restore", "designation", id, `Restored the designation "${cur.name}"`);
    });
    return desig(r.designation(id)!);
  }
}
