// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { apiError, envelope, HEALTH_OK, json, ME_READY, renderApp, setMe, stubFetch, stubMatchMedia } from "./helpers";

beforeEach(() => stubMatchMedia(false));

const calls = (fn: ReturnType<typeof stubFetch>, path: string, method: string) => fn.mock.calls.filter((c) => String(c[0]).split("?")[0] === path && ((c[1] as RequestInit | undefined)?.method ?? "GET") === method);
const isGet = (init?: RequestInit) => (init?.method ?? "GET") === "GET";
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));

const task = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id, title, status: "not_started", priority: "medium", importanceWeight: 3, progressPct: 0, startDate: null, dueAt: null, overdue: false, estimatedMinutes: null, actualMinutes: 0, blockedReason: null,
  team: null, createdBy: { id: "m1", name: "Ada Lovelace" }, assignees: [{ assignmentId: `a-${id}`, kind: "person", id: "m1", name: "Ada Lovelace", role: "assignee" }], completedAt: null, isDemo: false, ...extra,
});
const WORK = {
  today: "2026-11-23",
  counts: { open: 4, overdue: 1, dueToday: 1, blocked: 1, completedRecently: 1 },
  overdue: [task("t1", "Send the invoice", { dueAt: "2026-11-20", overdue: true, priority: "high" })],
  dueToday: [task("t2", "Prepare the demo", { dueAt: "2026-11-23" })],
  upcoming: [],
  blocked: [task("t3", "Get API access", { status: "blocked", blockedReason: "Waiting for IT" })],
  inProgress: [task("t4", "Write the report", { status: "in_progress", progressPct: 40, estimatedMinutes: 120, actualMinutes: 60 })],
  unscheduled: [],
  suggested: [
    { task: task("t1", "Send the invoice", { dueAt: "2026-11-20", overdue: true }), score: 1100, reasons: ["Overdue by 3 days", "High priority"] },
    { task: task("t2", "Prepare the demo", { dueAt: "2026-11-23" }), score: 700, reasons: ["Due today"] },
    { task: task("t3", "Get API access", { status: "blocked" }), score: -4000, reasons: ["Blocked: ask for help or remove the blocker before spending time here"] },
  ],
  achievements: [task("t9", "Fix the login bug", { status: "completed", completedAt: "2026-11-21T10:00:00Z", progressPct: 100 })],
  dailyUpdate: null,
};
const DETAIL = (over: Record<string, unknown> = {}) => ({
  ...task("t1", "Send the invoice", { dueAt: "2026-11-20", overdue: true, priority: "high", status: "in_progress", progressPct: 20 }),
  description: "Invoice for October", parentTaskId: null, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-02T00:00:00Z",
  can: { edit: true, editEstimate: true, update: true, assign: false, comment: true }, nextStatuses: ["not_started", "blocked", "under_review", "completed", "cancelled"], ...over,
});
const server = (extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined) =>
  stubFetch((url, init) => {
    const special = extra(url, init);
    if (special) return special;
    const path = url.split("?")[0];
    if (path === "/api/my-work") return envelope(WORK);
    if (path === "/api/tasks" && (init?.method ?? "GET") === "GET") return envelope({ tasks: [task("t1", "Send the invoice", { dueAt: "2026-11-20", overdue: true }), task("t5", "Plan the trip")], total: 2, limit: 100, offset: 0 });
    if (path === "/api/tasks/t1") return envelope(DETAIL());
    if (path === "/api/tasks/t1/updates") return envelope([{ id: "u1", type: "progress", author: { id: "m1", name: "Ada Lovelace" }, fromStatus: null, toStatus: null, progressPct: 20, minutesLogged: null, body: "Draft ready", createdAt: new Date().toISOString() }]);
    if (path === "/api/tasks/t1/comments") return envelope([{ id: "c1", author: { id: "m2", name: "Bo Dev" }, body: "Thanks for the update", edited: false, createdAt: new Date().toISOString(), mine: false }]);
    if (path === "/api/notifications") return envelope({ notifications: [], unreadCount: 0, nextCursor: null });
    return json(HEALTH_OK);
  });
