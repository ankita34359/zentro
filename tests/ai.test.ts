import { afterEach, describe, expect, it } from "vitest";
import { AiProviderError, AnthropicProvider, type AiCompletion, type AiCompletionRequest, type AiProvider } from "../backend/src/modules/ai/provider.js";
import type { TestApp } from "./helpers/app.js";
import { get, makeAuthApp, post, send, signUpWithOrg } from "./helpers/auth.js";
import { addPerson, roleIds } from "./helpers/roles.js";

let t: TestApp;
afterEach(() => t?.cleanup());
const one = <T>(sql: string, ...p: unknown[]) => t.db.prepare(sql).get(...p) as T;
const code = (r: { body: { error?: { code?: string } } }) => r.body.error?.code;
const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** A provider that never touches the network: it records exactly what it was given and answers (or fails) as told. */
class FakeProvider implements AiProvider {
  readonly name = "fake";
  configured = true;
  calls: AiCompletionRequest[] = [];
  next: () => Promise<AiCompletion> = async () => ({ text: "Nothing to add.", model: "fake-model", tokensIn: 10, tokensOut: 5 });
  isConfigured() { return this.configured; }
  async complete(req: AiCompletionRequest): Promise<AiCompletion> { this.calls.push(req); return this.next(); }
  sent(i = 0) { const c = this.calls[i]!; return `${c.system}\n${c.user}`; }
}

async function setup(fake = new FakeProvider()) {
  t = makeAuthApp({ aiProvider: fake });
  const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
  const ids = await roleIds(t.app, owner);
  const max = await addPerson(t.app, owner, "max@example.com", ids.manager, "Max Manager");
  const emma = await addPerson(t.app, owner, "emma@example.com", ids.employee, "Emma Employee");
  const none = await addPerson(t.app, owner, "none@example.com", undefined, "No Role");
  return { fake, owner, max, emma, none };
}
const enable = async (owner: string) => expect((await send(t.app, "put", "/api/ai/settings", { enabled: true }, owner)).status).toBe(200);
const ask = (cookie: string, question: string) => post(t.app, "/api/ai/ask", { question }, cookie);

describe("AI is off until a key is set AND an administrator switches it on (stage 7.1)", () => {
  it("with no key everything AI is disabled and says so; nothing is called; the rest of the app is unaffected", async () => {
    const fake = new FakeProvider();
    fake.configured = false;
    const { owner } = await setup(fake);
    const st = (await get(t.app, "/api/ai/status", owner)).body.data;
    expect(st).toMatchObject({ connected: false, keyConfigured: false, enabledForOrganization: false, reason: "No AI key has been added to the server yet." });
    await enable(owner); // the switch can be turned on, but without a key AI stays disabled
    expect((await get(t.app, "/api/ai/status", owner)).body.data).toMatchObject({ connected: false, keyConfigured: false, enabledForOrganization: true });
    const r = await ask(owner, "How are we doing?");
    expect(r.status).toBe(409);
    expect(code(r)).toBe("ai_not_connected");
    expect(fake.calls).toHaveLength(0);
    expect((await get(t.app, "/api/ai/insights", owner)).status).toBe(200); // the rule-based insights are untouched
    expect((await get(t.app, "/api/overview", owner)).status).toBe(200);
  });

  it("with a key but the organization switch off (the default) AI stays disabled; an administrator turns it on, audited; nobody else can", async () => {
    const { fake, owner, max, emma } = await setup();
    expect((await get(t.app, "/api/ai/status", owner)).body.data).toMatchObject({ connected: false, keyConfigured: true, enabledForOrganization: false, reason: "An administrator has not switched AI on for this organization." });
    expect(code(await ask(owner, "Hello?"))).toBe("ai_not_connected");
    for (const who of [max, emma]) expect((await send(t.app, "put", "/api/ai/settings", { enabled: true }, who.cookie)).status).toBe(403); // ai.configure is the owner's alone
    expect((await send(t.app, "put", "/api/ai/settings", { enabled: "yes" }, owner)).status).toBe(400);
    await enable(owner);
    expect((await get(t.app, "/api/ai/status", emma.cookie)).body.data).toMatchObject({ connected: true, canUse: true, canConfigure: false });
    expect((await get(t.app, "/api/ai/status", owner)).body.data.canConfigure).toBe(true);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs WHERE action = 'ai.settings'").n).toBe(1);
    expect(fake.calls).toHaveLength(0);
  });

  it("a person without the permission to use AI is refused", async () => {
    const { owner, none } = await setup();
    await enable(owner);
    expect((await get(t.app, "/api/ai/status", none.cookie)).body.data).toMatchObject({ canUse: false });
    expect((await ask(none.cookie, "Hi")).status).toBe(403);
  });
});

