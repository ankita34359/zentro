import {
  Brain,
  Building2,
  CheckSquare,
  Crown,
  Gauge,
  Plug,
  Settings,
  Target,
  Users,
  BarChart3,
  type LucideIcon,
} from "lucide-react";

export interface Section {
  icon: LucideIcon;
  /** Empty-state headline: what a brand-new organization is invited to do (docs/frontend-structure.md section 3). */
  title: string;
  body: string;
  /** The build stage that delivers the real page (docs/milestones.md). */
  stage: string;
}

/** Placeholder content for sections whose real pages arrive in later stages. No numbers, no sample data. */
export const SECTIONS: Record<string, Section> = {
  organization: {
    icon: Building2,
    title: "Create your first department",
    body: "The organization chart, departments, teams and people will live here. Start with a department, add the people in it, then say who reports to whom. A one-minute guide will walk you through it.",
    stage: "2.5",
  },
  okrs: {
    icon: Target,
    title: "Create the first company objective",
    body: "Objectives and key results will be set here and aligned from the company level down to teams and individuals. Begin with one company objective and add key results with a target.",
    stage: "3.1",
  },
  kpis: {
    icon: BarChart3,
    title: "Define a KPI, assign it, record a measurement",
    body: "Key performance indicators, their targets and thresholds, and the history of measurements will appear here. Missing measurements will be shown as missing, never as zero.",
    stage: "3.3",
  },
  "my-work": {
    icon: CheckSquare,
    title: "No tasks yet",
    body: "Tasks assigned to you, your daily update and your priorities will appear here. Tasks are created by you or assigned by a manager and can be linked to the objectives they serve.",
    stage: "4.1",
  },
  "team-performance": {
    icon: Users,
    title: "No team data in your scope yet",
    body: "Team objectives, KPIs, task progress and member performance (as permitted) will appear once a team exists and you can see it.",
    stage: "6.2",
  },
  performance: {
    icon: Gauge,
    title: "Scores appear once objectives, KPIs and tasks have data",
    body: "Every score will come with an explanation of how it was calculated: which inputs counted, which were missing, and what would change it. Nothing is estimated for data that does not exist.",
    stage: "5.2",
  },
  ai: {
    icon: Brain,
    title: "AI is not configured",
    body: "AI features arrive later and will only explain and recommend over data you are allowed to see. Nothing is shown here until a provider is set up, and no AI output is ever invented.",
    stage: "7.1",
  },
  leadership: {
    icon: Crown,
    title: "Publish a company objective to start tracking strategy",
    body: "The leadership view will show strategic objectives, department contribution, risks and trends once company objectives exist.",
    stage: "6.4",
  },
  integrations: {
    icon: Plug,
    title: "viaSocket is not configured",
    body: "Connected apps and automations will be managed here. The settings needed will be named once this feature is switched on.",
    stage: "8.1",
  },
  settings: {
    icon: Settings,
    title: "Settings arrive with the features they control",
    body: "Roles and permissions, organization settings, scoring models, the audit log and system status will be added here as those features are built.",
    stage: "2.3",
  },
};
