// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
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

describe("Team Performance (batch G)", () => {
  it("shows a card per team with members, objectives and their health, KPIs and task progress, marked as an early version", async () => {
    setMe(withCaps({ "org.view": ["my_teams"] }));
    serve({ "/api/team-performance": { today: "2026-11-24", teams: [{ id: "t1", name: "Core", department: "Engineering", memberCount: 3, members: [{ id: "a", name: "Ann", role: "lead" }], hiddenMembers: 2, objectives: [{ id: "o1", title: "Core ships", health: "at_risk", attainmentPct: 20, elapsedPct: 50, dataState: "ok" }], kpis: { series: 2, byStatus: { critical: 1, ok: 1 }, missingPeriods: 1, items: [{ kpiId: "k1", name: "Leads", subject: "The team", status: "critical", missing: 1 }] }, tasks: { open: 5, overdue: 2, done: 7, blocked: 1 } }] } });
    renderApp("/team-performance");
    const teams = await screen.findByRole("list", { name: "Teams" });
    expect(screen.getByText("Early version")).toBeTruthy();
    expect(within(teams).getByText("Core")).toBeTruthy();
    expect(within(teams).getByText(/Ann \(lead\) and 2 more you may not see by name/)).toBeTruthy();
    expect(within(teams).getByText("Core ships")).toBeTruthy();
    expect(within(teams).getByText("At risk")).toBeTruthy();
    expect(within(teams).getByText(/2 series: 1 critical, 1 ok; 1 missing/)).toBeTruthy();
    expect(within(teams).getByText(/5 open/)).toBeTruthy();
  });
  it("a section the person may not see says so; no team says 'No team data in your scope yet'", async () => {
    setMe(withCaps({ "org.view": ["my_teams"] }));
    serve({ "/api/team-performance": { today: "x", teams: [{ id: "t1", name: "Core", department: null, memberCount: 0, members: [], hiddenMembers: 0, objectives: null, kpis: null, tasks: null }] } });
    renderApp("/team-performance");
    expect(await screen.findByText("You do not have access to objectives.")).toBeTruthy();
    expect(screen.getByText("You do not have access to KPIs.")).toBeTruthy();
    expect(screen.getByText("You do not have access to tasks.")).toBeTruthy();
  });
  it("an empty list shows the empty state", async () => {
    setMe(withCaps({}));
    serve({ "/api/team-performance": { today: "x", teams: [] } });
    renderApp("/team-performance");
    expect(await screen.findByText("No team data in your scope yet")).toBeTruthy();
  });
});

describe("Leadership (batch G)", () => {
  it("shows company objectives with who contributes, risks and KPI health; a person without leadership.view is told so", async () => {
    setMe(withCaps({ "leadership.view": ["all_in_scope"] }));
    serve({ "/api/leadership/overview": { today: "x", objectives: [{ id: "c1", title: "Win customers", health: "delayed", attainmentPct: 10, elapsedPct: 50, dataState: "ok", owner: "Cleo", contributors: [{ id: "d1", title: "Engineering delivers", level: "department", department: "Engineering", owner: "Vic", health: "on_track", attainmentPct: 60, contributionPct: 30 }] }], risks: [{ id: "c1", title: "Win customers", level: "company", reason: "10% against 50%", kind: "behind_pace" }], kpis: { series: 3, byStatus: { critical: 1, ok: 2 }, missingPeriods: 0, attention: [] } } });
    renderApp("/leadership");
    expect((await screen.findAllByText("Win customers")).length).toBe(2); // the objective and its risk line
    const who = screen.getByText("Who contributes").parentElement!;
    expect(within(who).getByText("Engineering")).toBeTruthy();
    expect(within(who).getByText(/adds 30 points/)).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Risks" })).getByText("Behind pace")).toBeTruthy();
    expect(screen.getByText(/3 series: 1 critical, 2 ok/)).toBeTruthy();
    expect(screen.getByText("Early version")).toBeTruthy();
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
