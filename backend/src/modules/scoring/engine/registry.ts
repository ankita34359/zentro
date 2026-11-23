import { clamp, num } from "./math.js";
import { kpiProvider } from "./providers/kpi.js";
import { activityProvider, DEFAULT_MENTORSHIP, developmentProvider, menteeGrowthProvider, type MentorshipConfig } from "./providers/mentorship.js";
import { okrProvider } from "./providers/okr.js";
import { deliveryProvider, qualityProvider } from "./providers/tasks.js";
import type { ModelComponent, ProviderResult, ScoreInputs } from "./types.js";

const mentorCfg = (c: ModelComponent): MentorshipConfig => ({ minDays: num(c.config, "minDays", DEFAULT_MENTORSHIP.minDays), k: num(c.config, "k", DEFAULT_MENTORSHIP.k) });

export type Provider = (inputs: ScoreInputs, component: ModelComponent) => ProviderResult;

const EXECUTIVE_CATEGORIES = ["financial", "growth", "impact", "health"];

/** The same OKR math over team objectives, blended with the team's KPIs when both have data. */
function teamOutcomes(inputs: ScoreInputs, c: ModelComponent): ProviderResult {
  const okr = okrProvider(inputs.objectives.team, c.minSample, "team");
  const kpi = kpiProvider(inputs.teamKpis, c.config, 1);
  const blend = num(c.config, "kpiBlend", 0.5);
  const both = okr.state === "ok" && kpi.state === "ok" && okr.value !== null && kpi.value !== null;
  if (both) return { value: clamp((okr.value as number) * (1 - blend) + (kpi.value as number) * blend, 0, 100), state: "ok", sampleSize: okr.sampleSize + kpi.sampleSize, coverage: (okr.coverage + kpi.coverage) / 2, evidenceShare: 0, contributors: [...okr.contributors, ...kpi.contributors], notes: [...okr.notes, ...kpi.notes] };
  if (okr.state === "ok") return { ...okr, notes: [...okr.notes, ...kpi.notes, "Only team objectives were available (no team KPI with enough data)"] };
  if (kpi.state === "ok") return { ...kpi, notes: [...okr.notes, ...kpi.notes, "Only team KPIs were available (no team objective with enough data)"] };
  const state = okr.state === "insufficient" || kpi.state === "insufficient" ? "insufficient" : "missing";
  return { value: null, state, sampleSize: okr.sampleSize + kpi.sampleSize, coverage: 0, evidenceShare: 0, contributors: [...okr.contributors, ...kpi.contributors], notes: [...okr.notes, ...kpi.notes] };
}

/** Own objectives and KPIs together (a team lead's or manager's own work): the two blended equally when both have data. */
function ownOkrKpi(inputs: ScoreInputs, c: ModelComponent): ProviderResult {
  const okr = okrProvider(inputs.objectives.personal, c.minSample, "personal");
  const kpi = kpiProvider(inputs.kpis, c.config, 1);
  if (okr.state === "ok" && kpi.state === "ok" && okr.value !== null && kpi.value !== null) return { value: (okr.value + kpi.value) / 2, state: "ok", sampleSize: okr.sampleSize + kpi.sampleSize, coverage: (okr.coverage + kpi.coverage) / 2, evidenceShare: 0, contributors: [...okr.contributors, ...kpi.contributors], notes: [...okr.notes, ...kpi.notes] };
  if (okr.state === "ok") return { ...okr, notes: [...okr.notes, ...kpi.notes, "Only objectives were available (no KPI with enough data)"] };
  if (kpi.state === "ok") return { ...kpi, notes: [...okr.notes, ...kpi.notes, "Only KPIs were available (no objective with enough data)"] };
  return { value: null, state: okr.state === "insufficient" || kpi.state === "insufficient" ? "insufficient" : "missing", sampleSize: okr.sampleSize + kpi.sampleSize, coverage: 0, evidenceShare: 0, contributors: [...okr.contributors, ...kpi.contributors], notes: [...okr.notes, ...kpi.notes] };
}

/** Provider code is fixed; weights and thresholds are data (the model). A provider reads only the snapshot. */
export const PROVIDERS: Record<string, Provider> = {
  "mentorship.development": (i, c) => developmentProvider(i.extra?.mentorship?.asMentor ?? [], c.minSample, mentorCfg(c)),
  "mentorship.activity": (i) => activityProvider(i.extra?.mentorship?.asMentor ?? []),
  "mentorship.mentee_growth": (i, c) => menteeGrowthProvider(i.extra?.mentorship?.asMentee ?? [], mentorCfg(c)),
  "own.okr_kpi": ownOkrKpi,
  "okr.attainment": (i, c) => okrProvider(i.objectives.personal, c.minSample, "personal"),
  "okr.team_attainment": teamOutcomes,
  "okr.department_attainment": (i, c) => okrProvider(i.objectives.department, c.minSample, "department"),
  "okr.company_attainment": (i, c) => okrProvider(i.objectives.company, c.minSample, "company"),
  "kpi.attainment": (i, c) => kpiProvider(i.kpis, c.config, c.minSample),
  "kpi.attainment.executive": (i, c) => kpiProvider(i.kpis, { categories: EXECUTIVE_CATEGORIES, ...c.config }, c.minSample),
  "tasks.delivery": (i, c) => deliveryProvider(i.tasks, i.asOf, c.config, c.minSample),
  "team.delivery": (i, c) => deliveryProvider(i.teamTasks, i.asOf, c.config, c.minSample),
  "quality.impact": (i, c) => qualityProvider(i.kpis, i.tasks, c.config, c.minSample),
};

/** Providers that read task rows: a model that reaches one of these is a task-based model. The CEO template must reach none (checked in tests). */
export const TASK_PROVIDERS: readonly string[] = ["tasks.delivery", "team.delivery", "quality.impact"];
