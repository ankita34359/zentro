import { addDays, daysBetween } from "../tasks/dates.js";

/**
 * The fictional company behind "Load demo data": about 60 people in six departments, with reporting lines, team heads and
 * leads, designations, and a few weeks of task history. Everything here is plain data computed from a seed (the organization's
 * id), so the same organization always gets the same company, and tests can rely on it. Dates are relative to the day of loading.
 * Nothing in this file touches the database: `DemoService` inserts it, inside one transaction, flagged `is_demo`.
 */

export type RoleChoice = "r_ceo" | "r_senior" | "r_dept_head" | "r_manager" | "r_team_lead" | "r_mentor" | "r_employee";

export interface DemoDepartment { key: string; name: string; description: string }
export interface DemoTeam { key: string; name: string; deptKey: string; parentKey: string | null }
export interface DemoPerson {
  key: string;
  name: string;
  designation: string;
  deptKey: string;
  teamKey: string | null;
  /** The person's primary manager (a key), or null for the top. */
  managerKey: string | null;
  deptType: "head" | "member";
  teamType: "lead" | "member" | null;
  role: RoleChoice;
  /** Role assignment scope: the whole organization, or the person's team or department. */
  roleScope: "organization" | "department" | "team";
  employmentType: "full_time" | "part_time" | "contractor" | "internship";
  startOffsetDays: number;
}
export interface DemoTask {
  key: string;
  title: string;
  creatorKey: string;
  assigneeKey: string;
  teamKey: string | null;
  status: "not_started" | "in_progress" | "blocked" | "under_review" | "completed" | "cancelled";
  priority: "low" | "medium" | "high" | "critical";
  importance: number;
  progressPct: number;
  /** Days from the day of loading (negative = in the past). */
  dueOffset: number | null;
  createdOffset: number;
  completedOffset: number | null;
  estimatedMinutes: number | null;
  loggedMinutes: number;
  blockedReason: string | null;
  comment: { authorKey: string; body: string } | null;
  /** The objective (and the key result, by position) the task supports (stage 4.2). */
  objectiveKey: string | null;
  krIndex: number | null;
  /** Recorded on finished tasks only. `qualityBy` rates it (never the person who did it). */
  outcome: { summary: string; quality: number | null; qualityBy: string | null } | null;
  /** Another task (earlier in the list, so there is never a loop) this one waits for. */
  dependsOnKey: string | null;
}
export interface DemoKeyResult {
  title: string;
  direction: "increase" | "decrease";
  method: "linear" | "binary" | "manual";
  start: number;
  target: number;
  unit: string | null;
  weight: number;
  ownerKey: string;
  /** Recorded actual values, oldest first. The last one is the current value. Empty = nothing recorded (no data). */
  history: { dayOffset: number; value: number; note?: string }[];
}
export interface DemoObjective {
  key: string;
  level: "company" | "department" | "team" | "individual";
  deptKey: string | null;
  teamKey: string | null;
  ownerKey: string;
  title: string;
  description: string;
  objectiveType: "strategic" | "operational" | "development";
  priority: "low" | "medium" | "high" | "critical";
  startOffset: number;
  endOffset: number;
  lifecycle: "draft" | "active" | "completed";
  published: boolean;
  keyResults: DemoKeyResult[];
  /** The objective this one contributes to (stage 3.2), and how heavily. */
  parentKey: string | null;
  parentWeight: number;
  /** Teams and departments that also work on it. */
  contributors: { kind: "team" | "department"; key: string; role: "contributor" | "reviewer" }[];
}
export interface DemoKpi {
  key: string;
  name: string;
  description: string;
  category: "delivery" | "quality" | "impact" | "financial" | "growth" | "people" | "health";
  unit: string | null;
  frequency: "weekly" | "monthly" | "quarterly";
  direction: "higher_is_better" | "lower_is_better";
  aggregation: "sum" | "avg" | "last";
  defaultTarget: number;
  /** Warning and critical, as a percentage of the target (below it for "higher is better", above it for "lower is better"). */
  warnPct: number;
  critPct: number;
  /** Who has it: a role family, a designation, a team, a department or one person (a key from this file). */
  assignments: { kind: "role_family" | "designation" | "team" | "department"; key: string; target?: number }[];
  /** One entry per subject with values. `values` line up with the LAST n completed periods, oldest first; null = nothing was recorded (a gap). */
  series: { subject: { kind: "person" | "team" | "department" | "organization"; key: string | null }; values: (number | null)[]; correction?: { index: number; value: number; note: string } }[];
}
export interface DemoDailyUpdate { personKey: string; dayOffset: number; summary: string; blockers: string | null }
export interface DemoMentorship {
  mentorKey: string;
  menteeKey: string;
  /** Days from the day of loading (negative = in the past). */
  startOffset: number;
  cadenceDays: number;
  goals: string;
  activities: { dayOffset: number; type: "one_on_one" | "feedback" | "review" | "unblock" | "training" | "goal_setting"; minutes: number; summary: string }[];
}
export interface DemoCompany {
  departments: DemoDepartment[];
  teams: DemoTeam[];
  roleFamilies: { key: string; name: string }[];
  designations: { name: string; familyKey: string }[];
  people: DemoPerson[];
  tasks: DemoTask[];
  dailyUpdates: DemoDailyUpdate[];
  objectives: DemoObjective[];
  kpis: DemoKpi[];
  mentorships: DemoMentorship[];
}

