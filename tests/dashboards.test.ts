import { afterEach, describe, expect, it } from "vitest";
import type { TestApp } from "./helpers/app.js";
import { get, makeAuthApp, post, signUpWithOrg } from "./helpers/auth.js";
import { addPerson, roleIds } from "./helpers/roles.js";

let t: TestApp;
afterEach(() => t?.cleanup());
const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const created = async (path: string, body: Record<string, unknown>, cookie: string): Promise<string> => {
  const r = await post(t.app, path, body, cookie);
  expect(r.status, `${path} ${JSON.stringify(r.body)}`).toBe(201);
  return r.body.data.id as string;
};

/** Two teams (Core with Emma and an overdue task, Side with Sid), a company objective with a department objective under it. */
async function setup() {
  t = makeAuthApp();
  const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
  const ids = await roleIds(t.app, owner);
  const dept = await created("/api/departments", { name: "Engineering" }, owner);
  const core = await created("/api/teams", { name: "Core", departmentId: dept }, owner);
  const side = await created("/api/teams", { name: "Side", departmentId: dept }, owner);
  const emma = await addPerson(t.app, owner, "emma@example.com", ids.employee, "Emma Employee");
  const sid = await created("/api/employees", { name: "Sid Side", teamId: side }, owner);
  expect((await post(t.app, `/api/teams/${core}/members`, { membershipId: emma.membershipId }, owner)).status).toBe(201);
  const nobody = await addPerson(t.app, owner, "nobody@example.com", undefined, "No Role");
  const company = await created("/api/objectives", { level: "company", title: "Win customers", startDate: day(-100), endDate: day(100), lifecycle: "active", keyResults: [{ title: "Deals", targetValue: 10 }] }, owner);
  const kr = (t.db.prepare("SELECT id FROM key_results WHERE objective_id = ?").get(company) as { id: string }).id;
  await post(t.app, `/api/key-results/${kr}/progress`, { value: 1 }, owner); // far behind pace
  const teamObj = await created("/api/objectives", { level: "team", teamId: core, title: "Core ships", startDate: day(-100), endDate: day(100), lifecycle: "active", keyResults: [{ title: "Releases", targetValue: 10 }] }, owner);
  await created("/api/tasks", { title: "Late thing", assigneeIds: [emma.membershipId], dueAt: day(-3) }, owner);
  return { owner, emma, nobody, core, side, sid, company, teamObj };
}

describe("Team Performance (batch G)", () => {
  it("the owner sees a card per team with members, team objectives with health and task progress", async () => {
    const { owner, core } = await setup();
    const r = await get(t.app, "/api/team-performance", owner);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const names = r.body.data.teams.map((x: { name: string }) => x.name);
    expect(names).toEqual(["Core", "Side"]);
    const c = r.body.data.teams.find((x: { id: string }) => x.id === core);
    expect(c.objectives.map((o: { title: string }) => o.title)).toEqual(["Core ships"]);
    expect(c.objectives[0]).toMatchObject({ dataState: expect.any(String), health: expect.any(String) });
    expect(c.tasks).toMatchObject({ open: expect.any(Number), overdue: expect.any(Number) });
    expect(c.kpis).toMatchObject({ series: 0, missingPeriods: 0 }); // no KPI: zero series, not an error
  });
  it("an employee sees only their own team (and no other team's name or people); a person with no role sees no teams", async () => {
    const { emma, nobody, sid } = await setup();
    const r = await get(t.app, "/api/team-performance", emma.cookie);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toMatch(/Side|Sid Side/);
    expect(r.body.data.teams.map((x: { name: string }) => x.name)).toEqual(["Core"]);
    expect((await get(t.app, "/api/team-performance", nobody.cookie)).body.data.teams).toEqual([]); // nobody without a role sees no team
    void sid;
  });
  it("an empty organization says there are no teams (an empty list, not an error)", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "o@example.com", "Empty");
    expect((await get(t.app, "/api/team-performance", owner)).body.data.teams).toEqual([]);
  });
});

