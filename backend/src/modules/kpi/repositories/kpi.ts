import type { TenantDb } from "../../../db/tenant.js";

export interface KpiRow {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  unit: string | null;
  value_type: string;
  direction: string;
  frequency: string;
  aggregation: string;
  data_source: string;
  default_target: number | null;
  default_target_max: number | null;
  created_by_membership_id: string;
  archived_at: string | null;
  is_demo: number;
  created_at: string;
  updated_at: string;
}
const KPI_COLS = "id, key, name, description, category, unit, value_type, direction, frequency, aggregation, data_source, default_target, default_target_max, created_by_membership_id, archived_at, is_demo, created_at, updated_at";

export interface KpiAssignmentRow {
  id: string;
  kpi_id: string;
  membership_id: string | null;
  team_id: string | null;
  department_id: string | null;
  designation_id: string | null;
  role_family_id: string | null;
  target_value: number;
  target_max: number | null;
  weight: number;
  effective_from: string;
  effective_to: string | null;
  assigned_by_membership_id: string;
  created_at: string;
}
const ASG_COLS = "id, kpi_id, membership_id, team_id, department_id, designation_id, role_family_id, target_value, target_max, weight, effective_from, effective_to, assigned_by_membership_id, created_at";

export interface ThresholdRow { id: string; kpi_id: string; level: string; comparator: string; basis: string; value: number; notify: number }
const THR_COLS = "id, kpi_id, level, comparator, basis, value, notify";

export interface MeasurementRow {
  id: string;
  kpi_id: string;
  kpi_assignment_id: string | null;
  subject_membership_id: string | null;
  subject_team_id: string | null;
  subject_department_id: string | null;
  period_start: string;
  period_end: string;
  value: number;
  value_status: string;
  recorded_at: string;
  recorded_by_membership_id: string | null;
  source: string;
  source_ref: string | null;
  note: string | null;
  supersedes_measurement_id: string | null;
}
const MEAS_COLS = "id, kpi_id, kpi_assignment_id, subject_membership_id, subject_team_id, subject_department_id, period_start, period_end, value, value_status, recorded_at, recorded_by_membership_id, source, source_ref, note, supersedes_measurement_id";

/** KPI definitions, assignments and thresholds for ONE organization (the tenant handle supplies the organization id). */
export class KpiRepository {
  constructor(private readonly tdb: TenantDb) {}

  kpis(includeArchived = false): KpiRow[] {
    return this.tdb.all<KpiRow>(`SELECT ${KPI_COLS} FROM kpis WHERE organization_id = @organization_id AND (@all = 1 OR archived_at IS NULL) ORDER BY name COLLATE NOCASE, id`, { all: includeArchived ? 1 : 0 });
  }
  kpi(id: string): KpiRow | undefined {
    return this.tdb.get<KpiRow>(`SELECT ${KPI_COLS} FROM kpis WHERE organization_id = @organization_id AND id = @id`, { id });
  }
  keyTaken(key: string, exceptId?: string): boolean {
    return this.tdb.get<{ n: number }>("SELECT COUNT(*) AS n FROM kpis WHERE organization_id = @organization_id AND key = @key AND id <> @except", { key, except: exceptId ?? "" })?.n !== 0;
  }
  insertKpi(k: { id: string; key: string; name: string; description: string; category: string; unit: string | null; valueType: string; direction: string; frequency: string; aggregation: string; defaultTarget: number | null; defaultTargetMax: number | null; createdBy: string; now: string }): void {
    this.tdb.run(
      "INSERT INTO kpis (id, organization_id, key, name, description, category, unit, value_type, direction, frequency, aggregation, default_target, default_target_max, created_by_membership_id, created_at, updated_at) VALUES (@id, @organization_id, @key, @name, @description, @category, @unit, @valueType, @direction, @frequency, @aggregation, @defaultTarget, @defaultTargetMax, @createdBy, @now, @now)",
      k,
    );
  }
  updateKpi(k: { id: string; name: string; description: string; category: string; unit: string | null; valueType: string; direction: string; frequency: string; aggregation: string; defaultTarget: number | null; defaultTargetMax: number | null; now: string }): void {
    this.tdb.run(
      "UPDATE kpis SET name = @name, description = @description, category = @category, unit = @unit, value_type = @valueType, direction = @direction, frequency = @frequency, aggregation = @aggregation, default_target = @defaultTarget, default_target_max = @defaultTargetMax, updated_at = @now WHERE organization_id = @organization_id AND id = @id",
      k,
    );
  }
  setArchived(id: string, at: string | null, now: string): void {
    this.tdb.run("UPDATE kpis SET archived_at = @at, updated_at = @now WHERE organization_id = @organization_id AND id = @id", { id, at, now });
  }

