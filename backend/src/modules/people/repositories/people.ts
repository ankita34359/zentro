import type { TenantDb } from "../../../db/tenant.js";

export interface PersonRow {
  id: string;
  user_id: string | null;
  display_name: string;
  work_email: string | null;
  status: string;
  designation_id: string | null;
  employee_code: string | null;
  employment_type: string | null;
  start_date: string | null;
  end_date: string | null;
  archived_at: string | null;
  created_at: string;
}
const PERSON_COLS = "id, user_id, display_name, work_email, status, designation_id, employee_code, employment_type, start_date, end_date, archived_at, created_at";

export interface DesignationAssignmentRow { id: string; membership_id: string; designation_id: string; start_date: string; end_date: string | null; reason: string | null }
export interface DeptMemberRow { id: string; department_id: string; membership_id: string; membership_type: string; start_date: string; end_date: string | null }
export interface TeamMemberRow { id: string; team_id: string; membership_id: string; membership_type: string; allocation_pct: number; start_date: string; end_date: string | null }
export interface ReportingRow { id: string; subordinate_membership_id: string; manager_membership_id: string; relationship_type: string; start_date: string; end_date: string | null; reason: string | null }

/** "Active on day @asOf": the row started on or before it and had not ended yet (an end date is the first day the row no longer applies). */
const ACTIVE = "start_date <= @asOf AND (end_date IS NULL OR @asOf < end_date)";

/** People, their effective-dated placements and reporting lines, for ONE organization (the tenant handle supplies the organization id). */
export class PeopleRepository {
  constructor(private readonly tdb: TenantDb) {}

  // ----- people -----

  people(): PersonRow[] {
    return this.tdb.all<PersonRow>(`SELECT ${PERSON_COLS} FROM organization_memberships WHERE organization_id = @organization_id ORDER BY display_name COLLATE NOCASE, id`);
  }
  person(id: string): PersonRow | undefined {
    return this.tdb.get<PersonRow>(`SELECT ${PERSON_COLS} FROM organization_memberships WHERE organization_id = @organization_id AND id = @id`, { id });
  }
  /** People who currently belong (not left, not archived). Used to keep ended and removed people out of every scope set. */
  activePersonIds(): string[] {
    return this.tdb
      .all<{ id: string }>("SELECT id FROM organization_memberships WHERE organization_id = @organization_id AND status IN ('active', 'invited', 'suspended') AND archived_at IS NULL")
      .map((r) => r.id);
  }
  insertPerson(p: { id: string; displayName: string; workEmail: string | null; employeeCode: string | null; employmentType: string | null; startDate: string | null; now: string }): void {
    this.tdb.run(
      "INSERT INTO organization_memberships (id, organization_id, user_id, display_name, work_email, status, employee_code, employment_type, start_date, created_at, updated_at) VALUES (@id, @organization_id, NULL, @displayName, @workEmail, 'active', @employeeCode, @employmentType, @startDate, @now, @now)",
      p,
    );
  }
  updatePerson(p: { id: string; displayName: string; workEmail: string | null; employeeCode: string | null; employmentType: string | null; startDate: string | null; endDate: string | null; now: string }): void {
    this.tdb.run(
      "UPDATE organization_memberships SET display_name = @displayName, work_email = @workEmail, employee_code = @employeeCode, employment_type = @employmentType, start_date = @startDate, end_date = @endDate, updated_at = @now WHERE organization_id = @organization_id AND id = @id",
      p,
    );
  }
  setDesignationCache(id: string, designationId: string | null, now: string): void {
    this.tdb.run("UPDATE organization_memberships SET designation_id = @designationId, updated_at = @now WHERE organization_id = @organization_id AND id = @id", { id, designationId, now });
  }
  /** A person without a login leaves the directory (archived) or comes back. */
  setArchived(id: string, archivedAt: string | null, status: string, now: string): void {
    this.tdb.run("UPDATE organization_memberships SET archived_at = @archivedAt, status = @status, updated_at = @now WHERE organization_id = @organization_id AND id = @id AND user_id IS NULL", { id, archivedAt, status, now });
  }
  employeeCodeTaken(code: string, exceptId: string | null): boolean {
    return this.tdb.get("SELECT 1 AS x FROM organization_memberships WHERE organization_id = @organization_id AND archived_at IS NULL AND employee_code = @code AND id <> @exceptId", { code, exceptId: exceptId ?? "" }) !== undefined;
  }

