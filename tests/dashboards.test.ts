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