describe("Leadership (batch G)", () => {
  it("shows company objectives with health, attainment and risks; an employee is refused", async () => {
    const { owner, emma } = await setup();
    const r = await get(t.app, "/api/leadership/overview", owner);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const o = r.body.data.objectives.find((x: { title: string }) => x.title === "Win customers");
    expect(o).toMatchObject({ attainmentPct: 10 });
    expect(["at_risk", "delayed"]).toContain(o.health);
    expect(r.body.data.risks.some((x: { title: string; kind: string }) => x.title === "Win customers" && x.kind === "behind_pace")).toBe(true);
    expect((await get(t.app, "/api/leadership/overview", emma.cookie)).status).toBe(403);
  });
  it("a department objective linked to the company one is listed as its contributor", async () => {
    const { owner, company } = await setup();
    const dept = (t.db.prepare("SELECT id FROM departments LIMIT 1").get() as { id: string }).id;
    const d = await created("/api/objectives", { level: "department", departmentId: dept, title: "Engineering delivers", startDate: day(-100), endDate: day(100), lifecycle: "active", keyResults: [{ title: "R", targetValue: 10 }] }, owner);
    const link = await (await import("supertest")).default(t.app).put(`/api/objectives/${d}/parent`).set("Origin", "https://zentro.test").set("Cookie", owner).send({ parentId: company, weight: 1 });
    expect(link.status, JSON.stringify(link.body)).toBe(200);
    const r = await get(t.app, "/api/leadership/overview", owner);
    const o = r.body.data.objectives.find((x: { id: string }) => x.id === company);
    expect(o.contributors.map((c: { title: string }) => c.title)).toContain("Engineering delivers");
  });
});

describe("Insights from your data (batch G)", () => {
  it("lists rule-based insights with their numbers and links, calls no AI, and the Ask box is disabled", async () => {
    const { owner } = await setup();
    const r = await get(t.app, "/api/ai/insights", owner);
    expect(r.status).toBe(200);
    const keys = r.body.data.insights.map((i: { key: string }) => i.key);
    expect(keys).toContain("behind_pace");
    expect(keys).toContain("overdue_tasks");
    const behind = r.body.data.insights.find((i: { key: string }) => i.key === "behind_pace");
    expect(behind.items[0].detail).toMatch(/\d+% done, \d+% of the time has passed/);
    expect(behind.items[0].to).toMatch(/^\/okrs\?objective=/);
    expect(r.body.data.ask).toMatchObject({ enabled: false });
    expect(r.body.data.ask.reason).toMatch(/AI provider has to be connected/);
  });
  it("an employee's insights only reflect what they may see; a person with no role is refused; an empty organization has no insights", async () => {
    const { emma, nobody } = await setup();
    const r = await get(t.app, "/api/ai/insights", emma.cookie);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toMatch(/Sid Side/);
    expect((await get(t.app, "/api/ai/insights", nobody.cookie)).status).toBe(403);
    t.cleanup();
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "o@example.com", "Empty");
    expect((await get(t.app, "/api/ai/insights", owner)).body.data.insights).toEqual([]);
  });
});

describe("Integrations status (batch G)", () => {
  it("says Not connected, lists the events with counts, and never shows a value of a setting", async () => {
    const { owner, emma } = await setup();
    process.env.VIASOCKET_ORG_ID = "sentinel-secret-value-123";
    try {
      const r = await get(t.app, "/api/integrations/status", owner);
      expect(r.status).toBe(200);
      expect(r.body.data.viaSocket).toMatchObject({ connected: false, status: "Not connected" });
      expect(r.body.data.viaSocket.settings.find((s: { name: string }) => s.name === "VIASOCKET_ORG_ID").set).toBe(true);
      expect(r.body.data.viaSocket.settings.find((s: { name: string }) => s.name === "VIASOCKET_EMBED_SECRET").set).toBe(false);
      expect(JSON.stringify(r.body)).not.toContain("sentinel-secret-value-123");
      const types = r.body.data.events.map((e: { type: string }) => e.type);
      expect(types).toEqual(expect.arrayContaining(["task.created", "objective.at_risk", "review.submitted", "period.closed"]));
      expect(r.body.data.events.find((e: { type: string }) => e.type === "task.created")).toMatchObject({ status: "recorded", last30Days: expect.any(Number) });
      expect(r.body.data.events.find((e: { type: string }) => e.type === "period.closed")).toMatchObject({ status: "planned", last30Days: null });
      expect((await get(t.app, "/api/integrations/status", emma.cookie)).status).toBe(403);
    } finally {
      delete process.env.VIASOCKET_ORG_ID;
    }
  });
});