  // ----- designations over time -----

  designationRows(membershipId?: string): DesignationAssignmentRow[] {
    const cols = "id, membership_id, designation_id, start_date, end_date, reason";
    return membershipId
      ? this.tdb.all<DesignationAssignmentRow>(`SELECT ${cols} FROM designation_assignments WHERE organization_id = @organization_id AND membership_id = @membershipId ORDER BY start_date, created_at`, { membershipId })
      : this.tdb.all<DesignationAssignmentRow>(`SELECT ${cols} FROM designation_assignments WHERE organization_id = @organization_id ORDER BY start_date, created_at`);
  }
  openDesignation(membershipId: string): DesignationAssignmentRow | undefined {
    return this.tdb.get<DesignationAssignmentRow>("SELECT id, membership_id, designation_id, start_date, end_date, reason FROM designation_assignments WHERE organization_id = @organization_id AND membership_id = @membershipId AND end_date IS NULL", { membershipId });
  }
  endDesignation(id: string, endDate: string): void {
    this.tdb.run("UPDATE designation_assignments SET end_date = @endDate WHERE organization_id = @organization_id AND id = @id", { id, endDate });
  }
  insertDesignation(r: { id: string; membershipId: string; designationId: string; startDate: string; reason: string | null; createdBy: string; now: string }): void {
    this.tdb.run(
      "INSERT INTO designation_assignments (id, organization_id, membership_id, designation_id, start_date, reason, created_by_membership_id, created_at) VALUES (@id, @organization_id, @membershipId, @designationId, @startDate, @reason, @createdBy, @now)",
      r,
    );
  }

  // ----- department memberships -----

  deptRows(opts: { membershipId?: string; departmentId?: string; asOf?: string } = {}): DeptMemberRow[] {
    const extra: string[] = [];
    const p: Record<string, string> = {};
    if (opts.membershipId) { extra.push(" AND membership_id = @membershipId"); p.membershipId = opts.membershipId; }
    if (opts.departmentId) { extra.push(" AND department_id = @departmentId"); p.departmentId = opts.departmentId; }
    if (opts.asOf) { extra.push(` AND ${ACTIVE}`); p.asOf = opts.asOf; }
    return this.tdb.all<DeptMemberRow>(`SELECT id, department_id, membership_id, membership_type, start_date, end_date FROM department_memberships WHERE organization_id = @organization_id${extra.join("")} ORDER BY start_date, created_at`, p);
  }
  deptRow(id: string): DeptMemberRow | undefined {
    return this.tdb.get<DeptMemberRow>("SELECT id, department_id, membership_id, membership_type, start_date, end_date FROM department_memberships WHERE organization_id = @organization_id AND id = @id", { id });
  }
  openDeptRow(departmentId: string, membershipId: string): DeptMemberRow | undefined {
    return this.tdb.get<DeptMemberRow>("SELECT id, department_id, membership_id, membership_type, start_date, end_date FROM department_memberships WHERE organization_id = @organization_id AND department_id = @departmentId AND membership_id = @membershipId AND end_date IS NULL", { departmentId, membershipId });
  }
  insertDeptRow(r: { id: string; departmentId: string; membershipId: string; type: string; startDate: string; createdBy: string; now: string }): void {
    this.tdb.run(
      "INSERT INTO department_memberships (id, organization_id, department_id, membership_id, membership_type, start_date, created_by_membership_id, created_at) VALUES (@id, @organization_id, @departmentId, @membershipId, @type, @startDate, @createdBy, @now)",
      r,
    );
  }
  endDeptRow(id: string, endDate: string): void {
    this.tdb.run("UPDATE department_memberships SET end_date = @endDate WHERE organization_id = @organization_id AND id = @id", { id, endDate });
  }

