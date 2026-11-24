// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { envelope, HEALTH_OK, json, ME_READY, renderApp, setMe, stubFetch, stubMatchMedia } from "./helpers";

beforeEach(() => stubMatchMedia(false));
const withCaps = (caps: Record<string, string[]>) => ({ ...ME_READY, roles: [{ key: "x", name: "Some Role" }], capabilities: caps });
const serve = (routes: Record<string, unknown>) =>
  stubFetch((url) => {
    const path = url.split("?")[0]!;
    if (path in routes) return envelope(routes[path]);
    if (path === "/api/notifications") return envelope({ notifications: [], unreadCount: 0, nextCursor: null });
    return json(HEALTH_OK);
  });

const score = (total: number | null, status = "provisional") => ({ total, status, confidence: 0.5, confidenceLabel: "medium", scoreId: "s1", scorecardId: "c1" });
const team = (over: Record<string, unknown> = {}) => ({ id: "t1", name: "Core", department: "Engineering", memberCount: 3, members: [{ id: "a", name: "Ann", role: "lead", score: score(80) }], hiddenMembers: 2, average: { value: 80, n: 1, of: 3, note: "Based on only 1 of 3 people: read it with care." }, mentoring: { pairs: 2, activePairs: 2, sessions: 7, menteesMeasured: 1, averageImprovement: 62.5, caveat: "Mentee results have many causes." }, objectives: [{ id: "o1", title: "Core ships", health: "at_risk", attainmentPct: 20, elapsedPct: 50, dataState: "ok" }], kpis: { series: 2, byStatus: { critical: 1, ok: 1 }, missingPeriods: 1, items: [{ kpiId: "k1", name: "Leads", subject: "The team", status: "critical", missing: 1 }] }, tasks: { open: 5, overdue: 2, done: 7, blocked: 1 }, ...over });