describe("Ask AI (stage 7.2, first version)", () => {
  it("sends only what the person may see: never another organization's data, private review notes, restricted evidence or secrets", async () => {
    const { fake, owner, max, emma } = await setup();
    await enable(owner);
    // organization A: an objective, a task, a private review note and a restricted piece of evidence about Emma
    expect((await post(t.app, "/api/objectives", { title: "Grow the Acme base", level: "company", startDate: day(-30), endDate: day(60) }, owner)).status).toBe(201);
    expect((await post(t.app, "/api/tasks", { title: "Call the Acme customers", assigneeIds: [emma.membershipId] }, owner)).status).toBe(201);
    expect((await post(t.app, "/api/hierarchy/reporting", { subordinateId: emma.membershipId, managerId: max.membershipId, startDate: day(-100) }, owner)).status).toBe(201);
    const period = (await post(t.app, "/api/performance/periods", { name: "Now", startDate: day(-60), endDate: day(30) }, owner)).body.data.id as string;
    const review = await post(t.app, "/api/performance/reviews", { periodId: period, subjectId: emma.membershipId, sharedSummary: "SHARED-SUMMARY-OK", privateNotes: "PRIVATE-NOTE-ZULU", rating: 4 }, max.cookie);
    expect(review.status, JSON.stringify(review.body)).toBe(201);
    const ev = await post(t.app, "/api/evidence", { title: "RESTRICTED-EVIDENCE-ZULU", description: "HR matter", relatedMembershipId: emma.membershipId, confidentiality: "restricted" }, owner);
    expect(ev.status, JSON.stringify(ev.body)).toBe(201);
    // organization B: its own objective, task and person
    const b = await signUpWithOrg(t.app, "b-owner@example.com", "Beta Co");
    expect((await post(t.app, "/api/objectives", { title: "BETA-SECRET-OBJECTIVE", level: "company", startDate: day(-30), endDate: day(60) }, b)).status).toBe(201);
    expect((await post(t.app, "/api/tasks", { title: "BETA-SECRET-TASK" }, b)).status).toBe(201);

    for (const who of [owner, max.cookie, emma.cookie]) {
      fake.calls = [];
      const r = await ask(who, "How are we doing?");
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const sent = fake.calls[0]!.user; // the records and the question (the fixed instructions legitimately mention the word passwords)
      for (const forbidden of ["BETA-SECRET", "Beta Co", "PRIVATE-NOTE-ZULU", "RESTRICTED-EVIDENCE-ZULU", "SHARED-SUMMARY-OK", "HR matter", "b-owner@example.com", "password", "SESSION_SECRET", "ENCRYPTION_KEY", "ANTHROPIC_API_KEY", "test-session-secret", "test-encryption-key"]) {
        expect(sent, `${forbidden} reached the AI as ${who.slice(0, 12)}`).not.toContain(forbidden);
      }
      // what the panel shows is what was sent
      expect(`<records>\n${r.body.data.sent.records}\n</records>\n\n<question>\n${r.body.data.sent.question}\n</question>`).toBe(sent);
      expect(r.body.data.sent.instructions).toBe(fake.calls[0]!.system);
      expect(JSON.stringify(r.body)).not.toContain("BETA-SECRET");
    }
    // the person's own organization's data IS what it works from
    fake.calls = [];
    await ask(owner, "How are we doing?");
    expect(fake.calls[0]!.user).toContain("Grow the Acme base");
    expect(fake.calls[0]!.user).toContain("no data"); // a new objective has no progress: never zero
  });

  it("an answer is labelled AI-generated, cites only records that were sent as links, lists what was sent, and flags figures that are not in the records", async () => {
    const { fake, owner } = await setup();
    await enable(owner);
    const o = await post(t.app, "/api/objectives", { title: "Grow the Acme base", level: "company", startDate: day(-30), endDate: day(60) }, owner);
    fake.next = async () => ({ text: "The objective has no data yet [O1]. About 73% of customers are happy [K9].", model: "fake-model", tokensIn: 100, tokensOut: 20 });
    const r = await ask(owner, "How is the Acme objective?");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = r.body.data;
    expect(d).toMatchObject({ aiGenerated: true, model: "fake-model" });
    expect(d.basedOn).toMatch(/AI-generated/);
    expect(d.basedOn).toMatch(/Based only on the records listed/);
    expect(d.citations).toEqual([{ ref: "O1", type: "objective", id: o.body.data.id, label: "Grow the Acme base", to: `/okrs?objective=${o.body.data.id}` }]); // K9 was not sent: no link
    expect(d.unmatchedNumbers).toEqual(["73"]);
    expect(d.sent.neverSent).toEqual(["private review notes", "restricted evidence", "other organizations' data", "passwords, tokens and settings"]);
    expect(d.sent.recordList.map((x: { ref: string }) => x.ref)).toContain("O1");
    expect(d.usedToday).toEqual({ you: 1, organization: 1 });
  });

  it("guard rails: question size, daily limits per person and per organization, friendly timeout and provider errors that never leak details", async () => {
    const { fake, owner, emma } = await setup();
    await enable(owner);
    expect(code(await ask(owner, "   "))).toBe("question_required");
    expect(code(await ask(owner, "x".repeat(401)))).toBe("question_too_long");
    expect(fake.calls).toHaveLength(0);
    // a timeout and a provider failure are friendly and are logged as failures; the raw error text (which here holds a fake key) is never returned
    fake.next = async () => { throw new AiProviderError("ai_timeout", "The AI service took too long. Try a shorter question or try again."); };
    const to = await ask(owner, "Slow one");
    expect(to.status).toBe(504);
    expect(code(to)).toBe("ai_timeout");
    fake.next = async () => { throw new Error("401 invalid x-api-key sk-ant-LEAKED-KEY"); };
    const bad = await ask(owner, "Broken one");
    expect(bad.status).toBe(503);
    expect(JSON.stringify(bad.body)).not.toContain("LEAKED");
    expect(JSON.stringify(t.db.prepare("SELECT * FROM ai_requests").all())).not.toContain("LEAKED");
    expect(JSON.stringify(t.db.prepare("SELECT * FROM audit_logs").all())).not.toContain("LEAKED");
    expect((t.db.prepare("SELECT status, error_code FROM ai_requests ORDER BY rowid").all() as { status: string; error_code: string }[])).toEqual([{ status: "failed", error_code: "ai_timeout" }, { status: "failed", error_code: "ai_unavailable" }]);
    // the per-person limit (20 a day): two have been used, 18 more succeed, the next is refused and not counted
    fake.next = async () => ({ text: "ok", model: "fake-model", tokensIn: 1, tokensOut: 1 });
    for (let i = 0; i < 18; i++) expect((await ask(owner, `Question ${i}`)).status).toBe(200);
    const limited = await ask(owner, "One too many");
    expect(limited.status).toBe(429);
    expect(code(limited)).toBe("ai_limit_user");
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM ai_requests WHERE status = 'blocked'").n).toBe(1);
    expect((await get(t.app, "/api/ai/status", owner)).body.data.usedToday).toEqual({ you: 20, organization: 20 });
    // the organization limit (200 a day): fill it with other people's requests and Emma is refused although she has asked nothing
    const orgId = one<{ organization_id: string }>("SELECT organization_id FROM organization_memberships WHERE id = ?", emma.membershipId).organization_id;
    const insert = t.db.prepare("INSERT INTO ai_requests (id, organization_id, membership_id, question_length, status, created_at) VALUES (?, ?, ?, 5, 'succeeded', ?)");
    for (let i = 0; i < 180; i++) insert.run(`filler-${i}`, orgId, one<{ membership_id: string }>("SELECT membership_id FROM ai_requests LIMIT 1").membership_id, new Date().toISOString());
    const orgLimited = await ask(emma.cookie, "Me too");
    expect(orgLimited.status).toBe(429);
    expect(code(orgLimited)).toBe("ai_limit_org");
  });

  it("every request is audited by its shape (who, when, question length, records, outcome) and never with the question, the answer or a key", async () => {
    const { fake, owner } = await setup();
    await enable(owner);
    expect((await post(t.app, "/api/objectives", { title: "Grow the Acme base", level: "company", startDate: day(-30), endDate: day(60) }, owner)).status).toBe(201);
    fake.next = async () => ({ text: "ANSWER-TEXT-QQQ [O1]", model: "fake-model", tokensIn: 3, tokensOut: 4 });
    const q = "QUESTION-TEXT-PPP how are we?";
    expect((await ask(owner, q)).status).toBe(200);
    const row = one<{ question_length: number; record_count: number; status: string; provider: string; model: string; tokens_in: number; records_json: string }>("SELECT * FROM ai_requests");
    expect(row).toMatchObject({ question_length: q.length, status: "succeeded", provider: "fake", model: "fake-model", tokens_in: 3 });
    expect(row.record_count).toBeGreaterThan(0);
    expect(JSON.parse(row.records_json)[0]).toMatchObject({ type: expect.any(String), id: expect.any(String) });
    const audit = one<{ action: string; actor_membership_id: string; created_at: string; summary: string }>("SELECT * FROM audit_logs WHERE action = 'ai.ask'");
    expect(audit.actor_membership_id).toBeTruthy();
    expect(audit.created_at).toBeTruthy();
    const everything = JSON.stringify([t.db.prepare("SELECT * FROM ai_requests").all(), t.db.prepare("SELECT * FROM audit_logs").all()]);
    expect(everything).not.toContain("QUESTION-TEXT-PPP");
    expect(everything).not.toContain("ANSWER-TEXT-QQQ");
  });
});

