import type { TenantDb } from "../../../db/tenant.js";

export type Kind = "department" | "team" | "roleFamily" | "designation";

export interface DepartmentRow { id: string; parent_id: string | null; name: string; description: string; archived_at: string | null; created_at: string; updated_at: string }
export interface TeamRow { id: string; department_id: string; parent_team_id: string | null; name: string; description: string; archived_at: string | null; created_at: string; updated_at: string }
export interface RoleFamilyRow { id: string; name: string; description: string; archived_at: string | null; created_at: string; updated_at: string }
export interface DesignationRow { id: string; role_family_id: string | null; name: string; description: string; archived_at: string | null; created_at: string; updated_at: string }

/** Departments, teams, role families and designations of ONE organization (the tenant handle supplies the organization id). */
export class StructureRepository {
  constructor(private readonly tdb: TenantDb) {}

  // ----- reads (archived rows included: the screen shows them under "Archived") -----

  departments(): DepartmentRow[] {
    return this.tdb.all<DepartmentRow>("SELECT id, parent_id, name, description, archived_at, created_at, updated_at FROM departments WHERE organization_id = @organization_id ORDER BY lower(name), id");
  }
  teams(): TeamRow[] {
    return this.tdb.all<TeamRow>("SELECT id, department_id, parent_team_id, name, description, archived_at, created_at, updated_at FROM teams WHERE organization_id = @organization_id ORDER BY lower(name), id");
  }
  roleFamilies(): RoleFamilyRow[] {
    return this.tdb.all<RoleFamilyRow>("SELECT id, name, description, archived_at, created_at, updated_at FROM role_families WHERE organization_id = @organization_id ORDER BY lower(name), id");
  }
  designations(): DesignationRow[] {
    return this.tdb.all<DesignationRow>("SELECT id, role_family_id, name, description, archived_at, created_at, updated_at FROM designations WHERE organization_id = @organization_id ORDER BY lower(name), id");
  }

  department(id: string): DepartmentRow | undefined {
    return this.tdb.get<DepartmentRow>("SELECT id, parent_id, name, description, archived_at, created_at, updated_at FROM departments WHERE organization_id = @organization_id AND id = @id", { id });
  }
  team(id: string): TeamRow | undefined {
    return this.tdb.get<TeamRow>("SELECT id, department_id, parent_team_id, name, description, archived_at, created_at, updated_at FROM teams WHERE organization_id = @organization_id AND id = @id", { id });
  }
  roleFamily(id: string): RoleFamilyRow | undefined {
    return this.tdb.get<RoleFamilyRow>("SELECT id, name, description, archived_at, created_at, updated_at FROM role_families WHERE organization_id = @organization_id AND id = @id", { id });
  }
  designation(id: string): DesignationRow | undefined {
    return this.tdb.get<DesignationRow>("SELECT id, role_family_id, name, description, archived_at, created_at, updated_at FROM designations WHERE organization_id = @organization_id AND id = @id", { id });
  }

  // ----- name checks (active siblings only, ignoring case) -----

  departmentNameTaken(parentId: string | null, name: string, exceptId: string | null): boolean {
    return this.tdb.get("SELECT 1 AS x FROM departments WHERE organization_id = @organization_id AND archived_at IS NULL AND COALESCE(parent_id, '') = @parentId AND lower(name) = lower(@name) AND id <> @exceptId", { parentId: parentId ?? "", name, exceptId: exceptId ?? "" }) !== undefined;
  }
  teamNameTaken(departmentId: string, parentTeamId: string | null, name: string, exceptId: string | null): boolean {
    return this.tdb.get("SELECT 1 AS x FROM teams WHERE organization_id = @organization_id AND archived_at IS NULL AND department_id = @departmentId AND COALESCE(parent_team_id, '') = @parentTeamId AND lower(name) = lower(@name) AND id <> @exceptId", { departmentId, parentTeamId: parentTeamId ?? "", name, exceptId: exceptId ?? "" }) !== undefined;
  }
  roleFamilyNameTaken(name: string, exceptId: string | null): boolean {
    return this.tdb.get("SELECT 1 AS x FROM role_families WHERE organization_id = @organization_id AND archived_at IS NULL AND lower(name) = lower(@name) AND id <> @exceptId", { name, exceptId: exceptId ?? "" }) !== undefined;
  }
  designationNameTaken(name: string, exceptId: string | null): boolean {
    return this.tdb.get("SELECT 1 AS x FROM designations WHERE organization_id = @organization_id AND archived_at IS NULL AND lower(name) = lower(@name) AND id <> @exceptId", { name, exceptId: exceptId ?? "" }) !== undefined;
  }

