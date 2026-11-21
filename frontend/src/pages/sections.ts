import type { IllustrationName } from "@/components/illustrations";

export interface Section {
  illustration: IllustrationName;
  /** Empty-state headline: what a brand-new organization is invited to do (docs/frontend-structure.md section 3). */
  title: string;
  body: string;
  /** The build stage that delivers the real page (docs/milestones.md). */
  stage: string;
}

/** Placeholder content for sections whose real pages arrive in later stages. No numbers, no sample data. */
export const SECTIONS: Record<string, Section> = {
  organization: {
    illustration: "org",
    title: "Create your first department",
    body: "The organization chart, departments, teams and people will live here. Start with a department, add the people in it, then say who reports to whom. A one-minute guide will walk you through it.",
    stage: "2.5",
  },
  okrs: {
    illustration: "target",
    title: "Create the first company objective",
    body: "Objectives and key results will be set here and aligned from the company level down to teams and individuals. Begin with one company objective and add key results with a target.",
    stage: "3.1",
  },
  kpis: {
    illustration: "chart",
    title: "Define a KPI, assign it, record a measurement",
    body: "Key performance indicators, their targets and thresholds, and the history of measurements will appear here. Missing measurements will be shown as missing, never as zero.",
    stage: "3.3",
  },
  "my-work": {
    illustration: "tasks",
    title: "No tasks yet",
    body: "Tasks assigned to you, your daily update and your priorities will appear here. Tasks are created by you or assigned by a manager and can be linked to the objectives they serve.",
    stage: "4.1",
  },
  "team-performance": {
    illustration: "team",
    title: "No team data in your scope yet",
    body: "Team objectives, KPIs, task progress and member performance (as permitted) will appear once a team exists and you can see it.",
    stage: "6.2",
  },
  performance: {
    illustration: "gauge",
    title: "Scores appear once objectives, KPIs and tasks have data",
    body: "Every score will come with an explanation of how it was calculated: which inputs counted, which were missing, and what would change it. Nothing is estimated for data that does not exist.",
    stage: "5.2",
  },
  ai: {
    illustration: "spark",
    title: "AI is not configured",
    body: "AI features arrive later and will only explain and recommend over data you are allowed to see. Nothing is shown here until a provider is set up, and no AI output is ever invented.",
    stage: "7.1",
  },
  leadership: {
    illustration: "leadership",
    title: "Publish a company objective to start tracking strategy",
    body: "The leadership view will show strategic objectives, department contribution, risks and trends once company objectives exist.",
    stage: "6.4",
  },
  integrations: {
    illustration: "plug",
    title: "viaSocket is not configured",
    body: "Connected apps and automations will be managed here. The settings needed will be named once this feature is switched on.",
    stage: "8.1",
  },
  settings: {
    illustration: "settings",
    title: "Settings arrive with the features they control",
    body: "Roles and permissions, organization settings, scoring models, the audit log and system status will be added here as those features are built.",
    stage: "2.3",
  },
};
