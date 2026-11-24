// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { envelope, HEALTH_OK, json, ME_READY, renderApp, setMe, stubFetch, stubMatchMedia } from "./helpers";

beforeEach(() => stubMatchMedia(false));
const withCaps = (caps: Record<string, string[]>) => ({ ...ME_READY, roles: [{ key: "x", name: "Some Role" }], capabilities: caps });
const SYSTEM = {
  version: "abc1234", node: "20.20.2", migrations: { applied: 22, total: 22 }, database: { sizeBytes: 2_621_440 },
  backups: {
    count: 4, daily: { count: 3, keep: 14 }, preMigration: { count: 1 },
    newest: { name: "daily-2026-11-24T03-00-00-000Z.db", sizeBytes: 1_048_576, at: "2026-11-24T03:00:01.000Z" },
    files: [{ name: "daily-2026-11-24T03-00-00-000Z.db", kind: "daily", sizeBytes: 1_048_576, at: "2026-11-24T03:00:01.000Z" }, { name: "pre-0021-2026-11-23T10-00-00-000Z.db", kind: "pre-migration", sizeBytes: 900_000, at: "2026-11-23T10:00:00.000Z" }],
    lastRun: { startedAt: "2026-11-24T03:00:00.000Z", finishedAt: "2026-11-24T03:00:02.000Z", status: "ok", error: null },
    location: "On the server's own disk, in the app's data folder, next to the database.",
    warning: "These copies protect against a mistake or a bad update. They are on the same disk as the database, so they do NOT protect against losing the server or its disk. An off-server copy is a later step.",
  },
  jobs: [{ name: "platform.backup", startedAt: "2026-11-24T03:00:00.000Z", finishedAt: "2026-11-24T03:00:02.000Z", status: "ok", error: null }, { name: "tasks.reminders", startedAt: "2026-11-24T03:05:00.000Z", finishedAt: "2026-11-24T03:05:01.000Z", status: "failed", error: "boom" }],
  lastTick: { startedAt: "2026-11-24T03:05:00.000Z", finishedAt: "2026-11-24T03:05:02.000Z", status: "ok" },
};
const server = () => stubFetch((url) => (url === "/api/system" ? envelope(SYSTEM) : url === "/api/notifications" ? envelope({ notifications: [], unreadCount: 0, nextCursor: null }) : json(HEALTH_OK)));

describe("System page (batch K)", () => {
  it("an administrator sees the last backup and its result, the copies, the version, the database size and the jobs, and is told backups are on the server's disk", async () => {
    setMe(withCaps({ "org.settings": ["all_in_scope"] }));
    server();
    renderApp("/settings/system");
    expect(await screen.findByRole("heading", { level: 1, name: "System" })).toBeTruthy();
    expect(await screen.findByText(/do NOT protect against losing the server or its disk/)).toBeTruthy();
    expect(screen.getByText("On the server's own disk, in the app's data folder, next to the database.")).toBeTruthy();
    expect(screen.getByText(/4 in total: 3 daily \(the newest 14 are kept\) and 1 made before updates/)).toBeTruthy();
    expect(screen.getAllByText("Worked").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("abc1234").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("22 of 22").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("2.5 MB")).toBeTruthy();
    const files = screen.getByRole("list", { name: "Backup copies" });
    expect(within(files).getAllByRole("listitem")).toHaveLength(2);
    const jobs = screen.getByRole("list", { name: "Background jobs" });
    expect(within(jobs).getByText("Daily backup")).toBeTruthy();
    expect(within(jobs).getByText("Failed")).toBeTruthy();
    expect(within(jobs).getByText("boom")).toBeTruthy();
  });
  it("a person without the administrator permission cannot open the page and the Settings list does not offer it", async () => {
    setMe(withCaps({ "org.view": ["all_in_scope"] }));
    server();
    renderApp("/settings/system");
    expect(await screen.findByText("You do not have access to this page")).toBeTruthy();
  });
  it("the Settings list offers System to an administrator only", async () => {
    setMe(withCaps({ "org.view": ["all_in_scope"] }));
    server();
    renderApp("/settings");
    await screen.findByRole("heading", { level: 1, name: "Settings" });
    expect(screen.queryByText("System", { selector: "span" })).toBeNull();
  });
});
