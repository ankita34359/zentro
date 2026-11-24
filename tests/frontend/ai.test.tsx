// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { envelope, HEALTH_OK, json, ME_READY, renderApp, setMe, stubFetch, stubMatchMedia } from "./helpers";

beforeEach(() => stubMatchMedia(false));
const withCaps = (caps: Record<string, string[]>) => ({ ...ME_READY, roles: [{ key: "x", name: "Some Role" }], capabilities: caps });
const STATUS = (over: Record<string, unknown> = {}) => ({
  connected: true, reason: null, keyConfigured: true, enabledForOrganization: true, canUse: true, canConfigure: false,
  limits: { perUserPerDay: 20, perOrganizationPerDay: 200, maxQuestionChars: 400 }, usedToday: { you: 2, organization: 5 }, ...over,
});
const ANSWER = {
  aiGenerated: true, answer: "The Acme objective has no data yet [O1]. About 73% are happy.", basedOn: "AI-generated. Based only on the records listed below; it can be wrong, so check the records.", model: "m",
  citations: [{ ref: "O1", type: "objective", id: "o1", label: "Grow the Acme base", to: "/okrs?objective=o1" }], unmatchedNumbers: ["73"],
  sent: { instructions: "Use ONLY the records", records: "[O1] Grow the Acme base: progress no data", question: "How is Acme?", recordList: [{ ref: "O1", type: "objective", id: "o1", label: "Grow the Acme base" }], characters: 1234, neverSent: ["private review notes", "restricted evidence"] },
  usedToday: { you: 3, organization: 6 },
};
const INSIGHTS = { today: "2026-11-24", insights: [], ask: { enabled: false, reason: "r" }, note: "Plain rules." };
const server = (status: unknown, extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined) =>
  stubFetch((url, init) => {
    const e = extra(url, init);
    if (e) return e;
    if (url === "/api/ai/status") return envelope(status);
    if (url === "/api/ai/insights") return envelope(INSIGHTS);
    if (url === "/api/notifications") return envelope({ notifications: [], unreadCount: 0, nextCursor: null });
    return json(HEALTH_OK);
  });

describe("Ask AI (batch J)", () => {
  it("says 'AI is not connected' and disables the box when the server has no key, or an administrator has not switched AI on", async () => {
    setMe(withCaps({ "ai.use": ["own"], "ai.view_insights": ["own"] }));
    server(STATUS({ connected: false, keyConfigured: false, enabledForOrganization: false, reason: "No AI key has been added to the server yet." }));
    renderApp("/ai");
    const ask = await screen.findByRole("group", { name: "Ask AI" });
    expect(await within(ask).findByText("AI is not connected.")).toBeTruthy();
    expect((within(ask).getByRole("textbox") as HTMLInputElement).disabled).toBe(true);
    expect(within(ask).queryByRole("button", { name: "Ask" })).toBeNull();
  });

  it("asks, then shows an AI-generated answer with the records it used as links, a warning for unchecked figures, and exactly what was sent", async () => {
    setMe(withCaps({ "ai.use": ["own"], "ai.view_insights": ["own"] }));
    const f = server(STATUS(), (url, init) => (url === "/api/ai/ask" && init?.method === "POST" ? envelope(ANSWER) : undefined));
    renderApp("/ai");
    const ask = await screen.findByRole("group", { name: "Ask AI" });
    await userEvent.type(await within(ask).findByRole("textbox"), "How is Acme?");
    await userEvent.click(within(ask).getByRole("button", { name: "Ask" }));
    const card = await screen.findByLabelText("AI answer");
    expect(within(card).getByText("AI-generated")).toBeTruthy();
    expect(within(card).getByText(/Based only on the records listed below/)).toBeTruthy();
    expect(within(card).getByText(/not in the records that were sent.*73/)).toBeTruthy();
    expect(within(within(card).getByRole("list", { name: "Cited records" })).getByText("Grow the Acme base").getAttribute("href")).toBe("/okrs?objective=o1");
    await userEvent.click(within(card).getByText("What was sent to the AI"));
    expect(within(card).getByText("[O1] Grow the Acme base: progress no data")).toBeTruthy();
    expect(within(card).getByText(/1,234 characters/)).toBeTruthy();
    expect(within(card).getByText(/Never sent: private review notes, restricted evidence/)).toBeTruthy();
    const call = f.mock.calls.find((c) => c[0] === "/api/ai/ask")!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ question: "How is Acme?" });
  });

  it("a refusal (limit, timeout) is shown in the server's friendly words", async () => {
    setMe(withCaps({ "ai.use": ["own"], "ai.view_insights": ["own"] }));
    server(STATUS(), (url, init) => (url === "/api/ai/ask" && init?.method === "POST" ? json({ error: { code: "ai_limit_user", message: "You have used your 20 AI questions for today. Try again tomorrow." }, meta: { requestId: "r" } }, 429) : undefined));
    renderApp("/ai");
    const ask = await screen.findByRole("group", { name: "Ask AI" });
    await userEvent.type(await within(ask).findByRole("textbox"), "More?");
    await userEvent.click(within(ask).getByRole("button", { name: "Ask" }));
    expect(await within(ask).findByText(/You have used your 20 AI questions for today/)).toBeTruthy();
  });
});

describe("AI settings (batch J)", () => {
  it("an administrator sees whether the key is set (yes or no only) and turns AI on; the page is closed to everyone else", async () => {
    setMe(withCaps({ "ai.configure": ["all_in_scope"] }));
    const f = server(STATUS({ connected: false, enabledForOrganization: false, canConfigure: true, reason: "An administrator has not switched AI on for this organization." }), (url, init) => (url === "/api/ai/settings" && init?.method === "PUT" ? envelope(STATUS({ canConfigure: true })) : undefined));
    renderApp("/settings/ai");
    expect(await screen.findByText("AI is off")).toBeTruthy();
    expect(screen.getByText("Set")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Turn AI on for the organization" }));
    await waitFor(() => expect(f.mock.calls.some((c) => c[0] === "/api/ai/settings" && JSON.parse(String((c[1] as RequestInit).body)).enabled === true)).toBe(true));
    expect(await screen.findByText("AI is on")).toBeTruthy();
  });
  it("without ai.configure the settings page is not available", async () => {
    setMe(withCaps({ "ai.use": ["own"] }));
    server(STATUS());
    renderApp("/settings/ai");
    expect(await screen.findByText("You do not have access to this page")).toBeTruthy();
  });
});