describe("The Anthropic provider", () => {
  const KEY = "sk-ant-test-FAKEKEY-123";
  const res = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

  it("sends the key only in the request header, maps failures to friendly codes without echoing bodies, and reports 'set' as a yes/no only", async () => {
    const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
    const ok = new AnthropicProvider({ ANTHROPIC_API_KEY: KEY }, (async (url: string, init: RequestInit) => { seen.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) }); return new Response(JSON.stringify({ content: [{ type: "text", text: "Hello" }], model: "m", usage: { input_tokens: 1, output_tokens: 2 } })); }) as unknown as typeof fetch);
    expect(ok.isConfigured()).toBe(true);
    expect(await ok.complete({ system: "s", user: "u", maxTokens: 10, timeoutMs: 1000 })).toEqual({ text: "Hello", model: "m", tokensIn: 1, tokensOut: 2 });
    expect(seen[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen[0]!.headers["x-api-key"]).toBe(KEY);
    expect(seen[0]!.body).not.toContain(KEY);
    expect(new AnthropicProvider({}).isConfigured()).toBe(false);
    expect(new AnthropicProvider({ ANTHROPIC_API_KEY: "   " }).isConfigured()).toBe(false);
    const failing = (status: number) => new AnthropicProvider({ ANTHROPIC_API_KEY: KEY }, res(status, { error: { message: `invalid key ${KEY}` } }) as unknown as typeof fetch);
    for (const [status, c] of [[429, "ai_busy"], [529, "ai_busy"], [401, "ai_unavailable"], [500, "ai_unavailable"]] as const) {
      const e = await failing(status).complete({ system: "s", user: "u", maxTokens: 10, timeoutMs: 1000 }).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(AiProviderError);
      expect((e as AiProviderError).code).toBe(c);
      expect((e as AiProviderError).message).not.toContain("FAKEKEY");
    }
    const slow = new AnthropicProvider({ ANTHROPIC_API_KEY: KEY }, ((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as unknown as typeof fetch);
    const e = await slow.complete({ system: "s", user: "u", maxTokens: 10, timeoutMs: 20 }).catch((x: unknown) => x);
    expect((e as AiProviderError).code).toBe("ai_timeout");
    const nokey = await new AnthropicProvider({}).complete({ system: "s", user: "u", maxTokens: 10, timeoutMs: 20 }).catch((x: unknown) => x);
    expect(nokey).toBeInstanceOf(AiProviderError);
  });

  it("the key never appears in any API response, the database or the audit log, even when a call fails", async () => {
    const provider = new AnthropicProvider({ ANTHROPIC_API_KEY: KEY }, (async () => { throw new Error(`network down for ${KEY}`); }) as unknown as typeof fetch);
    t = makeAuthApp({ aiProvider: provider });
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    await enable(owner);
    const st = await get(t.app, "/api/ai/status", owner);
    expect(st.body.data).toMatchObject({ keyConfigured: true, connected: true });
    const r = await ask(owner, "Anything?");
    expect(r.status).toBe(503);
    const integrations = await get(t.app, "/api/integrations/status", owner);
    const all = JSON.stringify([st.body, r.body, integrations.body, t.db.prepare("SELECT * FROM ai_requests").all(), t.db.prepare("SELECT * FROM audit_logs").all(), t.lines]);
    expect(all).not.toContain("FAKEKEY");
  });
});