/** Small deterministic generator (mulberry32). */
export function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Aarav", "Maya", "Liam", "Sofia", "Noah", "Priya", "Ethan", "Zara", "Lucas", "Amara", "Mateo", "Hana", "Oliver", "Leila", "Arjun", "Chloe", "Kenji", "Nadia", "Samuel", "Ines", "Diego", "Freya", "Omar", "Ruth", "Tariq", "Elena", "Felix", "Anya", "Jonas", "Mei", "Hugo", "Sana", "Theo", "Ivy", "Rafael", "Yara", "Callum", "Nia", "Victor", "Bella", "Idris", "Clara", "Dev", "Esme", "Gabriel", "Keira", "Lars", "Mina", "Nico", "Olga", "Pablo", "Quinn", "Rosa", "Sven", "Tess", "Umar", "Vera", "Wes", "Xena", "Yusuf", "Zoe", "Anil", "Brooke", "Carlos", "Dana", "Emil", "Fiona"];
const LAST = ["Okafor", "Lindqvist", "Moreau", "Tanaka", "Haddad", "Novak", "Banerjee", "Castillo", "Fischer", "Ibrahim", "Jensen", "Kowalski", "Larsen", "Mbeki", "Nakamura", "Ortiz", "Petrov", "Quigley", "Rahman", "Silva", "Torres", "Underwood", "Vargas", "Weber", "Xu", "Yilmaz", "Zimmerman", "Abbott", "Bishop", "Campos", "Dalton", "Eriksen", "Fontaine", "Grover", "Hayashi", "Iyer", "Jovanovic", "Kaplan", "Lombardi", "Mansour", "Nolan", "Osei", "Pereira", "Rossi", "Sato", "Thorne", "Ueda", "Valdez", "Whitfield", "Yamada", "Zhou", "Arora", "Brandt", "Cohen", "Delgado", "Ellis", "Farouk", "Gallo", "Holm", "Ivanov", "Joshi", "Kemp", "Lopes"];

const DEPARTMENTS: DemoDepartment[] = [
  { key: "exec", name: "Executive", description: "Company leadership" },
  { key: "eng", name: "Engineering", description: "Builds and runs the product" },
  { key: "pd", name: "Product & Design", description: "Decides what to build and how it feels" },
  { key: "sales", name: "Sales", description: "Wins and grows customers" },
  { key: "cs", name: "Customer Success", description: "Helps customers succeed after they buy" },
  { key: "ops", name: "People & Operations", description: "People, finance and the way we work" },
];

const TEAMS: DemoTeam[] = [
  { key: "platform", name: "Platform", deptKey: "eng", parentKey: null },
  { key: "infra", name: "Platform Infrastructure", deptKey: "eng", parentKey: "platform" },
  { key: "mobile", name: "Mobile", deptKey: "eng", parentKey: null },
  { key: "data", name: "Data", deptKey: "eng", parentKey: null },
  { key: "product", name: "Product", deptKey: "pd", parentKey: null },
  { key: "design", name: "Design", deptKey: "pd", parentKey: null },
  { key: "inside", name: "Inside Sales", deptKey: "sales", parentKey: null },
  { key: "field", name: "Field Sales", deptKey: "sales", parentKey: null },
  { key: "support", name: "Support", deptKey: "cs", parentKey: null },
  { key: "onboarding", name: "Onboarding", deptKey: "cs", parentKey: null },
  { key: "people", name: "People", deptKey: "ops", parentKey: null },
  { key: "finops", name: "Finance & Operations", deptKey: "ops", parentKey: null },
];

const FAMILIES = [
  { key: "lead", name: "Leadership" },
  { key: "eng", name: "Engineering" },
  { key: "pd", name: "Product & Design" },
  { key: "sales", name: "Sales" },
  { key: "cust", name: "Customer" },
  { key: "ops", name: "Operations" },
];

const DESIGNATIONS: { name: string; familyKey: string }[] = [
  { name: "Chief Executive Officer", familyKey: "lead" },
  { name: "Chief of Staff", familyKey: "lead" },
  { name: "Vice President", familyKey: "lead" },
  { name: "Engineering Manager", familyKey: "eng" },
  { name: "Principal Engineer", familyKey: "eng" },
  { name: "Senior Engineer", familyKey: "eng" },
  { name: "Software Engineer", familyKey: "eng" },
  { name: "Junior Engineer", familyKey: "eng" },
  { name: "Data Analyst", familyKey: "eng" },
  { name: "Group Product Manager", familyKey: "pd" },
  { name: "Product Manager", familyKey: "pd" },
  { name: "Design Lead", familyKey: "pd" },
  { name: "Product Designer", familyKey: "pd" },
  { name: "Sales Manager", familyKey: "sales" },
  { name: "Account Executive", familyKey: "sales" },
  { name: "Sales Development Rep", familyKey: "sales" },
  { name: "Support Lead", familyKey: "cust" },
  { name: "Support Specialist", familyKey: "cust" },
  { name: "Onboarding Lead", familyKey: "cust" },
  { name: "Onboarding Specialist", familyKey: "cust" },
  { name: "People Partner", familyKey: "ops" },
  { name: "Finance Manager", familyKey: "ops" },
  { name: "Finance Analyst", familyKey: "ops" },
  { name: "Mentor", familyKey: "lead" },
];

/** How many people each team has besides its lead, and the designations those members hold. */
const TEAM_PLAN: Record<string, { lead: string; leadRole: RoleChoice; members: number; memberTitles: string[] }> = {
  platform: { lead: "Engineering Manager", leadRole: "r_team_lead", members: 5, memberTitles: ["Principal Engineer", "Senior Engineer", "Senior Engineer", "Software Engineer", "Software Engineer"] },
  infra: { lead: "Senior Engineer", leadRole: "r_team_lead", members: 2, memberTitles: ["Software Engineer", "Junior Engineer"] },
  mobile: { lead: "Engineering Manager", leadRole: "r_team_lead", members: 5, memberTitles: ["Senior Engineer", "Software Engineer", "Software Engineer", "Software Engineer", "Junior Engineer"] },
  data: { lead: "Engineering Manager", leadRole: "r_team_lead", members: 4, memberTitles: ["Senior Engineer", "Data Analyst", "Data Analyst", "Software Engineer"] },
  product: { lead: "Group Product Manager", leadRole: "r_manager", members: 3, memberTitles: ["Product Manager", "Product Manager", "Product Manager"] },
  design: { lead: "Design Lead", leadRole: "r_manager", members: 3, memberTitles: ["Product Designer", "Product Designer", "Product Designer"] },
  inside: { lead: "Sales Manager", leadRole: "r_manager", members: 5, memberTitles: ["Account Executive", "Account Executive", "Sales Development Rep", "Sales Development Rep", "Sales Development Rep"] },
  field: { lead: "Sales Manager", leadRole: "r_manager", members: 4, memberTitles: ["Account Executive", "Account Executive", "Account Executive", "Sales Development Rep"] },
  support: { lead: "Support Lead", leadRole: "r_manager", members: 5, memberTitles: ["Support Specialist", "Support Specialist", "Support Specialist", "Support Specialist", "Support Specialist"] },
  onboarding: { lead: "Onboarding Lead", leadRole: "r_manager", members: 3, memberTitles: ["Onboarding Specialist", "Onboarding Specialist", "Onboarding Specialist"] },
  people: { lead: "People Partner", leadRole: "r_manager", members: 2, memberTitles: ["People Partner", "People Partner"] },
  finops: { lead: "Finance Manager", leadRole: "r_manager", members: 3, memberTitles: ["Finance Analyst", "Finance Analyst", "Finance Analyst"] },
};

