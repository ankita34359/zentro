import { addDays } from "../tasks/dates.js";

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
}
export interface DemoDailyUpdate { personKey: string; dayOffset: number; summary: string; blockers: string | null }
export interface DemoCompany {
  departments: DemoDepartment[];
  teams: DemoTeam[];
  roleFamilies: { key: string; name: string }[];
  designations: { name: string; familyKey: string }[];
  people: DemoPerson[];
  tasks: DemoTask[];
  dailyUpdates: DemoDailyUpdate[];
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
export function buildDemoCompany(seed: string): DemoCompany {
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
        comment: rand() < 0.22 ? { authorKey: (rand() < 0.6 ? lead : person).key === person.key && person.managerKey ? person.managerKey : lead.key, body: pick(COMMENTS) } : null,
      });
    }
  }

  const dailyUpdates: DemoDailyUpdate[] = [];
  for (const person of people) {
    if (rand() < 0.4) dailyUpdates.push({ personKey: person.key, dayOffset: 0, summary: pick(SUMMARIES), blockers: rand() < 0.2 ? pick(BLOCKS) : null });
    if (rand() < 0.4) dailyUpdates.push({ personKey: person.key, dayOffset: -1, summary: pick(SUMMARIES), blockers: rand() < 0.15 ? pick(BLOCKS) : null });
  }

  return {
    departments: DEPARTMENTS,
    teams: TEAMS,
    roleFamilies: FAMILIES,
    designations: DESIGNATIONS,
    people,
    tasks,
    dailyUpdates,
  };
}

/** A harmless login address that can never receive mail (`.invalid` is reserved), unique per organization. */
export const demoEmail = (name: string, orgId: string, index: number): string => `${slug(name)}.${index}.${orgId.slice(0, 6)}@demo.invalid`;

export const dayOf = (loadedOn: string, offset: number): string => addDays(loadedOn, offset);