describe("Team Performance (stage 6.2)", () => {
  it("member scores with how they were calculated, the team average with its sample size, objectives and their health, KPIs, tasks, mentoring and the fair comparison", async () => {
    setMe(withCaps({ "org.view": ["my_teams"] }));
    serve({ "/api/team-performance": { today: "2026-11-24", period: { id: "p1", name: "Q4 2026", status: "open" }, periods: [{ id: "p1", name: "Q4 2026", status: "open" }], comparisons: [{ department: "Engineering", note: "Not enough data to compare: a team needs at least 3 people with a score you can see, and at least 2 such teams.", teams: [{ id: "t1", name: "Core", average: 80, n: 1, eligible: false, rank: null }, { id: "t2", name: "Infra", average: null, n: 0, eligible: false, rank: null }] }], teams: [team()] } });
    renderApp("/team-performance");
    const teams = await screen.findByRole("list", { name: "Teams" });
    expect(screen.queryByText("Early version")).toBeNull();
    expect(within(teams).getByText("Ann (lead)")).toBeTruthy();
    expect(within(teams).getByRole("link", { name: "How Ann's score was calculated" }).getAttribute("href")).toBe("/performance?period=p1&person=a");
    expect(within(teams).getByText(/2 more people in this team you may not see by name/)).toBeTruthy();
    expect(within(teams).getByLabelText("Team average of Core").textContent).toMatch(/80\.0 from 1 of 3 people/);
    expect(within(teams).getByText(/Based on only 1 of 3 people/)).toBeTruthy();
    expect(within(teams).getByText("Core ships")).toBeTruthy();
    expect(within(teams).getByText("At risk")).toBeTruthy();
    expect(within(teams).getByText(/2 series: 1 critical, 1 ok; 1 missing/)).toBeTruthy();
    expect(within(teams).getByText(/5 open/)).toBeTruthy();
    expect(within(teams).getByText(/2 pairs \(2 active\) · 7 sessions logged · mentees' improvement 62\.5/)).toBeTruthy();
    expect(within(teams).getByText(/Mentee results have many causes/)).toBeTruthy();
    const cmp = screen.getByRole("region", { name: "Team comparison" });
    expect(within(cmp).getAllByText("Too few people to rank").length).toBe(2);
    expect(within(cmp).getByText("Not scored")).toBeTruthy(); // a team with no score is not a zero
    expect(within(cmp).getByText(/Not enough data to compare/)).toBeTruthy();
  });
  it("a section the person may not see says so; a person who may not see a score sees 'No score you can see'; no team shows the empty state", async () => {
    setMe(withCaps({ "org.view": ["my_teams"] }));
    serve({ "/api/team-performance": { today: "x", period: null, periods: [], comparisons: [], teams: [team({ memberCount: 1, members: [{ id: "a", name: "Ann", role: "member", score: null }], hiddenMembers: 0, average: null, mentoring: null, objectives: null, kpis: null, tasks: null })] } });
    renderApp("/team-performance");
    expect(await screen.findByText("You do not have access to objectives.")).toBeTruthy();
    expect(screen.getByText("You do not have access to KPIs.")).toBeTruthy();
    expect(screen.getByText("You do not have access to tasks.")).toBeTruthy();
    expect(screen.getByText("No score you can see")).toBeTruthy();
    expect(screen.getByText("Team average: no score you can see yet.")).toBeTruthy();
    expect(screen.queryByText("Mentoring")).toBeNull();
  });
  it("an empty list shows the empty state", async () => {
    setMe(withCaps({}));
    serve({ "/api/team-performance": { today: "x", period: null, periods: [], comparisons: [], teams: [] } });
    renderApp("/team-performance");
    expect(await screen.findByText("No team data in your scope yet")).toBeTruthy();
  });
});

const LEAD = { today: "2026-11-24", range: { preset: "90d", from: "2026-08-26", to: "2026-11-24", days: 90 }, period: { id: "p1", name: "Q4 2026", status: "open" }, summary: ["1 company objective is active; 1 is behind pace (Win customers: 10% done with 50% of the time passed).", "Over the last 90 days: Win customers rose 5 points."], executiveKpis: [{ kpiId: "k9", name: "Annual recurring revenue", unit: "$M", status: "warning", label: "Oct: 10.4 $M", target: 12, missing: 1, trend: [{ date: "2026-08-01", value: 8.3 }, { date: "2026-09-01", value: null }, { date: "2026-10-01", value: 10.4 }], change: 2.1 }], departments: [{ id: "d1", name: "Engineering", people: 4, average: 77.5, n: 2, objectives: [], teams: [{ id: "t1", name: "Core", people: 2, average: 80, n: 1, objectives: [], members: [{ id: "a", name: "Ann", score: score(80) }, { id: "b", name: "Bob", score: null }] }] }], groupedRisks: [{ kind: "behind_pace", level: "individual", count: 12, items: [{ id: "i1", title: "Raise quality", reason: "20% against 60%" }] }], objectives: [{ id: "c1", title: "Win customers", health: "delayed", attainmentPct: 10, elapsedPct: 50, dataState: "ok", owner: "Cleo", trend: [{ date: "2026-08-26", value: 5 }, { date: "2026-10-01", value: null }, { date: "2026-11-24", value: 10 }], change: 5, contributors: [{ id: "d1", title: "Engineering delivers", level: "department", department: "Engineering", owner: "Vic", health: "on_track", attainmentPct: 60, contributionPct: 30 }] }], risks: [{ id: "c1", title: "Win customers", level: "company", reason: "10% against 50%", kind: "behind_pace" }], kpis: { series: 3, byStatus: { critical: 1, ok: 2 }, missingPeriods: 0, attention: [] } };
describe("Leadership (stages 6.4 and 6.5)", () => {
  it("summary, trend with gaps and a change, executive KPIs, contributors, drill-down to people, grouped personal risks and KPI health", async () => {
    setMe(withCaps({ "leadership.view": ["all_in_scope"] }));
    serve({ "/api/leadership/overview": LEAD });
    renderApp("/leadership");
    const summary = await screen.findByRole("region", { name: "Summary" });
    expect(within(summary).getByText(/behind pace \(Win customers: 10% done with 50% of the time passed\)/)).toBeTruthy();
    expect(screen.queryByText("Early version")).toBeNull();
    const trend = screen.getByRole("img", { name: /Win customers, progress over the range.*no data/ });
    expect(trend).toBeTruthy(); // the gap is in words, not a zero
    expect(screen.getByText(/Change over the range: \+5 points/)).toBeTruthy();
    const kpis = screen.getByRole("region", { name: "Executive KPIs" });
    expect(within(kpis).getByText("Annual recurring revenue")).toBeTruthy();
    expect(within(kpis).getByText(/Oct: 10\.4 \$M · target 12 \$M · warning · 1 missing/)).toBeTruthy();
    expect(within(screen.getByText("Who contributes").parentElement!).getByText(/adds 30 points/)).toBeTruthy();
    const drill = screen.getByRole("region", { name: "Drill-down" });
    expect(within(drill).getByText(/Engineering/)).toBeTruthy();
    expect(within(drill).getByText(/average 77\.5 \(from 2\)/)).toBeTruthy();
    expect(within(drill).getByText("no score you can see")).toBeTruthy();
    expect(within(drill).getAllByRole("link", { name: "How was this calculated?" })[0]!.getAttribute("href")).toBe("/performance?period=p1&person=a");
    const risks = screen.getByRole("region", { name: "Risks" });
    expect(within(risks).getByText(/12 personal objectives/)).toBeTruthy(); // grouped, not twelve rows
    expect(within(risks).getAllByText("Behind pace").length).toBe(2); // the company one, and the personal ones as one line
    expect(screen.getByText(/3 series: 1 critical, 2 ok/)).toBeTruthy();
  });
  it("changing the range asks for it; a custom range needs both dates", async () => {
    setMe(withCaps({ "leadership.view": ["all_in_scope"] }));
    const f = serve({ "/api/leadership/overview": LEAD });
    renderApp("/leadership");
    await screen.findByRole("region", { name: "Summary" });
    await userEvent.selectOptions(screen.getByLabelText("Show the last"), "365d");
    await waitFor(() => expect(f.mock.calls.some((c) => c[0] === "/api/leadership/overview?range=365d")).toBe(true));
    await userEvent.selectOptions(screen.getByLabelText("Show the last"), "custom");
    expect(await screen.findByText("Choose both dates.")).toBeTruthy();
  });
  it("without leadership.view the page is refused", async () => {
    setMe(withCaps({}));
    serve({});
    renderApp("/leadership");
    expect(await screen.findByText("You do not have access to this page")).toBeTruthy();
  });
});

describe("AI Intelligence insights (batch G)", () => {
  it("lists insights with numbers and links, and the Ask AI box is disabled and says why", async () => {
    setMe(withCaps({ "ai.view_insights": ["own"] }));
    serve({ "/api/ai/insights": { today: "x", ask: { enabled: false, reason: "An AI provider has to be connected first. Nothing on this page was written by an AI." }, note: "These insights are plain rules.", insights: [{ key: "behind_pace", severity: "attention", count: 8, title: "2 objectives are behind pace", summary: "Progress is behind.", to: "/okrs?health=at_risk", items: [{ label: "Win customers", detail: "10% done, 50% of the time has passed (at risk)", to: "/okrs?objective=o1" }] }] } });
    renderApp("/ai");
    const list = await screen.findByRole("list", { name: "Insights" });
    expect(within(list).getByText("2 objectives are behind pace")).toBeTruthy();
    expect(within(list).getByText("Win customers").getAttribute("href")).toBe("/okrs?objective=o1");
    expect(within(list).getByText(/10% done, 50% of the time has passed/)).toBeTruthy();
    expect(within(list).getByText(/And 7 more/)).toBeTruthy();
    const ask = screen.getByRole("group", { name: "Ask AI" });
    expect((within(ask).getByRole("textbox") as HTMLInputElement).disabled).toBe(true);
    expect(within(ask).getByText(/AI provider has to be connected first/)).toBeTruthy();
    expect(screen.getByText("Early version")).toBeTruthy();
  });
  it("nothing to flag shows a calm empty state", async () => {
    setMe(withCaps({ "ai.view_insights": ["own"] }));
    serve({ "/api/ai/insights": { today: "x", ask: { enabled: false, reason: "r" }, note: "n", insights: [] } });
    renderApp("/ai");
    expect(await screen.findByText("Nothing needs attention right now")).toBeTruthy();
  });
});

describe("Integrations (batch G)", () => {
  it("shows Not connected, which settings are set (names only), the steps and the events with their status", async () => {
    setMe(withCaps({ "integrations.view": ["all_in_scope"] }));
    serve({ "/api/integrations/status": { viaSocket: { connected: false, status: "Not connected", settings: [{ name: "VIASOCKET_ORG_ID", set: true }, { name: "VIASOCKET_EMBED_SECRET", set: false }] }, steps: ["Create a viaSocket project."], note: "Nothing is sent yet.", events: [{ type: "task.created", description: "A task was created.", status: "recorded", last30Days: 12 }, { type: "period.closed", description: "A period was closed.", status: "planned", last30Days: null }] } });
    renderApp("/integrations");
    expect(await screen.findByText("Not connected")).toBeTruthy();
    const settings = screen.getByRole("list", { name: "Settings" });
    expect(within(settings).getByText("is set")).toBeTruthy();
    expect(within(settings).getByText("is not set")).toBeTruthy();
    expect(screen.getByText("Create a viaSocket project.")).toBeTruthy();
    const table = screen.getByRole("table", { name: "Events" });
    expect(within(table).getByText("Recorded")).toBeTruthy();
    expect(within(table).getByText("Planned")).toBeTruthy();
    expect(within(table).getByText("12")).toBeTruthy();
    expect(screen.getByText("Early version")).toBeTruthy();
  });
  it("without integrations.view the page is refused", async () => {
    setMe(withCaps({}));
    serve({});
    renderApp("/integrations");
    expect(await screen.findByText("You do not have access to this page")).toBeTruthy();
  });
});
