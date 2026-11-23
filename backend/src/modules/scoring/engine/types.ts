/**
 * The scoring engine's types (docs/scoring-architecture.md). Everything here is plain data. The engine reads a `ScoreInputs`
 * snapshot and a model, and returns a `ScoreResult`: no database, no clock, no randomness, no network, no AI.
 */
export type DataState = "ok" | "insufficient" | "missing";
export type Status = "final" | "provisional" | "insufficient";
export type EvidenceExpectation = "none" | "recommended" | "required";

export interface Ref { type: string; id: string }
export interface Contributor { ref: Ref; label: string; value: number | null; target?: number | null; weight: number; note?: string }

export interface ProviderResult {
  /** Normalized 0 to 100, or null when it cannot be computed. */
  value: number | null;
  state: DataState;
  /** Records that contributed (key results, measurements, tasks...). */
  sampleSize: number;
  /** 0 to 1: the share of the expected records that exist. */
  coverage: number;
  /** 0 to 1: contributing records with a VERIFIED evidence link. Evidence arrives with stage 4.3; until then it is 0 and no component expects it. */
  evidenceShare: number;
  contributors: Contributor[];
  /** Data-quality notes shown to the person. */
  notes: string[];
}

export interface ModelComponent {
  key: string;
  label: string;
  /** Any positive number; only the ratios matter (a model's weights are validated to sum to 100 when it is activated). */
  weight: number;
  providerKey: string;
  minSample: number;
  sortOrder: number;
  config: Record<string, unknown>;
}
export interface Band { min: number; label: string }
export interface ModelDef {
  name: string;
  version: number;
  minWeightCoverage: number;
  minConfidenceForFinal: number;
  bands: Band[];
  components: ModelComponent[];
}

// ---------- the snapshot the providers read ----------

export interface KeyResultInput { id: string; title: string; direction: "increase" | "decrease"; method: "linear" | "binary" | "manual"; start: number; target: number; /** the value recorded at the period end, or null: nothing recorded */ current: number | null; weight: number }
export interface ObjectiveInput { id: string; title: string; level: string; weight: number; lifecycle: string; keyResults: KeyResultInput[] }
export interface KpiInput {
  assignmentId: string;
  kpiId: string;
  name: string;
  category: string;
  unit: string | null;
  direction: "higher_is_better" | "lower_is_better" | "target_range";
  aggregation: "sum" | "avg" | "last" | "min" | "max";
  target: number;
  targetMax: number | null;
  weight: number;
  /** How many periods of the KPI's frequency the scoring period should contain for this assignment. */
  expectedPeriods: number;
  /** The CURRENT value of each period that has one, oldest first (corrections already resolved), disputed values left out. */
  values: { period: string; value: number }[];
}
export interface TaskInput {
  id: string;
  title: string;
  importance: number;
  priority: "low" | "medium" | "high" | "critical";
  dueAt: string;
  status: string;
  completedOn: string | null;
  estimatedMinutes: number | null;
  actualMinutes: number | null;
  /** The reviewer's 1 to 5 rating, if any. */
  quality: number | null;
}
export interface ScoreInputs {
  subject: { type: "membership" | "team" | "department" | "organization"; id: string; label: string };
  period: { start: string; end: string; open: boolean };
  /** The day the snapshot was taken (period end for a closed period, otherwise the day of the run): "overdue" is measured against it. */
  asOf: string;
  objectives: { personal: ObjectiveInput[]; team: ObjectiveInput[]; department: ObjectiveInput[]; company: ObjectiveInput[] };
  kpis: KpiInput[];
  teamKpis: KpiInput[];
  tasks: TaskInput[];
  teamTasks: TaskInput[];
  /** Direct values for a component (the what-if calculator, and tests): used instead of running its provider. */
  overrides?: Record<string, { value: number | null; state?: DataState; sampleSize?: number; coverage?: number }>;
  /** Sections other providers read (mentorship, departments, leadership...). Added by later stages as plain data. */
  extra?: Record<string, unknown>;
}

// ---------- the result ----------

export interface ComponentResult {
  key: string;
  label: string;
  providerKey: string;
  weight: number;
  state: DataState;
  /** Rounded to 1 decimal for display; `rawValue` keeps full precision. */
  score: number | null;
  rawValue: number | null;
  effectiveWeight: number;
  points: number | null;
  sampleSize: number;
  minSample: number;
  coverage: number;
  evidenceShare: number;
  contributors: Contributor[];
  notes: string[];
}
export interface Explanation {
  formula: string;
  status: Status;
  band: string | null;
  confidence: { value: number; label: "high" | "medium" | "low"; parts: { coverage: number; sample: number; evidence: number } };
  components: { key: string; label: string; state: DataState; score: number | null; weight: number; effectiveWeight: number; points: number | null; stateText: string; topContributors: Contributor[]; gaps: Contributor[] }[];
  reasons: string[];
  dataQuality: string[];
  whatWouldChangeThis: string[];
  rounding: string | null;
}
export interface ScoreResult {
  /** Rounded half-up to 1 decimal; null when the status is insufficient. */
  total: number | null;
  rawTotal: number | null;
  status: Status;
  weightCoverage: number;
  confidence: number;
  components: ComponentResult[];
  explanation: Explanation;
}
