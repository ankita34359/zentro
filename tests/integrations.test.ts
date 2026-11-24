import crypto from "node:crypto";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchSender, isPrivateAddress, SendError, validateWebhookUrl, type SendRequest, type SendResult, type WebhookSender } from "../backend/src/modules/integrations/sender.js";
import { signBody, WEBHOOK_EVENTS } from "../backend/src/modules/integrations/webhooks.js";
import { ORIGIN, type TestApp } from "./helpers/app.js";
import { get, makeAuthApp, post, send, signUpWithOrg } from "./helpers/auth.js";
import { addPerson, roleIds } from "./helpers/roles.js";

let t: TestApp;
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); t?.cleanup(); });
const code = (r: { body: { error?: { code?: string } } }) => r.body.error?.code;
const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const one = <T>(sql: string, ...p: unknown[]) => t.db.prepare(sql).get(...p) as T;

/** A receiver that never touches the network: it keeps everything it was sent and answers as told. */
class FakeReceiver implements WebhookSender {
  requests: SendRequest[] = [];
  answer: (r: SendRequest) => number | SendError = () => 200;
  async send(req: SendRequest): Promise<SendResult> {
    this.requests.push(req);
    const a = this.answer(req);
    if (a instanceof SendError) throw a;
    return { status: a };
  }
  bodies() { return this.requests.map((r) => JSON.parse(r.body) as { id: string; type: string; occurredAt: string; organizationId: string; entity: { type: string; id: string } | null; data: Record<string, unknown> }); }
}
const URL_A = "https://hooks.example.com/secret-path-123/flow";
const verify = (req: SendRequest, secret: string): boolean => {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(req.headers["X-Zentro-Signature"] ?? "");
  if (!m) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${m[1]}.${req.body}`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(m[2]!), Buffer.from(expected));
};
async function setup(rx = new FakeReceiver()) {
  t = makeAuthApp({ webhookSender: rx });
  const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
  const ids = await roleIds(t.app, owner);
  const max = await addPerson(t.app, owner, "max@example.com", ids.manager, "Max Manager");
  const emma = await addPerson(t.app, owner, "emma@example.com", ids.employee, "Emma Employee");
  return { rx, owner, max, emma, ids };
}
const hook = (owner: string, body: Record<string, unknown>) => send(t.app, "put", "/api/integrations/webhooks", body, owner);
async function connect(owner: string, events: string[] = ["task.created"]) {
  const saved = await hook(owner, { url: URL_A });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const secret = saved.body.data.signingSecret as string;
  expect((await hook(owner, { events: Object.fromEntries(events.map((e) => [e, true])), enabled: true })).status).toBe(200);
  return secret;
}

describe("the address and the secret (batch L)", () => {
  it("only a public https address is accepted", () => {
    for (const bad of ["http://hooks.example.com/x", "https://localhost/x", "https://127.0.0.1/x", "https://10.1.2.3/x", "https://192.168.0.5/x", "https://169.254.169.254/latest/meta-data", "https://[::1]/x", "https://user:pw@hooks.example.com/x", "https://intranet/x", "https://printer.local/x", "ftp://hooks.example.com", "not a url", "https://hooks.example.com/x#frag"]) expect(validateWebhookUrl(bad).ok, bad).toBe(false);
    expect(validateWebhookUrl("https://hooks.example.com/a/b?c=d").ok).toBe(true);
    for (const ip of ["127.0.0.1", "10.0.0.1", "172.16.5.5", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("the real sender refuses a name that points at a private address, follows no redirect, and reads only the status", async () => {
    await expect(new FetchSender(false, async () => ["10.0.0.7"]).send({ url: "https://evil.example.com/x", headers: {}, body: "{}", timeoutMs: 1000 })).rejects.toMatchObject({ code: "blocked_address" });
    await expect(new FetchSender(false, async () => ["8.8.8.8", "127.0.0.1"]).send({ url: "https://evil.example.com/x", headers: {}, body: "{}", timeoutMs: 1000 })).rejects.toMatchObject({ code: "blocked_address" });
    await expect(new FetchSender(false, async () => { throw new Error("no such host"); }).send({ url: "https://nope.example.com/x", headers: {}, body: "{}", timeoutMs: 1000 })).rejects.toMatchObject({ code: "network" });
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("secret reply body", { status: 302, headers: { Location: "http://169.254.169.254/" } }));
    const r = await new FetchSender(false, async () => ["93.184.216.34"]).send({ url: "https://ok.example.com/x", headers: { A: "b" }, body: "{}", timeoutMs: 1000 });
    expect(r).toEqual({ status: 302 });
    expect((spy.mock.calls[0]![1] as RequestInit).redirect).toBe("manual");
  });

  it("saving an address makes a signing secret that is shown ONCE; neither the address nor the secret is ever returned again, stored in the clear, audited or logged", async () => {
    const { owner, max, emma } = await setup();
    expect((await get(t.app, "/api/integrations/webhooks", owner)).body.data).toMatchObject({ configured: false, enabled: false, host: null, secretSet: false });
    for (const bad of ["http://hooks.example.com/x", "https://localhost/x", "https://10.0.0.1/x"]) expect(code(await hook(owner, { url: bad })), bad).toBe("invalid_url");
    expect(code(await hook(owner, { enabled: true }))).toBe("url_required");
    const saved = await hook(owner, { url: URL_A });
    expect(saved.status).toBe(200);
    const secret = saved.body.data.signingSecret as string;
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{30,}$/);
    expect(saved.body.data).toMatchObject({ configured: true, host: "hooks.example.com", secretSet: true });
    expect(JSON.stringify(saved.body)).not.toContain("secret-path-123"); // the path of the address stays secret
    // never again
    const again = (await get(t.app, "/api/integrations/webhooks", owner)).body;
    expect(JSON.stringify(again)).not.toContain(secret);
    expect(JSON.stringify(again)).not.toContain("secret-path-123");
    expect(again.data.signingSecret).toBeUndefined();
    const changed = await hook(owner, { url: "https://hooks.example.com/other-path" });
    expect(changed.body.data.signingSecret).toBeUndefined(); // changing the address does not make a new secret
    // not in the database in the clear, not in the audit log, not in the logs
    const stored = JSON.stringify(t.db.prepare("SELECT * FROM webhook_settings").all());
    expect(stored).not.toContain(secret);
    expect(stored).not.toContain("hooks.example.com");
    const audit = JSON.stringify(t.db.prepare("SELECT * FROM audit_logs").all());
    for (const s of [secret, "secret-path-123", "hooks.example.com/other-path"]) { expect(audit).not.toContain(s); expect(t.lines.join("\n")).not.toContain(s); }
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs WHERE action = 'integration.webhook.save'").n).toBeGreaterThanOrEqual(2);
    // a new secret replaces the old one and is shown once
    const rot = await post(t.app, "/api/integrations/webhooks/rotate-secret", undefined, owner);
    expect(rot.body.data.signingSecret).toMatch(/^whsec_/);
    expect(rot.body.data.signingSecret).not.toBe(secret);
    // only an administrator
    for (const who of [max.cookie, emma.cookie]) {
      expect((await get(t.app, "/api/integrations/webhooks", who)).status).toBe(403);
      expect((await hook(who, { enabled: false })).status).toBe(403);
      expect((await post(t.app, "/api/integrations/webhooks/test", undefined, who)).status).toBe(403);
      expect((await get(t.app, "/api/integrations/deliveries", who)).status).toBe(403);
    }
  });
});

describe("outgoing events (batch L)", () => {
  it("a test event is signed, arrives at the receiver and is in the log with its answer; a refusal shows the code, never the address or the secret", async () => {
    const { rx, owner } = await setup();
    expect(code(await post(t.app, "/api/integrations/webhooks/test", undefined, owner))).toBe("url_required");
    const secret = (await hook(owner, { url: URL_A })).body.data.signingSecret as string;
    const ok = await post(t.app, "/api/integrations/webhooks/test", undefined, owner);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toMatchObject({ eventType: "test.ping", status: "delivered", responseCode: 200, isTest: true, attempts: 1 });
    expect(rx.requests).toHaveLength(1);
    expect(rx.requests[0]!.url).toBe(URL_A);
    expect(rx.requests[0]!.headers["X-Zentro-Event"]).toBe("test.ping");
    expect(rx.requests[0]!.headers["Content-Type"]).toBe("application/json");
    expect(verify(rx.requests[0]!, secret)).toBe(true);
    expect(verify(rx.requests[0]!, "whsec_wrong")).toBe(false);
    expect(rx.requests[0]!.timeoutMs).toBe(8000);
    rx.answer = () => 500;
    const bad = await post(t.app, "/api/integrations/webhooks/test", undefined, owner);
    expect(bad.body.data).toMatchObject({ status: "dead", responseCode: 500, error: "http_500" }); // a test is one attempt
    const log = (await get(t.app, "/api/integrations/deliveries", owner)).body.data as { eventType: string; status: string; responseCode: number | null }[];
    expect(log.map((d) => [d.status, d.responseCode])).toEqual([["dead", 500], ["delivered", 200]]);
    expect(JSON.stringify(log)).not.toMatch(/secret-path|whsec_|hooks\.example/);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs WHERE action = 'integration.webhook.test'").n).toBe(2);
  });

  it("only events that happen AFTER switching on, and only the types switched on, are sent; each event is sent once, signed, with only ids, names and numbers", async () => {
    const { rx, owner, emma } = await setup();
    await post(t.app, "/api/tasks", { title: "Before it was on", assigneeIds: [emma.membershipId] }, owner); // history is never sent
    const secret = await connect(owner, ["task.created"]);
    const mine = (await post(t.app, "/api/tasks", { title: "Call the Acme customers", assigneeIds: [emma.membershipId], dueAt: day(5) }, owner)).body.data.id as string;
    await t.tick.run();
    expect(rx.requests).toHaveLength(1); // task.assigned is not switched on, the old task is history
    const b = rx.bodies()[0]!;
    expect(b).toMatchObject({ type: "task.created", entity: { type: "task", id: mine }, organizationId: one<{ id: string }>("SELECT id FROM organizations").id });
    expect(b.data).toMatchObject({ taskId: mine, title: "Call the Acme customers" });
    expect(rx.requests[0]!.headers["X-Zentro-Delivery"]).toBe(b.id);
    expect(verify(rx.requests[0]!, secret)).toBe(true);
    await t.tick.run(); // the same event is never sent twice
    expect(rx.requests).toHaveLength(1);
    // switch another type on: what happened while it was off (the first task's assignment) is never sent, only what happens after
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 5_000 });
    await hook(owner, { events: { "task.assigned": true } });
    vi.setSystemTime(Date.now() + 5_000);
    await post(t.app, "/api/tasks", { title: "Second", assigneeIds: [emma.membershipId] }, owner);
    vi.setSystemTime(Date.now() + 120_000);
    await t.tick.run();
    expect(rx.bodies().map((x) => x.type).sort()).toEqual(["task.assigned", "task.created", "task.created"]);
    // switched off: nothing more is sent
    await hook(owner, { enabled: false });
    await post(t.app, "/api/tasks", { title: "Third" }, owner);
    vi.setSystemTime(Date.now() + 240_000);
    await t.tick.run();
    expect(rx.requests).toHaveLength(3);
  });

  it("a failing receiver is retried with a growing wait and ends 'dead' after six tries; a client error is not retried; a timeout counts as a failure; nothing waits forever", async () => {
    const { rx, owner } = await setup();
    await connect(owner, ["task.created"]);
    rx.answer = () => 503;
    const start = Date.now();
    vi.useFakeTimers({ toFake: ["Date"], now: start });
    await post(t.app, "/api/tasks", { title: "Retry me" }, owner);
    const row = () => one<{ status: string; attempts: number; next_attempt_at: string | null; response_code: number | null; error: string | null }>("SELECT status, attempts, next_attempt_at, response_code, error FROM webhook_deliveries WHERE is_test = 0");
    await t.tick.run();
    expect(row()).toMatchObject({ status: "retrying", attempts: 1, response_code: 503, error: "http_503" });
    expect(Date.parse(row().next_attempt_at!) - start).toBeGreaterThanOrEqual(60_000); // about a minute
    await t.tick.run(); // too early: no attempt
    expect(rx.requests).toHaveLength(1);
    const waits = [2, 6, 31, 121, 361];
    const nexts: number[] = [];
    for (const m of waits) {
      vi.setSystemTime(Date.now() + m * 60_000);
      await t.tick.run();
      const r = row();
      if (r.next_attempt_at) nexts.push(Date.parse(r.next_attempt_at) - Date.now());
    }
    expect(row()).toMatchObject({ status: "dead", attempts: 6, response_code: 503 });
    expect(rx.requests).toHaveLength(6);
    expect(nexts[0]!).toBeGreaterThan(4 * 60_000); // the wait grows: 5, 30, 120, 360 minutes
    expect(nexts[1]!).toBeGreaterThan(nexts[0]!);
    expect(nexts[2]!).toBeGreaterThan(nexts[1]!);
    vi.setSystemTime(Date.now() + 24 * 3_600_000);
    await t.tick.run();
    expect(rx.requests).toHaveLength(6); // dead means dead
    // a client error (the receiver says "no") is final at once
    rx.answer = () => 400;
    vi.setSystemTime(Date.now() + 120_000);
    await post(t.app, "/api/tasks", { title: "Refused" }, owner);
    vi.setSystemTime(Date.now() + 120_000);
    await t.tick.run();
    const last = one<{ status: string; attempts: number; error: string }>("SELECT status, attempts, error FROM webhook_deliveries ORDER BY rowid DESC LIMIT 1");
    expect(last).toMatchObject({ status: "dead", attempts: 1, error: "http_400" });
    // a timeout is retried
    rx.answer = () => new SendError("timeout");
    await post(t.app, "/api/tasks", { title: "Slow" }, owner);
    vi.setSystemTime(Date.now() + 120_000);
    await t.tick.run();
    expect(one<{ status: string; error: string; response_code: number | null }>("SELECT status, error, response_code FROM webhook_deliveries ORDER BY rowid DESC LIMIT 1")).toMatchObject({ status: "retrying", error: "timeout", response_code: null });
    // success after a failure
    rx.answer = () => 204;
    vi.setSystemTime(Date.now() + 120_000);
    await t.tick.run();
    expect(one<{ status: string; attempts: number }>("SELECT status, attempts FROM webhook_deliveries ORDER BY rowid DESC LIMIT 1")).toMatchObject({ status: "delivered", attempts: 2 });
  });

  it("a message over the size limit is never sent", async () => {
    const { rx, owner } = await setup();
    await connect(owner, ["task.created"]);
    const orgId = one<{ id: string }>("SELECT id FROM organizations").id;
    t.db.prepare("INSERT INTO webhook_deliveries (id, organization_id, event_id, event_type, status, attempts, next_attempt_at, payload_json, is_test, created_at) VALUES ('big1', ?, NULL, 'task.created', 'pending', 0, '2000-01-01T00:00:00.000Z', ?, 0, ?)").run(orgId, JSON.stringify({ x: "y".repeat(20_000) }), new Date().toISOString());
    await t.tick.run();
    expect(rx.requests).toHaveLength(0);
    expect(one<{ status: string; error: string }>("SELECT status, error FROM webhook_deliveries WHERE id = 'big1'")).toMatchObject({ status: "dead", error: "payload_too_large" });
  });

  it("evidence and reviews are announced by ids and outcomes only: never a note, a rating, a title or a summary; another organization's events never reach this receiver", async () => {
    const { rx, owner, max, emma } = await setup();
    await connect(owner, ["evidence.verified", "review.submitted", "task.created"]);
    expect((await post(t.app, "/api/hierarchy/reporting", { subordinateId: emma.membershipId, managerId: max.membershipId, startDate: day(-100) }, owner)).status).toBe(201);
    const ev = (await post(t.app, "/api/evidence", { title: "EVIDENCE-TITLE-ZULU", description: "d", relatedMembershipId: emma.membershipId }, emma.cookie)).body.data.id as string;
    expect((await post(t.app, `/api/evidence/${ev}/verify`, { status: "rejected", note: "VERIFY-NOTE-ZULU" }, max.cookie)).status).toBe(200);
    const period = (await post(t.app, "/api/performance/periods", { name: "Now", startDate: day(-60), endDate: day(30) }, owner)).body.data.id as string;
    expect((await post(t.app, "/api/performance/reviews", { periodId: period, subjectId: emma.membershipId, sharedSummary: "SHARED-SUMMARY-ZULU", privateNotes: "PRIVATE-NOTE-ZULU", rating: 5, submit: true }, max.cookie)).status).toBe(201);
    // another organization with its own receiver-less webhook and events
    const b = await signUpWithOrg(t.app, "b-owner@example.com", "Beta Co");
    await send(t.app, "put", "/api/integrations/webhooks", { url: "https://hooks.beta.example.com/b" }, b);
    await send(t.app, "put", "/api/integrations/webhooks", { events: { "task.created": true }, enabled: true }, b);
    await post(t.app, "/api/tasks", { title: "BETA-SECRET-TASK" }, b);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 120_000 });
    await t.tick.run();
    const forAcme = rx.requests.filter((r) => r.url === URL_A);
    const types = forAcme.map((r) => (JSON.parse(r.body) as { type: string }).type);
    expect(types).toEqual(expect.arrayContaining(["evidence.verified", "review.submitted"]));
    const text = forAcme.map((r) => r.body).join("\n");
    for (const forbidden of ["VERIFY-NOTE-ZULU", "EVIDENCE-TITLE-ZULU", "SHARED-SUMMARY-ZULU", "PRIVATE-NOTE-ZULU", "BETA-SECRET-TASK", "rating"]) expect(text, forbidden).not.toContain(forbidden);
    const toBeta = rx.requests.filter((r) => r.url.includes("beta.example.com"));
    expect(toBeta.map((r) => r.body).join("\n")).toContain("BETA-SECRET-TASK");
    expect(toBeta.map((r) => r.body).join("\n")).not.toContain("Acme");
    expect(toBeta.every((r) => (JSON.parse(r.body) as { organizationId: string }).organizationId !== one<{ id: string }>("SELECT id FROM organizations WHERE name = 'Acme'").id)).toBe(true);
  });

  it("the event list the page offers matches what the server can send", async () => {
    const { owner } = await setup();
    const view = (await get(t.app, "/api/integrations/webhooks", owner)).body.data as { events: { type: string }[] };
    expect(view.events.map((e) => e.type)).toEqual(WEBHOOK_EVENTS.map((e) => e.type));
    expect(code(await hook(owner, { events: { "made.up": true } }))).toBe("invalid_event");
    const status = (await get(t.app, "/api/integrations/status", owner)).body.data as { events: { type: string; status: string }[]; planned: { name: string }[] };
    expect(status.events.find((e) => e.type === "task.created")!.status).toBe("available");
    expect(status.events.find((e) => e.type === "period.closed")!.status).toBe("planned");
    expect(status.events.find((e) => e.type === "task.outcome_recorded")!.status).toBe("recorded");
    expect(status.planned.map((p) => p.name).join(" ")).toMatch(/M91/);
  });
});

describe("incoming endpoints (batch L)", () => {
  const callEp = (id: string, token: string | null, body: unknown, extra: Record<string, string> = {}) => {
    const r = request(t.app).post(`/api/inbound/${id}`); // no Origin and no cookie: like a call from viaSocket's servers
    if (token) r.set("Authorization", `Bearer ${token}`);
    for (const [k, v] of Object.entries(extra)) r.set(k, v);
    return r.send(body as object);
  };
  const create = async (cookie: string, body: Record<string, unknown>) => { const r = await post(t.app, "/api/integrations/endpoints", body, cookie); expect(r.status, JSON.stringify(r.body)).toBe(201); return r.body.data as { id: string; token: string; path: string; tokenPrefix: string }; };

  it("creating shows the token once and keeps only its hash; the token makes a task in its own organization and nowhere else; every call is audited without the token", async () => {
    const { owner } = await setup();
    const b = await signUpWithOrg(t.app, "b-owner@example.com", "Beta Co");
    const ep = await create(owner, { name: "From viaSocket", kind: "task" });
    expect(ep.token).toMatch(/^zin_[A-Za-z0-9_-]{40,}$/);
    expect(ep.path).toBe(`/api/inbound/${ep.id}`);
    const list = (await get(t.app, "/api/integrations/endpoints", owner)).body;
    expect(JSON.stringify(list)).not.toContain(ep.token);
    expect(list.data[0]).toMatchObject({ name: "From viaSocket", kind: "task", calls: 0, lastUsedAt: null, tokenPrefix: ep.token.slice(0, 8) });
    expect(JSON.stringify(t.db.prepare("SELECT * FROM inbound_endpoints").all())).not.toContain(ep.token);
    expect(one<{ token_hash: string }>("SELECT token_hash FROM inbound_endpoints").token_hash).toBe(crypto.createHash("sha256").update(ep.token).digest("hex"));
    const ok = await callEp(ep.id, ep.token, { title: "Call the customer", description: "From a flow", dueAt: day(3), priority: "high" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(one<{ title: string; organization_id: string }>("SELECT title, organization_id FROM tasks WHERE id = ?", ok.body.data.id).organization_id).toBe(one<{ id: string }>("SELECT id FROM organizations WHERE name = 'Acme'").id);
    expect((await get(t.app, "/api/tasks?limit=50", b)).body.data.tasks.map((x: { title: string }) => x.title)).not.toContain("Call the customer");
    expect((await get(t.app, "/api/integrations/endpoints", owner)).body.data[0]).toMatchObject({ calls: 1 });
    const audit = t.db.prepare("SELECT action, summary, after_json, actor_membership_id FROM audit_logs WHERE action = 'integration.inbound'").all() as { summary: string; after_json: string; actor_membership_id: string }[];
    expect(audit).toHaveLength(1);
    expect(audit[0]!.summary).toMatch(/created a task/);
    expect(JSON.stringify(audit) + t.lines.join("\n")).not.toContain(ep.token);
    // the other organization sees none of it and cannot delete it
    expect((await get(t.app, "/api/integrations/endpoints", b)).body.data).toEqual([]);
    expect((await send(t.app, "delete" as never, `/api/integrations/endpoints/${ep.id}`, undefined, b)).status).toBe(404);
  });

  it("a wrong, missing, borrowed or deleted token is a plain 401 and changes nothing; a guesser is slowed down", async () => {
    const { owner } = await setup();
    const b = await signUpWithOrg(t.app, "b-owner@example.com", "Beta Co");
    const a1 = await create(owner, { name: "One", kind: "task" });
    const a2 = await create(owner, { name: "Two", kind: "task" });
    const bEp = await create(b, { name: "Beta", kind: "task" });
    const bodies = [ (await callEp(a1.id, null, { title: "x" })), (await callEp(a1.id, "zin_wrong", { title: "x" })), (await callEp(a1.id, a2.token, { title: "x" })), (await callEp(a1.id, bEp.token, { title: "x" })), (await callEp("00000000-0000-4000-8000-000000000000", a1.token, { title: "x" })) ];
    expect((await callEp("not-a-uuid", a1.token, { title: "x" })).status).toBe(400); // a malformed address is refused before anything else
    for (const r of bodies) { expect(r.status).toBe(401); expect(r.body.error.message).toBe("The token is missing, wrong, or has been deleted."); }
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM tasks").n).toBe(0);
    // a token also works through X-Zentro-Token, and is refused after the endpoint is deleted
    expect((await callEp(a1.id, null, { title: "Via header" }, { "X-Zentro-Token": a1.token })).status).toBe(201);
    expect((await send(t.app, "delete" as never, `/api/integrations/endpoints/${a1.id}`, undefined, owner)).status).toBe(200);
    expect((await callEp(a1.id, a1.token, { title: "After delete" })).status).toBe(401);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs WHERE action = 'integration.endpoint.delete'").n).toBe(1);
    // a guesser from one address is slowed down
    let limited = 0;
    for (let i = 0; i < 30; i++) if ((await callEp(a2.id, `zin_guess_${i}`, { title: "x" })).status === 429) limited += 1;
    expect(limited).toBeGreaterThan(0);
    expect((await callEp(a2.id, a2.token, { title: "Even the right token waits" })).status).toBe(429);
  });

  it("every field is validated and nothing unknown is accepted; an endpoint takes 60 calls a minute", async () => {
    const { owner } = await setup();
    const ep = await create(owner, { name: "Tasks", kind: "task" });
    for (const body of [{}, { title: "" }, { title: "x".repeat(161) }, { title: "ok", extra: 1 }, { title: "ok", dueAt: "tomorrow" }, { title: "ok", priority: "asap" }, { title: "ok", assigneeId: "nope" }, { title: "ok", description: "d".repeat(4001) }, [1, 2], "text", { title: 5 }]) {
      const r = await callEp(ep.id, ep.token, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM tasks").n).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs WHERE action = 'integration.inbound'").n).toBeGreaterThan(0); // refusals after the token are audited too
    expect(code(await callEp(ep.id, ep.token, { title: "ok", assigneeId: "11111111-1111-4111-8111-111111111111" }))).not.toBe("internal_error"); // a person that does not exist is a plain refusal
    let limited = 0;
    for (let i = 0; i < 70; i++) if ((await callEp(ep.id, ep.token, { title: `Task ${i}` })).status === 429) limited += 1;
    expect(limited).toBeGreaterThan(0);
  });

  it("a KPI endpoint records a value only for the KPI and subject it was made for; a second value for the same month is refused; a deleted owner stops it", async () => {
    const { owner } = await setup();
    const kpi = (await post(t.app, "/api/kpis", { name: "Qualified leads", frequency: "monthly", defaultTarget: 40, unit: "leads" }, owner)).body.data.id as string;
    const other = (await post(t.app, "/api/kpis", { name: "Other KPI", frequency: "monthly" }, owner)).body.data.id as string;
    expect(code(await post(t.app, "/api/integrations/endpoints", { name: "Leads", kind: "kpi_value" }, owner))).toBe("kpi_required");
    expect((await post(t.app, "/api/integrations/endpoints", { name: "Leads", kind: "kpi_value", kpiId: "11111111-1111-4111-8111-111111111111" }, owner)).status).toBe(404);
    const ep = await create(owner, { name: "Leads", kind: "kpi_value", kpiId: kpi, subject: { type: "organization" } });
    const m = new Date(); m.setUTCDate(1); m.setUTCMonth(m.getUTCMonth() - 1);
    const periodStart = m.toISOString().slice(0, 10);
    const r = await callEp(ep.id, ep.token, { value: 42, periodStart });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data).toMatchObject({ id: kpi, kind: "kpi_value" });
    expect(one<{ kpi_id: string; value: number; source: string }>("SELECT kpi_id, value, source FROM kpi_measurements").kpi_id).toBe(kpi);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM kpi_measurements WHERE kpi_id = ?", other).n).toBe(0);
    expect(code(await callEp(ep.id, ep.token, { value: 50, periodStart }))).toBe("period_recorded"); // never overwrites
    expect((await callEp(ep.id, ep.token, { value: 1, periodStart, kpiId: other })).status).toBe(400); // the KPI cannot be chosen by the caller
    expect((await callEp(ep.id, ep.token, { value: "lots", periodStart })).status).toBe(400);
    // the person who made the endpoint leaves: the endpoint stops
    t.db.prepare("UPDATE organization_memberships SET status = 'left' WHERE work_email = 'owner@example.com'").run();
    expect(code(await callEp(ep.id, ep.token, { value: 7, periodStart: "2020-01-01" }))).toBe("endpoint_owner_not_allowed");
  });

  it("only an administrator can see or change endpoints, there are at most 20, and a name is unique", async () => {
    const { owner, max, emma } = await setup();
    for (const who of [max.cookie, emma.cookie]) {
      expect((await get(t.app, "/api/integrations/endpoints", who)).status).toBe(403);
      expect((await post(t.app, "/api/integrations/endpoints", { name: "Nope", kind: "task" }, who)).status).toBe(403);
    }
    await create(owner, { name: "Same", kind: "task" });
    expect(code(await post(t.app, "/api/integrations/endpoints", { name: "same", kind: "task" }, owner))).toBe("name_taken");
    for (let i = 0; i < 19; i++) await create(owner, { name: `Endpoint ${i}`, kind: "task" });
    expect(code(await post(t.app, "/api/integrations/endpoints", { name: "One too many", kind: "task" }, owner))).toBe("limit_reached");
    expect((await post(t.app, "/api/integrations/endpoints", { name: "x".repeat(81), kind: "task" }, owner)).status).toBe(400);
  });
});