  assignments(includeEnded = true): KpiAssignmentRow[] {
    return this.tdb.all<KpiAssignmentRow>(`SELECT ${ASG_COLS} FROM kpi_assignments WHERE organization_id = @organization_id AND (@all = 1 OR effective_to IS NULL) ORDER BY effective_from, created_at, rowid`, { all: includeEnded ? 1 : 0 });
  }
  assignment(id: string): KpiAssignmentRow | undefined {
    return this.tdb.get<KpiAssignmentRow>(`SELECT ${ASG_COLS} FROM kpi_assignments WHERE organization_id = @organization_id AND id = @id`, { id });
  }
  insertAssignment(a: { id: string; kpiId: string; membershipId: string | null; teamId: string | null; departmentId: string | null; designationId: string | null; roleFamilyId: string | null; targetValue: number; targetMax: number | null; weight: number; effectiveFrom: string; effectiveTo: string | null; by: string; now: string }): void {
    this.tdb.run(
      "INSERT INTO kpi_assignments (id, organization_id, kpi_id, membership_id, team_id, department_id, designation_id, role_family_id, target_value, target_max, weight, effective_from, effective_to, assigned_by_membership_id, created_at) VALUES (@id, @organization_id, @kpiId, @membershipId, @teamId, @departmentId, @designationId, @roleFamilyId, @targetValue, @targetMax, @weight, @effectiveFrom, @effectiveTo, @by, @now)",
      a,
    );
  }
  updateAssignment(a: { id: string; targetValue: number; targetMax: number | null; weight: number; effectiveTo: string | null }): void {
    this.tdb.run("UPDATE kpi_assignments SET target_value = @targetValue, target_max = @targetMax, weight = @weight, effective_to = @effectiveTo WHERE organization_id = @organization_id AND id = @id", a);
  }

  thresholds(kpiId?: string): ThresholdRow[] {
    return this.tdb.all<ThresholdRow>(`SELECT ${THR_COLS} FROM kpi_thresholds WHERE organization_id = @organization_id AND (@kpiId IS NULL OR kpi_id = @kpiId) ORDER BY kpi_id, CASE level WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, rowid`, { kpiId: kpiId ?? null });
  }
  deleteThresholds(kpiId: string): void {
    this.tdb.run("DELETE FROM kpi_thresholds WHERE organization_id = @organization_id AND kpi_id = @kpiId", { kpiId });
  }
  insertThreshold(t: { id: string; kpiId: string; level: string; comparator: string; basis: string; value: number; notify: number; now: string }): void {
    this.tdb.run("INSERT INTO kpi_thresholds (id, organization_id, kpi_id, level, comparator, basis, value, notify, created_at) VALUES (@id, @organization_id, @kpiId, @level, @comparator, @basis, @value, @notify, @now)", t);
  }

  // ----- measurements (append only) -----

  measurements(kpiId?: string): MeasurementRow[] {
    return this.tdb.all<MeasurementRow>(`SELECT ${MEAS_COLS} FROM kpi_measurements WHERE organization_id = @organization_id AND (@kpiId IS NULL OR kpi_id = @kpiId) ORDER BY period_start, recorded_at, rowid`, { kpiId: kpiId ?? null });
  }
  measurement(id: string): MeasurementRow | undefined {
    return this.tdb.get<MeasurementRow>(`SELECT ${MEAS_COLS} FROM kpi_measurements WHERE organization_id = @organization_id AND id = @id`, { id });
  }
  insertMeasurement(m: { id: string; kpiId: string; assignmentId: string | null; membershipId: string | null; teamId: string | null; departmentId: string | null; periodStart: string; periodEnd: string; value: number; valueStatus: string; by: string | null; source: string; note: string | null; supersedesId: string | null; now: string }): void {
    this.tdb.run(
      "INSERT INTO kpi_measurements (id, organization_id, kpi_id, kpi_assignment_id, subject_membership_id, subject_team_id, subject_department_id, period_start, period_end, value, value_status, recorded_at, recorded_by_membership_id, source, note, supersedes_measurement_id) VALUES (@id, @organization_id, @kpiId, @assignmentId, @membershipId, @teamId, @departmentId, @periodStart, @periodEnd, @value, @valueStatus, @now, @by, @source, @note, @supersedesId)",
      m,
    );
  }
}