const TASK_POOL: Record<string, string[]> = {
  eng: ["Upgrade the build pipeline", "Fix flaky integration tests", "Add rate limiting to the public API", "Migrate the cache layer", "Review the on-call runbook", "Reduce cold-start time", "Write the incident postmortem", "Roll out feature flags to all services", "Improve error messages in the SDK", "Audit third-party dependencies", "Speed up the nightly data export", "Add dark mode to the mobile app", "Fix the push notification delay", "Document the data model", "Clean up unused database indexes"],
  pd: ["Write the Q1 product brief", "Run five customer interviews", "Redesign the onboarding checklist", "Prototype the new dashboard", "Update the design system tokens", "Analyze feature adoption", "Prepare the roadmap review", "Usability test the mobile flow", "Write release notes", "Refine the pricing page copy"],
  sales: ["Follow up with the top ten open deals", "Prepare the enterprise pricing proposal", "Qualify this week's inbound leads", "Update the sales playbook", "Run the partner webinar", "Close the renewal for the logistics customer", "Build the territory plan", "Clean the CRM pipeline", "Draft the case study with a customer", "Prepare the quarterly business review"],
  cs: ["Reduce the first-response time", "Write help articles for the new release", "Onboard the three new enterprise customers", "Review the open escalations", "Build the customer health report", "Run the customer advisory call", "Update the support macros", "Analyze last month's churn reasons", "Train the team on the new billing flow", "Follow up on unresolved tickets over a week old"],
  ops: ["Close the monthly books", "Prepare the board pack", "Update the hiring plan", "Run the engagement survey", "Review vendor contracts", "Refresh the onboarding handbook", "Reconcile the expense reports", "Plan the team offsite", "Update the compensation bands", "Automate the invoice approvals"],
  exec: ["Prepare the all-hands update", "Review the quarterly objectives", "Meet the top three investors", "Approve the annual budget", "Review the leadership scorecards"],
};

const COMMENTS = ["Looks good so far, thanks for the update.", "Can you share an estimate by Thursday?", "I added the notes from the call to the folder.", "Let's discuss this in our next one-to-one.", "Blocked on access? I can ask IT today.", "Great progress, this unblocks the next release.", "Please link the final version when it is ready.", "I will review it first thing tomorrow."];
const SUMMARIES = ["Finished the review comments and started on the next batch.", "Paired with a teammate to unblock the release; planning to wrap up tomorrow.", "Spent the day on customer calls and updated the tracker.", "Cleared the backlog of small fixes and drafted the plan for next week.", "Worked on the estimate and shared it with the team for feedback.", "Reviewed three pull requests and fixed a flaky test."];
const BLOCKS = ["Waiting for access to the staging environment.", "Need a decision on scope from the product owner.", "The vendor has not replied yet.", "Test data is out of date."];

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");