const withCaps = (caps: Record<string, string[]>) => ({ ...ME_READY, roles: [{ key: "x", name: "Some Role" }], capabilities: caps });
const EMPLOYEE = { "task.view": ["own", "my_teams"], "task.create": ["own"] };

describe("My Work → Today (stage 4.4)", () => {
  it("shows the counts, the suggested order with the reasons, grouped tasks, and recent achievements", async () => {
    setMe(withCaps(EMPLOYEE));
    server();
    renderApp("/my-work");
    const order = await screen.findByRole("list", { name: "Suggested order" });
    const items = within(order).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByText("Send the invoice")).toBeTruthy();
    expect(within(items[0]!).getByText("Overdue by 3 days")).toBeTruthy();
    expect(within(items[0]!).getByText("High priority")).toBeTruthy();
    expect(within(items[2]!).getByText(/^Blocked:/)).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Overdue" })).getByText("Overdue by 3 days")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Due today" })).getByText("Prepare the demo")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Blocked" })).getByText("Get API access")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "In progress" })).getByText(/1 h of 2 h/)).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Recently completed" })).getByText("Fix the login bug")).toBeTruthy();
  });

  it("an empty workspace says what to do and still offers the daily update", async () => {
    setMe(withCaps(EMPLOYEE));
    stubFetch((url) => (url === "/api/my-work" ? envelope({ ...WORK, counts: { open: 0, overdue: 0, dueToday: 0, blocked: 0, completedRecently: 0 }, overdue: [], dueToday: [], blocked: [], inProgress: [], suggested: [], achievements: [] }) : url.startsWith("/api/notifications") ? envelope({ notifications: [], unreadCount: 0, nextCursor: null }) : json(HEALTH_OK)));
    renderApp("/my-work");
    expect(await screen.findByText("No tasks yet")).toBeTruthy();
    expect(screen.getByRole("form", { name: "Daily update" })).toBeTruthy();
  });

  it("sends the daily update (asks for text first) and says so", async () => {
    setMe(withCaps(EMPLOYEE));
    const f = server((url, init) => (url === "/api/daily-updates" && init?.method === "POST" ? envelope({ date: "2026-11-23", summary: "Did things", blockers: null, replaced: false }, 201) : undefined));
    renderApp("/my-work");
    const form = await screen.findByRole("form", { name: "Daily update" });
    await userEvent.click(within(form).getByRole("button", { name: "Send update" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("Write what you did or plan to do");
    expect(calls(f, "/api/daily-updates", "POST")).toHaveLength(0);
    await userEvent.type(within(form).getByLabelText("What did you do, and what is next?"), "Did things");
    await userEvent.click(within(form).getByRole("button", { name: "Send update" }));
    await within(form).findByText(/Update sent/);
    expect(bodyOf(calls(f, "/api/daily-updates", "POST")[0]!)).toEqual({ summary: "Did things", blockers: null });
  });

  it("a person who may create tasks creates one (title required) and its panel opens", async () => {
    setMe(withCaps(EMPLOYEE));
    const f = server((url, init) => (url === "/api/tasks" && init?.method === "POST" ? envelope(DETAIL(), 201) : undefined));
    renderApp("/my-work");
    await userEvent.click(await screen.findByRole("button", { name: "New task" }));
    const form = await screen.findByRole("form", { name: "New task" });
    await userEvent.click(within(form).getByRole("button", { name: "Create task" }));
    expect(await within(form).findByText("Give the task a title")).toBeTruthy();
    await userEvent.type(within(form).getByLabelText("Title"), "Send the invoice");
    await userEvent.selectOptions(within(form).getByLabelText("Priority"), "high");
    await userEvent.click(within(form).getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(calls(f, "/api/tasks", "POST")).toHaveLength(1));
    expect(bodyOf(calls(f, "/api/tasks", "POST")[0]!)).toEqual({ title: "Send the invoice", priority: "high" });
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("without task.create there is no New task button", async () => {
    setMe(withCaps({ "task.view": ["own"] }));
    server();
    renderApp("/my-work");
    await screen.findByRole("list", { name: "Suggested order" });
    expect(screen.queryByRole("button", { name: "New task" })).toBeNull();
  });
});

describe("My Work → All tasks", () => {
  it("lists the tasks you may see, filters through the server, and opens one", async () => {
    setMe(withCaps(EMPLOYEE));
    const f = server();
    renderApp("/my-work/tasks");
    const list = await screen.findByRole("list", { name: "Task list" });
    expect(within(list).getByText("Plan the trip")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Showing 2 of 2 tasks");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Status" }), "blocked");
    await waitFor(() => expect(calls(f, "/api/tasks", "GET").some((c) => String(c[0]).includes("status=blocked"))).toBe(true));
    await userEvent.click(screen.getByRole("checkbox", { name: "Only overdue" }));
    await waitFor(() => expect(calls(f, "/api/tasks", "GET").some((c) => String(c[0]).includes("overdue=true"))).toBe(true));
    await userEvent.click(within(list).getByRole("button", { name: "Open task: Send the invoice" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });
});

describe("Task panel", () => {
  async function openPanel(extra?: (url: string, init?: RequestInit) => Response | undefined) {
    setMe(withCaps(EMPLOYEE));
    const f = server(extra);
    renderApp("/my-work?task=t1");
    const dlg = await screen.findByRole("dialog");
    await within(dlg).findByRole("heading", { name: "Send the invoice" });
    return { f, dlg };
  }

  it("shows the task, its comments and history, and the statuses it may move to", async () => {
    const { dlg } = await openPanel();
    expect(within(dlg).getByText("Invoice for October")).toBeTruthy();
    expect(within(dlg).getByText("Overdue by 3 days")).toBeTruthy();
    expect(await within(dlg).findByText("Thanks for the update")).toBeTruthy();
    expect(await within(dlg).findByText(/Draft ready/)).toBeTruthy();
    const moves = within(dlg).getByRole("group", { name: "Move to" });
    expect(within(moves).getAllByRole("button").map((b) => b.textContent)).toEqual(["Not started", "Blocked", "Under review", "Mark completed", "Cancelled"]);
  });

  it("blocking needs a reason first; completing is one click; the server's refusal is shown in its words", async () => {
    let refuse = false;
    const { f, dlg } = await openPanel((url, init) => {
      if (url === "/api/tasks/t1/updates" && init?.method === "POST") return refuse ? apiError(409, "invalid_transition", "A task that is in progress cannot go straight to cancelled.") : envelope(DETAIL({ status: "blocked", blockedReason: "Waiting" }), 201);
      return undefined;
    });
    await userEvent.click(within(dlg).getByRole("button", { name: "Blocked" }));
    const form = within(dlg).getByRole("form", { name: "Report a blocker" });
    await userEvent.click(within(form).getByRole("button", { name: "Mark blocked" }));
    expect(await within(dlg).findByText("Say what is blocking the task")).toBeTruthy();
    expect(calls(f, "/api/tasks/t1/updates", "POST")).toHaveLength(0);
    await userEvent.type(within(form).getByLabelText("What is blocking it?"), "Waiting");
    await userEvent.click(within(form).getByRole("button", { name: "Mark blocked" }));
    await waitFor(() => expect(calls(f, "/api/tasks/t1/updates", "POST")).toHaveLength(1));
    expect(bodyOf(calls(f, "/api/tasks/t1/updates", "POST")[0]!)).toEqual({ type: "status_change", toStatus: "blocked", note: "Waiting" });
    refuse = true;
    await userEvent.click(within(dlg).getByRole("button", { name: "Mark completed" }));
    expect((await within(dlg).findByRole("alert")).textContent).toContain("cannot go straight");
  });

  it("records progress and time with checks, and sends a comment", async () => {
    const { f, dlg } = await openPanel((url, init) => {
      if (url === "/api/tasks/t1/updates" && init?.method === "POST") return envelope(DETAIL(), 201);
      if (url === "/api/tasks/t1/comments" && init?.method === "POST") return envelope({ id: "c2", author: { id: "m1", name: "Ada Lovelace" }, body: "On it", edited: false, createdAt: new Date().toISOString(), mine: true }, 201);
      return undefined;
    });
    const prog = within(dlg).getByRole("form", { name: "Record progress" });
    await userEvent.type(within(prog).getByLabelText("Progress (%)"), "100");
    await userEvent.click(within(prog).getByRole("button", { name: "Record progress" }));
    expect((await within(dlg).findByRole("alert")).textContent).toContain("0 to 99");
    await userEvent.clear(within(prog).getByLabelText("Progress (%)"));
    await userEvent.type(within(prog).getByLabelText("Progress (%)"), "60");
    await userEvent.click(within(prog).getByRole("button", { name: "Record progress" }));
    await waitFor(() => expect(calls(f, "/api/tasks/t1/updates", "POST")).toHaveLength(1));
    expect(bodyOf(calls(f, "/api/tasks/t1/updates", "POST")[0]!)).toEqual({ type: "progress", progressPct: 60 });
    const time = within(dlg).getByRole("form", { name: "Log time" });
    await userEvent.type(within(time).getByLabelText("Time spent (minutes)"), "45");
    await userEvent.click(within(time).getByRole("button", { name: "Log time" }));
    await waitFor(() => expect(calls(f, "/api/tasks/t1/updates", "POST")).toHaveLength(2));
    expect(bodyOf(calls(f, "/api/tasks/t1/updates", "POST")[1]!)).toEqual({ type: "time_log", minutesLogged: 45 });
    await userEvent.type(within(dlg).getByRole("textbox", { name: "Add a comment" }), "On it");
    await userEvent.click(within(dlg).getByRole("button", { name: "Comment" }));
    await waitFor(() => expect(calls(f, "/api/tasks/t1/comments", "POST")).toHaveLength(1));
  });

  it("an assignee who may only update sees no edit form for the details; a viewer who cannot update sees no update forms; a task outside the view is a calm message", async () => {
    setMe(withCaps(EMPLOYEE));
    server((url) => (url === "/api/tasks/t1" ? envelope(DETAIL({ can: { edit: false, editEstimate: false, update: false, assign: false, comment: true } })) : undefined));
    renderApp("/my-work?task=t1");
    const dlg = await screen.findByRole("dialog");
    await within(dlg).findByRole("heading", { name: "Send the invoice" });
    expect(within(dlg).queryByRole("form", { name: "Record progress" })).toBeNull();
    expect(within(dlg).queryByRole("button", { name: "Edit details" })).toBeNull();
  });

  it("a task that is not visible shows a calm message", async () => {
    setMe(withCaps(EMPLOYEE));
    server((url) => (url === "/api/tasks/t1" ? apiError(404, "not_found", "Not found") : undefined));
    renderApp("/my-work?task=t1");
    expect(await screen.findByText("This task is not in your view")).toBeTruthy();
  });

  it("someone who may assign can add a person and take one off after confirming", async () => {
    const { f, dlg } = await openPanel((url, init) => {
      if (url === "/api/tasks/t1" && isGet(init)) return envelope(DETAIL({ can: { edit: true, editEstimate: true, update: true, assign: true, comment: true } }));
      if (url.startsWith("/api/employees")) return envelope({ people: [{ id: "m2", displayName: "Bo Dev", status: "active", hasLogin: false, archived: false, designation: null, departments: [], teams: [], managers: [], email: null }], total: 1, limit: 500, offset: 0 });
      if (url === "/api/tasks/t1/assignments" && init?.method === "POST") return envelope(DETAIL(), 201);
      if (url === "/api/tasks/t1/assignments/a-t1/end" && init?.method === "POST") return envelope(DETAIL());
      return undefined;
    });
    const picker = within(dlg).getByRole("combobox", { name: "Add a person" }) as HTMLSelectElement;
    await waitFor(() => expect(picker.options.length).toBeGreaterThan(1));
    await userEvent.selectOptions(picker, "m2");
    await userEvent.click(within(dlg).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls(f, "/api/tasks/t1/assignments", "POST")).toHaveLength(1));
    expect(bodyOf(calls(f, "/api/tasks/t1/assignments", "POST")[0]!)).toEqual({ assigneeId: "m2" });
    await userEvent.click(within(dlg).getByRole("button", { name: "Take Ada Lovelace off this task" }));
    expect(calls(f, "/api/tasks/t1/assignments/a-t1/end", "POST")).toHaveLength(0);
    await userEvent.click(within(dlg).getByRole("button", { name: "Confirm taking Ada Lovelace off this task" }));
    await waitFor(() => expect(calls(f, "/api/tasks/t1/assignments/a-t1/end", "POST")).toHaveLength(1));
  });
});

describe("The bell and notification settings (stage 4.5)", () => {
  const INBOX = { notifications: [
    { id: "n1", type: "task.overdue", title: "Overdue: Send the invoice", body: "This was due on 2026-11-20 (3 days ago).", severity: "warning", entityType: "task", entityId: "t1", read: false, createdAt: new Date().toISOString() },
    { id: "n2", type: "task.assigned", title: "Bo gave you a task", body: "Plan the trip", severity: "info", entityType: "task", entityId: "t5", read: true, createdAt: new Date(Date.now() - 3 * 3600_000).toISOString() },
  ], unreadCount: 1, nextCursor: null };

  it("shows the unread count on the bell, lists notifications, and opening one marks it read and goes to the task", async () => {
    setMe(withCaps(EMPLOYEE));
    const f = server((url, init) => {
      if (url.startsWith("/api/notifications") && isGet(init)) return envelope(INBOX);
      if (url === "/api/notifications/n1/read" && init?.method === "POST") return envelope({ unreadCount: 0 });
      return undefined;
    });
    renderApp("/overview");
    const bell = await screen.findByRole("button", { name: "Notifications, 1 unread" });
    await userEvent.click(bell);
    const list = await screen.findByRole("list", { name: "Notifications list" });
    expect(within(list).getByText("Overdue: Send the invoice")).toBeTruthy();
    expect(within(list).getByText("3 hours ago")).toBeTruthy();
    await userEvent.click(within(list).getByRole("button", { name: /Overdue: Send the invoice/ }));
    await waitFor(() => expect(calls(f, "/api/notifications/n1/read", "POST")).toHaveLength(1));
    // the task opens in the panel on My Work
    const dlg = await screen.findByRole("dialog");
    expect(await within(dlg).findByRole("heading", { name: "Send the invoice" })).toBeTruthy();
  });

  it("mark all read; an empty inbox says so", async () => {
    setMe(withCaps(EMPLOYEE));
    const f = server((url, init) => {
      if (url.startsWith("/api/notifications") && isGet(init)) return envelope(INBOX);
      if (url === "/api/notifications/read-all" && init?.method === "POST") return envelope({ marked: 1, unreadCount: 0 });
      return undefined;
    });
    renderApp("/overview");
    await userEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    await userEvent.click(await screen.findByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(calls(f, "/api/notifications/read-all", "POST")).toHaveLength(1));
  });

  it("settings: each kind can be switched off, saved as you click", async () => {
    setMe(withCaps(EMPLOYEE));
    const types = [{ type: "task.assigned", label: "A task is assigned to me", description: "When someone gives you a task.", inApp: true }, { type: "task.overdue", label: "A task is overdue", description: "x", inApp: true }];
    const f = server((url, init) => {
      if (url === "/api/preferences" && isGet(init)) return envelope({ types });
      if (url === "/api/preferences" && init?.method === "PUT") return envelope({ types: [{ ...types[0]!, inApp: false }, types[1]!] });
      return undefined;
    });
    renderApp("/settings/notifications");
    const list = await screen.findByRole("list", { name: "Kinds of notification" });
    await userEvent.click(within(list).getByRole("checkbox", { name: /A task is assigned to me/ }));
    await waitFor(() => expect(calls(f, "/api/preferences", "PUT")).toHaveLength(1));
    expect(bodyOf(calls(f, "/api/preferences", "PUT")[0]!)).toEqual({ types: [{ type: "task.assigned", inApp: false }] });
    expect((await screen.findByRole("status")).textContent).toBe("Saved.");
  });
});