  // ----- team memberships -----

  teamRows(opts: { membershipId?: string; teamId?: string; asOf?: string } = {}): TeamMemberRow[] {
    const extra: string[] = [];
    const p: Record<string, string> = {};
    if (opts.membershipId) { extra.push(" AND membership_id = @membershipId"); p.membershipId = opts.membershipId; }
    if (opts.teamId) { extra.push(" AND team_id = @teamId"); p.teamId = opts.teamId; }
    if (opts.asOf) { extra.push(` AND ${ACTIVE}`); p.asOf = opts.asOf; }
    return this.tdb.all<TeamMemberRow>(`SELECT id, team_id, membership_id, membership_type, allocation_pct, start_date, end_date FROM team_memberships WHERE organization_id = @organization_id${extra.join("")} ORDER BY start_date, created_at`, p);
  }
  teamRow(id: string): TeamMemberRow | undefined {
    return this.tdb.get<TeamMemberRow>("SELECT id, team_id, membership_id, membership_type, allocation_pct, start_date, end_date FROM team_memberships WHERE organization_id = @organization_id AND id = @id", { id });
  }
  openTeamRow(teamId: string, membershipId: string): TeamMemberRow | undefined {
    return this.tdb.get<TeamMemberRow>("SELECT id, team_id, membership_id, membership_type, allocation_pct, start_date, end_date FROM team_memberships WHERE organization_id = @organization_id AND team_id = @teamId AND membership_id = @membershipId AND end_date IS NULL", { teamId, membershipId });
  }
  insertTeamRow(r: { id: string; teamId: string; membershipId: string; type: string; allocationPct: number; startDate: string; createdBy: string; now: string }): void {
    this.tdb.run(
      "INSERT INTO team_memberships (id, organization_id, team_id, membership_id, membership_type, allocation_pct, start_date, created_by_membership_id, created_at) VALUES (@id, @organization_id, @teamId, @membershipId, @type, @allocationPct, @startDate, @createdBy, @now)",
      r,
    );
  }
  endTeamRow(id: string, endDate: string): void {
    this.tdb.run("UPDATE team_memberships SET end_date = @endDate WHERE organization_id = @organization_id AND id = @id", { id, endDate });
  }
  setTeamAllocation(id: string, allocationPct: number): void {
    this.tdb.run("UPDATE team_memberships SET allocation_pct = @allocationPct WHERE organization_id = @organization_id AND id = @id", { id, allocationPct });
  }

  /** Anyone still in the department / team on this day (the archive rule asks). */
  activeDeptMemberCount(departmentId: string, asOf: string): number {
    return this.tdb.get<{ n: number }>(`SELECT COUNT(*) AS n FROM department_memberships WHERE organization_id = @organization_id AND department_id = @departmentId AND ${ACTIVE}`, { departmentId, asOf })?.n ?? 0;
  }
  activeTeamMemberCount(teamId: string, asOf: string): number {
    return this.tdb.get<{ n: number }>(`SELECT COUNT(*) AS n FROM team_memberships WHERE organization_id = @organization_id AND team_id = @teamId AND ${ACTIVE}`, { teamId, asOf })?.n ?? 0;
  }
  /** Someone's open (not ended) team or department row still points at it, even one that starts in the future. */
  openDeptMemberCount(departmentId: string): number {
    return this.tdb.get<{ n: number }>("SELECT COUNT(*) AS n FROM department_memberships WHERE organization_id = @organization_id AND department_id = @departmentId AND end_date IS NULL", { departmentId })?.n ?? 0;
  }
  openTeamMemberCount(teamId: string): number {
    return this.tdb.get<{ n: number }>("SELECT COUNT(*) AS n FROM team_memberships WHERE organization_id = @organization_id AND team_id = @teamId AND end_date IS NULL", { teamId })?.n ?? 0;
  }

