// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { envelope, HEALTH_OK, json, ME_READY, renderApp, setMe, stubFetch, stubMatchMedia } from "./helpers";

beforeEach(() => stubMatchMedia(false));

const isGet = (init?: RequestInit) => (init?.method ?? "GET") === "GET";
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));
const withCaps = (caps: Record<string, string[]>) => ({ ...ME_READY, roles: [{ key: "x", name: "Some Role" }], capabilities: caps });
const ALL = { "okr.view": ["all_in_scope"], "okr.create": ["all_in_scope"], "okr.edit": ["all_in_scope"], "okr.update_progress": ["all_in_scope"], "okr.publish": ["all_in_scope"], "okr.archive": ["all_in_scope"], "task.view": ["all_in_scope"] };

const KR = (over: Record<string, unknown> = {}) => ({
  id: "k1", title: "Signed deals", description: "", measurementType: "number", unit: "deals", direction: "increase", method: "linear", startValue: 0, targetValue: 10, currentValue: null, currentAsOf: null,
  weight: 1, owner: null, dueDate: null, attainmentPct: null, regressed: false, capped: false, degenerate: false, isDemo: false, ...over,
});
const OBJ = (over: Record<string, unknown> = {}) => ({
  id: "o1", title: "Win more customers", level: "company", objectiveType: "strategic", priority: "high", lifecycle: "active", visibility: "scope", published: false, startDate: "2026-01-01", endDate: "2026-12-31", weight: 1,
  owner: null, department: null, team: null, keyResultCount: 1, attainmentPct: null, dataState: "none", coveragePct: 0, elapsedPct: 90, health: "no_data", healthReason: "90% of the time has passed and no key result has a recorded value.", archived: false, isDemo: false, ...over,
});
const DETAIL = (over: Record<string, unknown> = {}) => ({
  ...OBJ(), description: "Grow the base", createdBy: { id: "m1", name: "Ada Lovelace" }, keyResults: [KR()],
  can: { edit: true, updateProgress: true, publish: true, archive: true, addKeyResults: true }, nextLifecycles: ["draft", "completed", "cancelled"], tasks: { total: 0, open: 0 }, ...over,
});
const server = (extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined) =>
  stubFetch((url, init) => {
    const special = extra(url, init);
    if (special) return special;
    const path = url.split("?")[0];
    if (path === "/api/objectives" && isGet(init)) return envelope([OBJ()]);
    if (path === "/api/objectives/o1" && isGet(init)) return envelope(DETAIL());
    if (path === "/api/objectives/o1/history") return envelope([]);
    if (path === "/api/objectives/o1/alignment") return envelope({ parent: null, children: [], hiddenChildren: 0, assignments: [], can: { assign: false } });
    if (path === "/api/tasks") return envelope({ tasks: [], total: 0, limit: 50, offset: 0 });
    if (path === "/api/notifications") return envelope({ notifications: [], unreadCount: 0, nextCursor: null });
    return json(HEALTH_OK);
  });

const EV = (over: Record<string, unknown> = {}) => ({ id: "e1", type: "report", title: "Draft of the report", description: "What was delivered", externalRef: "https://example.com/draft", about: { id: "m2", name: "Emma" }, submittedBy: { id: "m2", name: "Emma" }, occurredOn: "2026-11-20", verification: { status: "unverified", by: null, at: null, note: null }, confidentiality: "scope", file: null, links: [{ type: "objective", id: "o1" }], isDemo: false, can: { verify: false, attachFile: false }, ...over });
const EVCAPS = { ...ALL, "evidence.view": ["all_in_scope"], "evidence.submit": ["all_in_scope"], "evidence.verify": ["all_in_scope"] };
const evServer = (items: unknown[], extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined) =>
  server((url, init) => {
    const e = extra(url, init);
    if (e) return e;
    if (url.startsWith("/api/evidence?")) return envelope(items);
    return undefined;
  });

describe("Evidence panel (stage 4.3)", () => {
  it("lists what is attached with its state in words, a link, a downloadable file, and who verified it", async () => {
    setMe(withCaps(EVCAPS));
    evServer([EV({ verification: { status: "verified", by: { id: "m1", name: "Max" }, at: "x", note: "Matches the release" }, file: { filename: "draft.pdf", contentType: "application/pdf", sizeBytes: 4096 } })]);
    renderApp("/okrs?objective=o1");
    const panel = await screen.findByRole("region", { name: "Evidence" });
    expect(await within(panel).findByText("Draft of the report")).toBeTruthy();
    expect(within(panel).getByText("Verified")).toBeTruthy();
    expect(within(panel).getByText(/Verified by Max: Matches the release/)).toBeTruthy();
    expect(within(panel).getByText("Open the link").getAttribute("rel")).toBe("noopener noreferrer");
    expect(within(panel).getByText("Download draft.pdf").getAttribute("href")).toBe("/api/evidence/e1/file");
  });
  it("attaching sends the title, the link and the record it supports; a refusal shows the server's words", async () => {
    setMe(withCaps(EVCAPS));
    const f = evServer([], (url, init) => (url === "/api/evidence" && init?.method === "POST" ? json({ error: { code: "invalid_link", message: "A link starts with http:// or https://." }, meta: { requestId: "r" } }, 400) : undefined));
    renderApp("/okrs?objective=o1");
    const panel = await screen.findByRole("region", { name: "Evidence" });
    expect(await within(panel).findByText("No evidence is attached to this yet.")).toBeTruthy();
    await userEvent.click(within(panel).getByRole("button", { name: "Attach evidence" }));
    const form = await within(panel).findByRole("form", { name: "Attach evidence" });
    await userEvent.type(within(form).getByLabelText("Title"), "Release notes");
    await userEvent.type(within(form).getByLabelText("Link (optional)"), "ftp://nope");
    await userEvent.click(within(form).getByRole("button", { name: "Save evidence" }));
    expect(await within(form).findByText("A link starts with http:// or https://.")).toBeTruthy();
    expect(bodyOf(f.mock.calls.find((c) => c[0] === "/api/evidence" && (c[1] as RequestInit)?.method === "POST")!)).toMatchObject({ title: "Release notes", externalRef: "ftp://nope", confidentiality: "scope", links: [{ type: "objective", id: "o1" }] });
  });
  it("a verifier can verify, and rejecting asks for a reason first; someone who may not verify sees no buttons; no evidence permission, no panel", async () => {
    setMe(withCaps(EVCAPS));
    const f = evServer([EV({ can: { verify: true, attachFile: false } })], (url, init) => (url === "/api/evidence/e1/verify" && init?.method === "POST" ? envelope(EV({ verification: { status: "rejected", by: { id: "m1", name: "Max" }, at: "x", note: "No" } })) : undefined));
    renderApp("/okrs?objective=o1");
    const panel = await screen.findByRole("region", { name: "Evidence" });
    await userEvent.click(await within(panel).findByRole("button", { name: "Reject" }));
    const form = await within(panel).findByRole("form", { name: "Say why" });
    expect((within(form).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(within(form).getByLabelText("Why is it rejected?"), "No");
    await userEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(f.mock.calls.some((c) => c[0] === "/api/evidence/e1/verify")).toBe(true));
    expect(bodyOf(f.mock.calls.find((c) => c[0] === "/api/evidence/e1/verify")!)).toEqual({ status: "rejected", note: "No" });
  });
  it("without evidence.view there is no evidence section at all", async () => {
    setMe(withCaps(ALL));
    server();
    renderApp("/okrs?objective=o1");
    await screen.findByText("Grow the base");
    expect(screen.queryByRole("region", { name: "Evidence" })).toBeNull();
  });
});