/** The whole demo company for a seed (the organization's id). Always the same for the same seed. */
export function buildDemoCompany(seed: string, today = "2026-02-14"): DemoCompany {
  const rand = rng(`company:${seed}`);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const between = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));

  // unique names: walk a shuffled list of first names against last names
  const firsts = [...FIRST].sort(() => rand() - 0.5);
  const lasts = [...LAST].sort(() => rand() - 0.5);
  let n = 0;
  const nextName = (): string => `${firsts[n % firsts.length]} ${lasts[(n * 7 + Math.floor(n / firsts.length)) % lasts.length]}`.replace(/\s+/g, " ") + (n >= firsts.length * 2 ? ` ${n}` : "");
  const people: DemoPerson[] = [];
  const add = (p: Omit<DemoPerson, "key" | "name" | "employmentType" | "startOffsetDays">): DemoPerson => {
    const person: DemoPerson = { ...p, key: `p${people.length + 1}`, name: nextName(), employmentType: rand() < 0.08 ? "contractor" : rand() < 0.03 ? "part_time" : "full_time", startOffsetDays: -between(60, 1400) };
    n += 1;
    people.push(person);
    return person;
  };

  const ceo = add({ designation: "Chief Executive Officer", deptKey: "exec", teamKey: null, managerKey: null, deptType: "head", teamType: null, role: "r_ceo", roleScope: "organization" });
  add({ designation: "Chief of Staff", deptKey: "exec", teamKey: null, managerKey: ceo.key, deptType: "member", teamType: null, role: "r_senior", roleScope: "organization" });
  const heads: Record<string, DemoPerson> = {};
  for (const d of DEPARTMENTS.filter((x) => x.key !== "exec")) {
    heads[d.key] = add({ designation: "Vice President", deptKey: d.key, teamKey: null, managerKey: ceo.key, deptType: "head", teamType: null, role: "r_dept_head", roleScope: "department" });
  }
  const leads: Record<string, DemoPerson> = {};
  for (const t of TEAMS) {
    const plan = TEAM_PLAN[t.key]!;
    const parentLead = t.parentKey ? leads[t.parentKey] : undefined;
    leads[t.key] = add({ designation: plan.lead, deptKey: t.deptKey, teamKey: t.key, managerKey: (parentLead ?? heads[t.deptKey])!.key, deptType: "member", teamType: "lead", role: plan.leadRole, roleScope: plan.leadRole === "r_team_lead" ? "team" : "organization" });
    plan.memberTitles.slice(0, plan.members).forEach((title, i) => {
      add({ designation: title, deptKey: t.deptKey, teamKey: t.key, managerKey: leads[t.key]!.key, deptType: "member", teamType: "member", role: title === "Principal Engineer" || (title === "Senior Engineer" && i === 0 && t.key === "mobile") ? "r_mentor" : "r_employee", roleScope: "organization" });
    });
  }

  // tasks: two or three per person, with a believable spread of status and dates around the day of loading
  const tasks: DemoTask[] = [];
  const byKey = new Map(people.map((p) => [p.key, p]));
  const usedTitles = new Map<string, number>();
  for (const person of people) {
    const count = person.key === ceo.key ? 2 : between(2, 3);
    for (let i = 0; i < count; i++) {
      const pool = TASK_POOL[person.deptKey] ?? TASK_POOL.ops!;
      let title = pick(pool);
      const seen = usedTitles.get(`${person.key}:${title}`) ?? 0;
      usedTitles.set(`${person.key}:${title}`, seen + 1);
      if (seen > 0) title = `${title} (part 2)`;
      const r = rand();
      let status: DemoTask["status"];
      if (r < 0.24) status = "not_started";
      else if (r < 0.55) status = "in_progress";
      else if (r < 0.61) status = "blocked";
      else if (r < 0.69) status = "under_review";
      else if (r < 0.96) status = "completed";
      else status = "cancelled";
      const open = status !== "completed" && status !== "cancelled";
      let dueOffset: number | null;
      const d = rand();
      if (open) dueOffset = d < 0.18 ? -between(1, 12) : d < 0.3 ? 0 : d < 0.4 ? 1 : d < 0.9 ? between(2, 21) : null;
      else dueOffset = -between(1, 25);
      const created = -between(8, 40);
      const completedOffset = status === "completed" ? Math.min(-1, (dueOffset ?? -3) + between(-3, 2)) : null;
      const est = pick([60, 120, 180, 240, 480, 960]);
      const lead = person.managerKey ? byKey.get(person.managerKey)! : person;
      const creator = rand() < 0.65 ? lead : person;
      tasks.push({
        key: `t${tasks.length + 1}`,
        title,
        creatorKey: creator.key,
        assigneeKey: person.key,
        teamKey: person.teamKey,
        status,
        priority: rand() < 0.08 ? "critical" : rand() < 0.28 ? "high" : rand() < 0.75 ? "medium" : "low",
        importance: between(1, 5),
        progressPct: status === "completed" ? 100 : status === "not_started" ? 0 : status === "under_review" ? between(80, 95) : status === "cancelled" ? between(0, 30) : between(10, 85),
        dueOffset,
        createdOffset: Math.min(created, (completedOffset ?? 0) - 1),
        completedOffset,
        estimatedMinutes: est,
        loggedMinutes: status === "not_started" ? 0 : Math.round((est * (status === "completed" ? between(70, 130) : between(10, 70))) / 100 / 5) * 5,
        blockedReason: status === "blocked" ? pick(BLOCKS) : null,
        objectiveKey: null,
        krIndex: null,
        outcome: null,
        dependsOnKey: null,
        comment: rand() < 0.22 ? { authorKey: (rand() < 0.6 ? lead : person).key === person.key && person.managerKey ? person.managerKey : lead.key, body: pick(COMMENTS) } : null,
      });
    }
  }

  const dailyUpdates: DemoDailyUpdate[] = [];
  for (const person of people) {
    if (rand() < 0.4) dailyUpdates.push({ personKey: person.key, dayOffset: 0, summary: pick(SUMMARIES), blockers: rand() < 0.2 ? pick(BLOCKS) : null });
    if (rand() < 0.4) dailyUpdates.push({ personKey: person.key, dayOffset: -1, summary: pick(SUMMARIES), blockers: rand() < 0.15 ? pick(BLOCKS) : null });
  }

  // ----- objectives, key results and the tasks that support them (stages 3.1 and 4.2). Drawn after everything above, so
  // the people and tasks of earlier versions of the seed do not change. -----
  const kr = (title: string, direction: "increase" | "decrease", start: number, target: number, unit: string | null, ownerKey: string, history: DemoKeyResult["history"], weight = 1, method: DemoKeyResult["method"] = "linear"): DemoKeyResult => ({ title, direction, method, start, target, unit, weight, ownerKey, history });
  const objectives: DemoObjective[] = [];
  const obj = (o: Omit<DemoObjective, "key" | "parentKey" | "parentWeight" | "contributors">): DemoObjective => {
    const full: DemoObjective = { ...o, key: `o${objectives.length + 1}`, parentKey: null, parentWeight: 1, contributors: [] };
    objectives.push(full);
    return full;
  };
  const head = (dept: string): string => heads[dept]!.key;
  const lead = (team: string): string => leads[team]!.key;
  obj({ level: "company", deptKey: null, teamKey: null, ownerKey: ceo.key, title: "Reach $12M in annual recurring revenue", description: "Grow revenue by winning new enterprise customers while keeping the ones we have.", objectiveType: "strategic", priority: "critical", startOffset: -120, endOffset: 150, lifecycle: "active", published: true, keyResults: [
    kr("Annual recurring revenue", "increase", 8, 12, "$M", head("sales"), [{ dayOffset: -90, value: 8.3 }, { dayOffset: -60, value: 8.9 }, { dayOffset: -30, value: 9.6 }, { dayOffset: -3, value: 10.4, note: "After the logistics renewal." }], 3),
    kr("New enterprise customers signed", "increase", 0, 40, "customers", head("sales"), [{ dayOffset: -75, value: 6 }, { dayOffset: -45, value: 11 }, { dayOffset: -20, value: 17 }, { dayOffset: -2, value: 24 }], 2),
    kr("Gross revenue churn", "decrease", 7, 4, "%", head("cs"), [{ dayOffset: -60, value: 6.8 }, { dayOffset: -30, value: 6.2 }, { dayOffset: -2, value: 5.1 }], 2),
  ] });
  obj({ level: "company", deptKey: null, teamKey: null, ownerKey: ceo.key, title: "Make Zentro the easiest product to adopt", description: "Customers should be productive in their first week.", objectiveType: "strategic", priority: "high", startOffset: -100, endOffset: 120, lifecycle: "active", published: true, keyResults: [
    kr("Median days from signing to first value", "decrease", 21, 7, "days", head("cs"), [{ dayOffset: -70, value: 20 }, { dayOffset: -40, value: 19 }, { dayOffset: -10, value: 15 }], 2),
    kr("Customer satisfaction (CSAT)", "increase", 78, 90, "points", head("cs"), [{ dayOffset: -50, value: 79 }, { dayOffset: -20, value: 82 }]),
    kr("Self-serve activation rate", "increase", 30, 60, "%", head("pd"), []), // nothing recorded yet: shows "No data yet", never 0%
  ] });
  obj({ level: "company", deptKey: null, teamKey: null, ownerKey: ceo.key, title: "Build a team people want to stay in", description: "Hire well, grow people, and keep them.", objectiveType: "strategic", priority: "medium", startOffset: -90, endOffset: 180, lifecycle: "active", published: false, keyResults: [
    kr("Employee net promoter score", "increase", 20, 50, "points", head("ops"), [{ dayOffset: -80, value: 24 }, { dayOffset: -15, value: 31 }]),
    kr("Open roles filled", "increase", 0, 12, "roles", head("ops"), [{ dayOffset: -50, value: 3 }, { dayOffset: -5, value: 5 }]),
  ] });
  obj({ level: "department", deptKey: "eng", teamKey: null, ownerKey: head("eng"), title: "Ship faster with fewer incidents", description: "A faster, safer delivery pipeline.", objectiveType: "operational", priority: "high", startOffset: -90, endOffset: 90, lifecycle: "active", published: false, keyResults: [
    kr("Median build and deploy time", "decrease", 40, 15, "min", lead("platform"), [{ dayOffset: -60, value: 38 }, { dayOffset: -25, value: 29 }, { dayOffset: -4, value: 24 }], 2),
    kr("Severity-1 incidents per month", "decrease", 6, 1, "incidents", lead("infra"), [{ dayOffset: -45, value: 5 }, { dayOffset: -10, value: 3 }]),
    kr("API availability", "increase", 99.5, 99.95, "%", lead("platform"), [{ dayOffset: -30, value: 99.71 }, { dayOffset: -3, value: 99.82 }]),
  ] });
  obj({ level: "department", deptKey: "pd", teamKey: null, ownerKey: head("pd"), title: "Redesign the first-run experience", description: "Make the first ten minutes obvious.", objectiveType: "operational", priority: "high", startOffset: -60, endOffset: 100, lifecycle: "active", published: false, keyResults: [
    kr("Users who finish setup in their first session", "increase", 35, 70, "%", lead("product"), [{ dayOffset: -35, value: 38 }, { dayOffset: -8, value: 47 }]),
    kr("Usability test pass rate", "increase", 50, 90, "%", lead("design"), [{ dayOffset: -12, value: 62 }]),
  ] });
  obj({ level: "department", deptKey: "pd", teamKey: null, ownerKey: head("pd"), title: "Plan next year's roadmap", description: "A first draft, not yet started.", objectiveType: "operational", priority: "low", startOffset: 20, endOffset: 120, lifecycle: "draft", published: false, keyResults: [
    kr("Roadmap themes agreed with leadership", "increase", 0, 5, "themes", head("pd"), []),
  ] });
  obj({ level: "department", deptKey: "sales", teamKey: null, ownerKey: head("sales"), title: "Grow the pipeline", description: "More qualified deals at every stage.", objectiveType: "operational", priority: "high", startOffset: -80, endOffset: 100, lifecycle: "active", published: false, keyResults: [
    kr("Qualified pipeline", "increase", 2, 6, "$M", lead("inside"), [{ dayOffset: -50, value: 2.6 }, { dayOffset: -22, value: 3.4 }, { dayOffset: -3, value: 4.1 }], 2),
    kr("Win rate", "increase", 18, 28, "%", lead("field"), [{ dayOffset: -30, value: 20 }]),
  ] });
  obj({ level: "department", deptKey: "cs", teamKey: null, ownerKey: head("cs"), title: "Answer customers faster", description: "Fast, first-class support.", objectiveType: "operational", priority: "medium", startOffset: -70, endOffset: 80, lifecycle: "active", published: false, keyResults: [
    kr("Median first response time", "decrease", 240, 60, "min", lead("support"), [{ dayOffset: -40, value: 220 }, { dayOffset: -14, value: 150 }, { dayOffset: -2, value: 118 }], 2),
    kr("Tickets resolved on first contact", "increase", 55, 80, "%", lead("support"), [{ dayOffset: -20, value: 61 }]),
  ] });
  obj({ level: "department", deptKey: "ops", teamKey: null, ownerKey: head("ops"), title: "Close the books in five days", description: "A calm, predictable month end.", objectiveType: "operational", priority: "medium", startOffset: -200, endOffset: -15, lifecycle: "completed", published: false, keyResults: [
    kr("Working days to close the month", "decrease", 10, 5, "days", lead("finops"), [{ dayOffset: -150, value: 9 }, { dayOffset: -90, value: 7 }, { dayOffset: -40, value: 5 }]),
  ] });
  obj({ level: "team", deptKey: "eng", teamKey: "platform", ownerKey: lead("platform"), title: "Make the public API dependable", description: "Rate limits, clear errors and good docs.", objectiveType: "operational", priority: "high", startOffset: -45, endOffset: 60, lifecycle: "active", published: false, keyResults: [
    kr("Endpoints covered by rate limiting", "increase", 0, 100, "%", lead("platform"), [{ dayOffset: -20, value: 35 }, { dayOffset: -3, value: 60 }], 1, "manual"),
    kr("API reference pages reviewed", "increase", 0, 48, "pages", lead("platform"), [{ dayOffset: -10, value: 14 }]),
  ] });
  obj({ level: "team", deptKey: "sales", teamKey: "inside", ownerKey: lead("inside"), title: "Qualify leads within a day", description: "Nobody waits for a first call.", objectiveType: "operational", priority: "medium", startOffset: -30, endOffset: 60, lifecycle: "active", published: false, keyResults: [
    kr("Leads contacted within 24 hours", "increase", 60, 95, "%", lead("inside"), [{ dayOffset: -12, value: 72 }]),
  ] });
  obj({ level: "team", deptKey: "cs", teamKey: "support", ownerKey: lead("support"), title: "Keep the help centre current", description: "Every release has its help article.", objectiveType: "operational", priority: "low", startOffset: -30, endOffset: 60, lifecycle: "active", published: false, keyResults: [
    kr("Release notes with a help article", "increase", 0, 1, null, lead("support"), [], 1, "binary"),
  ] });
  const learner = people.find((p) => p.teamKey === "platform" && p.teamType === "member" && p.role === "r_employee");
  if (learner) {
    obj({ level: "individual", deptKey: null, teamKey: null, ownerKey: learner.key, title: "Get certified in cloud infrastructure", description: "A development goal agreed in a one-to-one.", objectiveType: "development", priority: "medium", startOffset: -40, endOffset: 110, lifecycle: "active", published: false, keyResults: [
      kr("Course modules completed", "increase", 0, 12, "modules", learner.key, [{ dayOffset: -14, value: 3 }]),
    ] });
  }

  // alignment: departments contribute to company objectives, teams to their department's, the personal goal to its team's.
  // One department objective (the roadmap draft) is left unlinked on purpose, so the gaps report has something real to show.
  const by = (title: string): DemoObjective => objectives.find((o) => o.title.startsWith(title))!;
  const align = (child: string, parent: string, weight = 1): void => {
    by(child).parentKey = by(parent).key;
    by(child).parentWeight = weight;
  };
  align("Ship faster with fewer incidents", "Make Zentro the easiest", 2);
  align("Redesign the first-run experience", "Make Zentro the easiest", 2);
  align("Grow the pipeline", "Reach $12M", 3);
  align("Answer customers faster", "Reach $12M", 1);
  align("Close the books in five days", "Build a team people want to stay in", 1);
  align("Make the public API dependable", "Ship faster with fewer incidents", 2);
  align("Qualify leads within a day", "Grow the pipeline", 1);
  align("Keep the help centre current", "Answer customers faster", 1);
  if (learner) align("Get certified in cloud infrastructure", "Make the public API dependable", 1);
  by("Make Zentro the easiest").contributors.push({ kind: "department", key: "cs", role: "contributor" });
  by("Ship faster with fewer incidents").contributors.push({ kind: "team", key: "data", role: "contributor" });
  by("Redesign the first-run experience").contributors.push({ kind: "team", key: "design", role: "contributor" }, { kind: "team", key: "product", role: "reviewer" });

  // tasks support the objectives of their team, else their department, else the company
  const OUTCOMES = ["Shipped and verified with the team.", "Delivered to the customer; feedback was positive.", "Completed ahead of the review; notes are in the folder.", "Done. Follow-up work is tracked in a new task."];
  const byTeam = new Map(objectives.filter((o) => o.teamKey).map((o) => [o.teamKey!, o]));
  const byDept = new Map(objectives.filter((o) => o.level === "department" && o.lifecycle === "active").map((o) => [o.deptKey!, o]));
  const company = objectives.filter((o) => o.level === "company");
  const taskPerson = new Map(tasks.map((t) => [t.key, byKey.get(t.assigneeKey)!]));
  tasks.forEach((t, i) => {
    const person = taskPerson.get(t.key)!;
    const target = (person.teamKey ? byTeam.get(person.teamKey) : undefined) ?? byDept.get(person.deptKey) ?? (rand() < 0.5 ? company[Math.floor(rand() * company.length)] : undefined);
    if (target && rand() < 0.62 && target.lifecycle !== "completed") {
      t.objectiveKey = target.key;
      t.krIndex = target.keyResults.length > 0 && rand() < 0.6 ? Math.floor(rand() * target.keyResults.length) : null;
    }
    if (t.status === "completed" && rand() < 0.55) {
      const reviewer = person.managerKey && rand() < 0.65 ? person.managerKey : null;
      t.outcome = { summary: pick(OUTCOMES), quality: reviewer ? between(3, 5) : null, qualityBy: reviewer };
    }
    // a few open tasks wait for an earlier task of the same team (earlier in the list: never a loop)
    if (i > 0 && (t.status === "not_started" || t.status === "in_progress") && t.dependsOnKey === null && rand() < 0.1) {
      const earlier = tasks.slice(Math.max(0, i - 12), i).filter((e) => e.teamKey === t.teamKey && e.status !== "cancelled" && e.key !== t.key);
      if (earlier.length > 0) t.dependsOnKey = pick(earlier).key;
    }
  });

  // ----- KPIs with a believable history (stages 3.3 and 3.4). Drawn after everything above, so earlier versions of the seed do not change. -----
  const kpis: DemoKpi[] = [];
  const factor = (lo: number, hi: number): number => lo + rand() * (hi - lo);
  /** `n` values around the target, drifting a little, with an optional share of gaps. Lower-is-better values are the target divided by the factor. */
  const series = (n: number, target: number, lower: boolean, gapChance: number, level: number): (number | null)[] => {
    let drift = level;
    return Array.from({ length: n }, () => {
      drift = Math.min(1.3, Math.max(0.35, drift + factor(-0.12, 0.14)));
      if (rand() < gapChance) return null;
      const f = drift;
      const v = lower ? target / f : target * f;
      return Math.round(v * 10) / 10;
    });
  };
  const salesPeople = people.filter((p) => p.designation === "Account Executive" || p.designation === "Sales Development Rep");
  const engineers = people.filter((p) => p.designation === "Software Engineer");
  const addKpi = (k: Omit<DemoKpi, "key">): DemoKpi => {
    const full: DemoKpi = { ...k, key: `k${kpis.length + 1}` };
    kpis.push(full);
    return full;
  };
  const leadsKpi = addKpi({ name: "Qualified leads", description: "Leads that passed qualification this month.", category: "growth", unit: "leads", frequency: "monthly", direction: "higher_is_better", aggregation: "sum", defaultTarget: 40, warnPct: 80, critPct: 55, assignments: [{ kind: "role_family", key: "sales" }], series: salesPeople.map((p, i) => ({ subject: { kind: "person" as const, key: p.key }, values: series(6, p.designation === "Account Executive" ? 40 : 40, false, i % 4 === 3 ? 0.4 : 0.1, factor(0.7, 1.1)) })) });
  const firstSeller = leadsKpi.series[0];
  if (firstSeller) {
    firstSeller.values[2] = firstSeller.values[2] ?? 39;
    firstSeller.correction = { index: 2, value: 37, note: "Two leads were counted twice" };
  }
  const secondSeller = leadsKpi.series[1];
  if (secondSeller) secondSeller.values[5] = null; // the most recent month is missing for one seller, so the gaps show on the first look
  addKpi({ name: "Win rate", description: "Share of qualified deals that were won.", category: "growth", unit: "%", frequency: "monthly", direction: "higher_is_better", aggregation: "avg", defaultTarget: 25, warnPct: 80, critPct: 60, assignments: [{ kind: "team", key: "field" }, { kind: "team", key: "inside", target: 22 }], series: [{ subject: { kind: "team", key: "field" }, values: series(6, 25, false, 0, 0.9) }, { subject: { kind: "team", key: "inside" }, values: series(6, 22, false, 0, 0.8) }] });
  addKpi({ name: "First response time", description: "Median minutes until a customer gets a first answer.", category: "quality", unit: "min", frequency: "monthly", direction: "lower_is_better", aggregation: "avg", defaultTarget: 60, warnPct: 125, critPct: 200, assignments: [{ kind: "team", key: "support" }], series: [{ subject: { kind: "team", key: "support" }, values: [190, 150, 128, 104, 91, 78] }] });
  addKpi({ name: "Customer satisfaction (CSAT)", description: "Average satisfaction score from customer surveys.", category: "quality", unit: "points", frequency: "quarterly", direction: "higher_is_better", aggregation: "avg", defaultTarget: 90, warnPct: 92, critPct: 85, assignments: [{ kind: "department", key: "cs" }], series: [{ subject: { kind: "department", key: "cs" }, values: [81, 83, 86, 88] }] });
  addKpi({ name: "Deployments per week", description: "Production deployments completed in the week.", category: "delivery", unit: "deploys", frequency: "weekly", direction: "higher_is_better", aggregation: "sum", defaultTarget: 12, warnPct: 75, critPct: 50, assignments: [{ kind: "team", key: "platform" }], series: [{ subject: { kind: "team", key: "platform" }, values: series(8, 12, false, 0.12, 0.85) }] });
  addKpi({ name: "Change failure rate", description: "Share of deployments that needed a fix or a rollback.", category: "quality", unit: "%", frequency: "monthly", direction: "lower_is_better", aggregation: "avg", defaultTarget: 5, warnPct: 140, critPct: 220, assignments: [{ kind: "team", key: "platform" }, { kind: "team", key: "mobile", target: 6 }], series: [{ subject: { kind: "team", key: "platform" }, values: [4.1, 4.6, 5.2, 7.8, 9.4, 12.1] }, { subject: { kind: "team", key: "mobile" }, values: series(6, 6, true, 0, 0.95) }] });
  addKpi({ name: "Sprint predictability", description: "Share of planned work an engineer finished in the month.", category: "delivery", unit: "%", frequency: "monthly", direction: "higher_is_better", aggregation: "avg", defaultTarget: 85, warnPct: 85, critPct: 65, assignments: [{ kind: "designation", key: "Software Engineer" }], series: engineers.map((p, i) => ({ subject: { kind: "person" as const, key: p.key }, values: series(6, 85, false, i % 3 === 2 ? 0.3 : 0.05, factor(0.8, 1.05)) })) });
  addKpi({ name: "Time to hire", description: "Average days from opening a role to an accepted offer.", category: "people", unit: "days", frequency: "quarterly", direction: "lower_is_better", aggregation: "avg", defaultTarget: 35, warnPct: 125, critPct: 170, assignments: [{ kind: "department", key: "ops" }], series: [{ subject: { kind: "department", key: "ops" }, values: [52, 47, 41, 38] }] });
  addKpi({ name: "Annual recurring revenue", description: "Recurring revenue at the end of the month, in millions.", category: "financial", unit: "$M", frequency: "monthly", direction: "higher_is_better", aggregation: "last", defaultTarget: 12, warnPct: 75, critPct: 55, assignments: [], series: [{ subject: { kind: "organization", key: null }, values: [8.1, 8.4, 8.9, 9.6, 10.1, 10.4] }] });
  addKpi({ name: "Employee net promoter score", description: "Would people recommend working here (survey, −100 to 100).", category: "people", unit: "points", frequency: "quarterly", direction: "higher_is_better", aggregation: "last", defaultTarget: 50, warnPct: 70, critPct: 40, assignments: [], series: [{ subject: { kind: "organization", key: null }, values: [22, 26, 31, 36] }] });

  // ----- scores (stage 5.2): personal objectives with recorded values, and finished tasks with outcomes, for most people, so the
  // demo company has real scorecards. Drawn from its OWN random stream, after everything above, so nothing earlier changes. Some
  // people are left with gaps on purpose (no personal objective, too few tasks) so the "missing" and "not enough data" chips show. -----
  {
    const sr = rng(`scores:${seed}`);
    const spick = <T,>(xs: readonly T[]): T => xs[Math.floor(sr() * xs.length)]!;
    const sbetween = (lo: number, hi: number): number => lo + Math.floor(sr() * (hi - lo + 1));
    const quarterStart = (d: string): string => `${d.slice(0, 4)}-${String(Math.floor((Number(d.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
    const q0 = quarterStart(today);
    const prevEnd = addDays(q0, -1);
    const prevStart = quarterStart(prevEnd);
    const off = (d: string): number => daysBetween(today, d);
    const GOALS: Record<string, string[]> = {
      eng: ["Raise the quality of my releases", "Cut my review turnaround", "Own a reliability improvement"],
      pd: ["Ship the research-backed improvements I own", "Raise the quality of my design reviews"],
      sales: ["Hit my pipeline and conversion goals", "Grow my accounts"],
      cs: ["Keep my customers happy and answered fast", "Improve my first-contact resolution"],
      ops: ["Keep my area calm and on time", "Close my month-end tasks early"],
      exec: ["Keep the leadership agenda on track"],
    };
    const unitOf = ["items", "points", "reviews", "accounts"];
    const teamObj = new Map(objectives.filter((o) => o.teamKey && o.level === "team").map((o) => [o.teamKey!, o]));
    const deptObj = new Map(objectives.filter((o) => o.level === "department" && o.lifecycle === "active").map((o) => [o.deptKey!, o]));
    const personal = people.filter((p) => p.key !== ceo.key && sr() < 0.82);
    for (const person of personal) {
      const f = 0.4 + sr() * 0.7; // how well this person is doing: 40 % to 110 % of target
      const targets = [sbetween(10, 30), sbetween(4, 12)];
      const marks = [off(prevStart) + sbetween(25, 40), off(prevEnd) - sbetween(2, 8), -sbetween(2, 9)].map((d) => Math.min(-1, d));
      const gap = sr() < 0.15; // a second key result with nothing recorded: shown as "no data yet", never as zero
      const parent = (person.teamKey ? teamObj.get(person.teamKey) : undefined) ?? deptObj.get(person.deptKey);
      const o = obj({ level: "individual", deptKey: null, teamKey: null, ownerKey: person.key, title: spick(GOALS[person.deptKey] ?? GOALS.ops!), description: "A personal goal agreed in a one-to-one.", objectiveType: "operational", priority: "medium", startOffset: off(prevStart), endOffset: off(q0) + 89, lifecycle: "active", published: false, keyResults: targets.map((target, k) => kr(k === 0 ? `Goals completed (${spick(unitOf)})` : "Reviews passed first time", "increase", 0, target, null, person.key, k === 1 && gap ? [] : marks.map((d, j) => ({ dayOffset: d, value: Math.round(target * f * ((j + 1) / 3) * 10) / 10 })), 1)) });
      if (parent) {
        o.parentKey = parent.key;
        o.parentWeight = 1;
      }
    }
    // finished tasks, five due in the previous quarter and five in the current one, for a share of the team members; the rest keep a short list
    const reviewerOf = (p: DemoPerson): string | null => p.managerKey;
    for (const person of people.filter((p) => p.teamType === "member" && sr() < 0.8)) {
      const pool = TASK_POOL[person.deptKey] ?? TASK_POOL.ops!;
      const lateRate = 0.1 + sr() * 0.4;
      for (let i = 0; i < 10; i += 1) {
        const prev = i < 5;
        const lo = prev ? off(prevStart) : off(q0);
        const hi = prev ? off(prevEnd) : -1;
        const due = Math.min(-1, sbetween(Math.min(lo, hi), Math.max(lo, hi)));
        const late = sr() < lateRate;
        const completed = Math.min(-1, due + (late ? sbetween(1, 6) : -sbetween(0, 3)));
        const est = spick([120, 240, 480, 960]);
        const reviewer = reviewerOf(person);
        tasks.push({
          key: `t${tasks.length + 1}`, title: `${spick(pool)} (${prev ? "last" : "this"} quarter ${(i % 5) + 1})`, creatorKey: reviewer ?? person.key, assigneeKey: person.key, teamKey: person.teamKey,
          status: "completed", priority: sr() < 0.2 ? "high" : "medium", importance: sbetween(1, 5), progressPct: 100, dueOffset: due, createdOffset: completed - sbetween(4, 14), completedOffset: completed,
          estimatedMinutes: est, loggedMinutes: Math.round((est * sbetween(75, 130)) / 100 / 5) * 5, blockedReason: null, comment: null, objectiveKey: null, krIndex: null, dependsOnKey: null,
          outcome: { summary: spick(OUTCOMES), quality: reviewer && sr() < 0.85 ? sbetween(3, 5) : null, qualityBy: reviewer },
        });
      }
    }
  }

  // ----- mentorship (stage 5.5): each mentor has two or three mentees from their own department; one mentee has two mentors, and one
  // mentor logs far fewer sessions than the cadence asks for. Its own random stream, drawn after everything else. -----
  const mentorships: DemoMentorship[] = [];
  {
    const mr = rng(`mentorship:${seed}`);
    const mpick = <T,>(xs: readonly T[]): T => xs[Math.floor(mr() * xs.length)]!;
    const mbetween = (lo: number, hi: number): number => lo + Math.floor(mr() * (hi - lo + 1));
    const SESSIONS: { type: DemoMentorship["activities"][number]["type"]; summary: string }[] = [
      { type: "one_on_one", summary: "Weekly check-in: priorities, blockers and how the week went." },
      { type: "feedback", summary: "Went through recent work and gave specific feedback." },
      { type: "review", summary: "Reviewed a piece of work together before it shipped." },
      { type: "unblock", summary: "Helped get past a blocker with another team." },
      { type: "training", summary: "Walked through a technique the mentee wanted to learn." },
      { type: "goal_setting", summary: "Reviewed the development goal and agreed the next step." },
    ];
    const mentors = people.filter((p) => p.role === "r_mentor");
    const taken = new Set<string>();
    mentors.forEach((mentor, mi) => {
      // mentees with enough work on record to have scores in both quarters (a mentee with no data has no change to measure)
      const scored = new Set(objectives.filter((o) => o.level === "individual").map((o) => o.ownerKey).filter((k) => tasks.filter((t) => t.assigneeKey === k && t.status === "completed").length >= 10));
      const pool = people.filter((p) => p.deptKey === mentor.deptKey && p.key !== mentor.key && p.teamType === "member" && p.role === "r_employee" && !taken.has(p.key) && scored.has(p.key));
      const menteesOf = [...pool].sort(() => mr() - 0.5).slice(0, mbetween(3, 4));
      const sparse = mi === mentors.length - 1 && mentors.length > 1; // the last mentor logs little
      for (const mentee of menteesOf) {
        taken.add(mentee.key);
        const start = -mbetween(150, 230);
        const cadence = 14;
        const activities: DemoMentorship["activities"] = [];
        for (let d = start + mbetween(3, 10); d <= -2; d += cadence + mbetween(-3, 5)) {
          if (mr() < (sparse ? 0.18 : 0.88)) {
            const x = mpick(SESSIONS);
            activities.push({ dayOffset: d, type: x.type, minutes: mpick([30, 45, 60]), summary: x.summary });
          }
        }
        mentorships.push({ mentorKey: mentor.key, menteeKey: mentee.key, startOffset: start, cadenceDays: cadence, goals: "Grow in the role: take on harder work and get more independent.", activities });
      }
    });
    // one mentee also has a second mentor (the credit is shared)
    if (mentors.length > 1 && mentorships.length > 0) {
      const first = mentorships[0]!;
      const other = mentors.find((m) => m.key !== first.mentorKey);
      if (other) mentorships.push({ mentorKey: other.key, menteeKey: first.menteeKey, startOffset: first.startOffset + 40, cadenceDays: 21, goals: "A second perspective on design and review habits.", activities: [-70, -49, -28, -9].map((d, i) => ({ dayOffset: d, type: i % 2 === 0 ? "review" as const : "feedback" as const, minutes: 45, summary: SESSIONS[i % 2 === 0 ? 2 : 1]!.summary })) });
    }
  }

  return {
    departments: DEPARTMENTS,
    teams: TEAMS,
    roleFamilies: FAMILIES,
    designations: DESIGNATIONS,
    people,
    tasks,
    dailyUpdates,
    objectives,
    kpis,
    mentorships,
  };
}

/** A harmless login address that can never receive mail (`.invalid` is reserved), unique per organization. */
export const demoEmail = (name: string, orgId: string, index: number): string => `${slug(name)}.${index}.${orgId.slice(0, 6)}@demo.invalid`;

export const dayOf = (loadedOn: string, offset: number): string => addDays(loadedOn, offset);
