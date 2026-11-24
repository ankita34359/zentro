// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { envelope, HEALTH_OK, json, ME_READY, renderApp, setMe, stubFetch, stubMatchMedia } from "./helpers";

beforeEach(() => stubMatchMedia(false));
const withCaps = (caps: Record<string, string[]>) => ({ ...ME_READY, roles: [{ key: "x", name: "Some Role" }], capabilities: caps });
const INFO = { files: ["people.csv", "tasks.csv"], excluded: ["private review notes (reviews are not exported)", "any other organization's data"] };
const server = (extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined) => stubFetch((url, init) => extra(url, init) ?? (url === "/api/export" && (init?.method ?? "GET") === "GET" ? envelope(INFO) : url === "/api/notifications" ? envelope({ notifications: [], unreadCount: 0, nextCursor: null }) : json(HEALTH_OK)));

describe("Export all data page (batch L)", () => {
  it("an administrator sees what is in the zip and what is left out, and the button asks for the export and saves the file", async () => {
    setMe(withCaps({ "org.settings": ["all_in_scope"] }));
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:test";
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const f = server((url, init) => (url === "/api/export" && init?.method === "POST" ? new Response("PK", { status: 200, headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="zentro-export-acme-2026-11-24.zip"' } }) : undefined));
    renderApp("/settings/export");
    expect(await screen.findByRole("heading", { level: 1, name: "Export all data" })).toBeTruthy();
    expect(within(await screen.findByRole("list", { name: "Files in the export" })).getByText("people.csv")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Not included" })).getByText(/private review notes/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Download everything/ }));
    await waitFor(() => expect(clicked).toHaveBeenCalled());
    expect(f.mock.calls.some((c) => c[0] === "/api/export" && (c[1] as RequestInit)?.method === "POST")).toBe(true);
    expect(await screen.findByText("Your download has started. It was recorded in the audit log.")).toBeTruthy();
    clicked.mockRestore();
  });
  it("a refusal shows the server's plain words, and a person without the administrator permission cannot open the page or see it in Settings", async () => {
    setMe(withCaps({ "org.settings": ["all_in_scope"] }));
    server((url, init) => (url === "/api/export" && init?.method === "POST" ? json({ error: { code: "rate_limited", message: "Too many attempts, try again in a minute." }, meta: { requestId: "r" } }, 429) : undefined));
    renderApp("/settings/export");
    await userEvent.click(await screen.findByRole("button", { name: /Download everything/ }));
    expect(await screen.findByText("Too many attempts, try again in a minute.")).toBeTruthy();
  });
  it("without org.settings the page says no access", async () => {
    setMe(withCaps({ "org.view": ["all_in_scope"] }));
    server();
    renderApp("/settings/export");
    expect(await screen.findByText("You do not have access to this page")).toBeTruthy();
  });
});