describe("with the demo company (batch G)", () => {
  it("the four pages have real content, and Remove demo data still works (nothing new is stored)", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    expect((await post(t.app, "/api/demo/load", undefined, owner)).status).toBe(201);
    const teams = (await get(t.app, "/api/team-performance", owner)).body.data.teams as { objectives: unknown[] | null; tasks: { open: number } | null; memberCount: number }[];
    expect(teams.length).toBeGreaterThanOrEqual(10);
    expect(teams.every((x) => x.memberCount > 0)).toBe(true);
    expect(teams.some((x) => (x.objectives?.length ?? 0) > 0)).toBe(true);
    expect(teams.some((x) => (x.tasks?.open ?? 0) > 0)).toBe(true);
    const lead = (await get(t.app, "/api/leadership/overview", owner)).body.data;
    expect(lead.objectives.length).toBeGreaterThanOrEqual(3);
    expect(lead.objectives.some((o: { contributors: unknown[] }) => o.contributors.length > 0)).toBe(true);
    expect(lead.kpis.series).toBeGreaterThan(5);
    const ins = (await get(t.app, "/api/ai/insights", owner)).body.data.insights as { key: string }[];
    expect(ins.length).toBeGreaterThanOrEqual(2);
    expect((await get(t.app, "/api/integrations/status", owner)).body.data.events.some((e: { last30Days: number | null }) => (e.last30Days ?? 0) > 0)).toBe(true);
    expect((await post(t.app, "/api/demo/remove", undefined, owner)).status).toBe(200);
    expect((await get(t.app, "/api/team-performance", owner)).body.data.teams).toEqual([]);
    expect((await get(t.app, "/api/ai/insights", owner)).body.data.insights).toEqual([]);
  });
});