  // ----- reporting lines -----

  reportingRows(opts: { asOf?: string; membershipId?: string } = {}): ReportingRow[] {
    const extra: string[] = [];
    const p: Record<string, string> = {};
    if (opts.membershipId) { extra.push(" AND (subordinate_membership_id = @membershipId OR manager_membership_id = @membershipId)"); p.membershipId = opts.membershipId; }
    if (opts.asOf) { extra.push(` AND ${ACTIVE}`); p.asOf = opts.asOf; }
    return this.tdb.all<ReportingRow>(`SELECT id, subordinate_membership_id, manager_membership_id, relationship_type, start_date, end_date, reason FROM reporting_relationships WHERE organization_id = @organization_id${extra.join("")} ORDER BY start_date, created_at`, p);
  }
  reportingRow(id: string): ReportingRow | undefined {
    return this.tdb.get<ReportingRow>("SELECT id, subordinate_membership_id, manager_membership_id, relationship_type, start_date, end_date, reason FROM reporting_relationships WHERE organization_id = @organization_id AND id = @id", { id });
  }
  openPrimary(subordinateId: string): ReportingRow | undefined {
    return this.tdb.get<ReportingRow>("SELECT id, subordinate_membership_id, manager_membership_id, relationship_type, start_date, end_date, reason FROM reporting_relationships WHERE organization_id = @organization_id AND subordinate_membership_id = @subordinateId AND relationship_type = 'primary' AND end_date IS NULL", { subordinateId });
  }
  openLine(subordinateId: string, managerId: string, type: string): ReportingRow | undefined {
    return this.tdb.get<ReportingRow>("SELECT id, subordinate_membership_id, manager_membership_id, relationship_type, start_date, end_date, reason FROM reporting_relationships WHERE organization_id = @organization_id AND subordinate_membership_id = @subordinateId AND manager_membership_id = @managerId AND relationship_type = @type AND end_date IS NULL", { subordinateId, managerId, type });
  }
  insertReporting(r: { id: string; subordinateId: string; managerId: string; type: string; startDate: string; reason: string | null; createdBy: string; now: string }): void {
    this.tdb.run(
      "INSERT INTO reporting_relationships (id, organization_id, subordinate_membership_id, manager_membership_id, relationship_type, start_date, reason, created_by_membership_id, created_at) VALUES (@id, @organization_id, @subordinateId, @managerId, @type, @startDate, @reason, @createdBy, @now)",
      r,
    );
  }
  endReporting(id: string, endDate: string, reason: string | null): void {
    this.tdb.run("UPDATE reporting_relationships SET end_date = @endDate, reason = COALESCE(@reason, reason) WHERE organization_id = @organization_id AND id = @id", { id, endDate, reason });
  }

  /** The person leaves: every open row of theirs ends on `endDate`, as subordinate and as manager. Returns how many rows ended. */
  endEverythingFor(membershipId: string, endDate: string): number {
    const p = { membershipId, endDate };
    return (
      this.tdb.run("UPDATE team_memberships SET end_date = CASE WHEN start_date > @endDate THEN start_date ELSE @endDate END WHERE organization_id = @organization_id AND membership_id = @membershipId AND end_date IS NULL", p).changes +
      this.tdb.run("UPDATE department_memberships SET end_date = CASE WHEN start_date > @endDate THEN start_date ELSE @endDate END WHERE organization_id = @organization_id AND membership_id = @membershipId AND end_date IS NULL", p).changes +
      this.tdb.run("UPDATE reporting_relationships SET end_date = CASE WHEN start_date > @endDate THEN start_date ELSE @endDate END WHERE organization_id = @organization_id AND (subordinate_membership_id = @membershipId OR manager_membership_id = @membershipId) AND end_date IS NULL", p).changes
    );
  }
}