  // ----- writes -----

  insertDepartment(r: { id: string; parentId: string | null; name: string; description: string; now: string }): void {
    this.tdb.run("INSERT INTO departments (id, organization_id, parent_id, name, description, created_at, updated_at) VALUES (@id, @organization_id, @parentId, @name, @description, @now, @now)", r);
  }
  updateDepartment(r: { id: string; parentId: string | null; name: string; description: string; now: string }): void {
    this.tdb.run("UPDATE departments SET parent_id = @parentId, name = @name, description = @description, updated_at = @now WHERE organization_id = @organization_id AND id = @id", r);
  }
  insertTeam(r: { id: string; departmentId: string; parentTeamId: string | null; name: string; description: string; now: string }): void {
    this.tdb.run("INSERT INTO teams (id, organization_id, department_id, parent_team_id, name, description, created_at, updated_at) VALUES (@id, @organization_id, @departmentId, @parentTeamId, @name, @description, @now, @now)", r);
  }
  updateTeam(r: { id: string; departmentId: string; parentTeamId: string | null; name: string; description: string; now: string }): void {
    this.tdb.run("UPDATE teams SET department_id = @departmentId, parent_team_id = @parentTeamId, name = @name, description = @description, updated_at = @now WHERE organization_id = @organization_id AND id = @id", r);
  }
  /** A team moved to another department takes its sub-teams with it. */
  setTeamDepartment(id: string, departmentId: string, now: string): void {
    this.tdb.run("UPDATE teams SET department_id = @departmentId, updated_at = @now WHERE organization_id = @organization_id AND id = @id", { id, departmentId, now });
  }
  insertRoleFamily(r: { id: string; name: string; description: string; now: string }): void {
    this.tdb.run("INSERT INTO role_families (id, organization_id, name, description, created_at, updated_at) VALUES (@id, @organization_id, @name, @description, @now, @now)", r);
  }
  updateRoleFamily(r: { id: string; name: string; description: string; now: string }): void {
    this.tdb.run("UPDATE role_families SET name = @name, description = @description, updated_at = @now WHERE organization_id = @organization_id AND id = @id", r);
  }
  insertDesignation(r: { id: string; roleFamilyId: string | null; name: string; description: string; now: string }): void {
    this.tdb.run("INSERT INTO designations (id, organization_id, role_family_id, name, description, created_at, updated_at) VALUES (@id, @organization_id, @roleFamilyId, @name, @description, @now, @now)", r);
  }
  updateDesignation(r: { id: string; roleFamilyId: string | null; name: string; description: string; now: string }): void {
    this.tdb.run("UPDATE designations SET role_family_id = @roleFamilyId, name = @name, description = @description, updated_at = @now WHERE organization_id = @organization_id AND id = @id", r);
  }

  /** Archive (`at` = a time) or restore (`at` = null). Never a delete. */
  setArchived(kind: Kind, id: string, at: string | null, now: string): void {
    const sql: Record<Kind, string> = {
      department: "UPDATE departments SET archived_at = @at, updated_at = @now WHERE organization_id = @organization_id AND id = @id",
      team: "UPDATE teams SET archived_at = @at, updated_at = @now WHERE organization_id = @organization_id AND id = @id",
      roleFamily: "UPDATE role_families SET archived_at = @at, updated_at = @now WHERE organization_id = @organization_id AND id = @id",
      designation: "UPDATE designations SET archived_at = @at, updated_at = @now WHERE organization_id = @organization_id AND id = @id",
    };
    this.tdb.run(sql[kind], { id, at, now });
  }
}