describe("full Team Performance and Leadership with the demo company (batch H)", () => {
  async function demo() {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    expect((await post(t.app, "/api/demo/load", undefined, owner)).status).toBe(201);
    return owner;
  }
  it("Team Performance: member scores with explainability ids, a team average with its sample size, a comparison inside a department, and a mentoring summary", async () => {
    const owner = await demo();
    const r = (await get(t.app, "/api/team-performance", owner)).body.data;
    expect(r.period).toMatchObject({ status: "open" });
    expect(r.periods.length).toBe(2);
    const platform = r.teams.find((x: { name: string }) => x.name.includes("Platform")) ?? r.teams[0];
    const scored = platform.members.filter((m: { score: { total: number | null } | null }) => m.score && m.score.total !== null);
    expect(scored.length).toBeGreaterThan(0);
    expect(scored[0].score).toMatchObject({ scoreId: expect.any(String), scorecardId: expect.any(String), confidenceLabel: expect.any(String) });
    expect(platform.average).toMatchObject({ n: expect.any(Number), of: platform.memberCount });
    const withAvg = r.teams.filter((x: { average: unknown }) => x.average !== null);
    expect(withAvg.length).toBeGreaterThan(3);
    const small = r.teams.find((x: { average: { n: number } | null }) => x.average && x.average.n < 3);
    if (small) expect(small.average.note).toMatch(/only \d+ of|Based on/);
    expect(r.comparisons.length).toBeGreaterThan(0);
    for (const c of r.comparisons) {
      expect(c.note.length).toBeGreaterThan(20);
      for (const x of c.teams) expect(x.eligible).toBe(x.n >= 3); // never ranked on fewer than 3 people
      expect(c.teams.filter((x: { rank: number | null }) => x.rank !== null).every((x: { eligible: boolean }) => x.eligible)).toBe(true);
    }
    expect(r.teams.some((x: { mentoring: { pairs: number } | null }) => (x.mentoring?.pairs ?? 0) > 0)).toBe(true);
    const m = r.teams.find((x: { mentoring: { pairs: number } | null }) => (x.mentoring?.pairs ?? 0) > 0).mentoring;
    expect(m.caveat).toMatch(/many causes/);
    // the closed period can be chosen too
    const closed = r.periods.find((p: { status: string }) => p.status === "closed");
    expect((await get(t.app, `/api/team-performance?periodId=${closed.id}`, owner)).body.data.period.id).toBe(closed.id);
    expect((await get(t.app, "/api/team-performance?periodId=nope", owner)).status).toBe(400);
  });
  it("a team lead sees only their own team's scores; nobody's private review note ever appears", async () => {
    const owner = await demo();
    const ps = (await get(t.app, "/api/demo/personas", owner)).body.data as { id: string; designation: string; roles: string[] }[];
    const emp = ps.find((p) => p.roles.includes("Employee") && p.designation === "Software Engineer")!;
    const asEmp = await post(t.app, `/api/demo/view-as/${emp.id}`, undefined, owner);
    const cookies = ([] as string[]).concat((asEmp.headers["set-cookie"] as unknown as string[]) ?? []).map((c) => c.split(";")[0]).filter((c) => /^zentro_(admin_)?session=/.test(c)).join("; ");
    const r = await get(t.app, "/api/team-performance", cookies);
    expect(r.status).toBe(200);
    expect(r.body.data.teams.length).toBe(1);
    const mine = r.body.data.teams[0];
    expect(mine.members.every((m: { score: { total: number | null } | null; id: string }) => m.id === emp.id || m.score === null)).toBe(true); // a teammate's score is not theirs to read
    expect(r.body.data.comparisons).toEqual([]);
    expect(JSON.stringify(r.body)).not.toMatch(/privateNotes|Not for sharing|Candid note|stretch assignment/);
  });
  it("Leadership: a range (preset or custom), trends for company objectives, executive KPIs with six periods, drill-down to people, grouped risks and a summary", async () => {
    const owner = await demo();
    const r = (await get(t.app, "/api/leadership/overview?range=180d", owner)).body.data;
    expect(r.range).toMatchObject({ preset: "180d", days: 180 });
    expect(r.objectives[0].trend).toHaveLength(6);
    expect(r.objectives.some((o: { trend: { value: number | null }[] }) => o.trend.some((p) => p.value !== null))).toBe(true);
    expect(r.objectives[0].trend.every((p: { value: number | null }) => p.value === null || (p.value >= 0 && p.value <= 100))).toBe(true); // a missing value is null, never 0
    expect(r.executiveKpis.length).toBeGreaterThan(0);
    expect(r.executiveKpis[0].trend.length).toBeLessThanOrEqual(6);
    expect(r.departments.length).toBeGreaterThanOrEqual(5);
    const team = r.departments.flatMap((d: { teams: unknown[] }) => d.teams).find((x: { members: unknown[] }) => x.members.length > 0);
    expect(team.members[0]).toHaveProperty("score");
    expect(r.groupedRisks.some((g: { level: string; count: number }) => g.level === "individual" && g.count >= 1)).toBe(true);
    expect(r.risks.every((x: { level: string }) => x.level !== "individual")).toBe(true); // personal ones are grouped, not repeated
    expect(r.summary.length).toBeGreaterThanOrEqual(3);
    expect(r.summary.join(" ")).toMatch(/company objectives? (is|are) active/);
    expect(r.summary.join(" ")).toMatch(/\d+% done with \d+% of the time passed/);
    const custom = (await get(t.app, `/api/leadership/overview?from=${day(-30)}&to=${day(0)}`, owner)).body.data;
    expect(custom.range).toMatchObject({ preset: "custom", days: 30 });
    expect((await get(t.app, `/api/leadership/overview?from=${day(0)}&to=${day(-5)}`, owner)).status).toBe(400);
    expect((await get(t.app, "/api/leadership/overview?range=7d", owner)).status).toBe(400);
  });
  it("Leadership with no data says so in the summary instead of inventing anything", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "o@example.com", "Empty");
    const r = (await get(t.app, "/api/leadership/overview", owner)).body.data;
    expect(r.objectives).toEqual([]);
    expect(r.summary[0]).toBe("There is no active company objective yet.");
    expect(r.departments).toEqual([]);
  });
});
