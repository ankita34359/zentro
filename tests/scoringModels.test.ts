import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { ORIGIN, type TestApp } from "./helpers/app.js";
import { get, makeAuthApp, post, signUpWithOrg } from "./helpers/auth.js";
import { addPerson, roleIds } from "./helpers/roles.js";

let t: TestApp;
afterEach(() => t?.cleanup());

const send = (method: "patch" | "put" | "delete", path: string, body: Record<string, unknown> | undefined, cookie: string) => {
  const r = request(t.app)[method](path).set("Origin", ORIGIN).set("Cookie", cookie);
  return body ? r.send(body) : r;
};
const one = <T>(sql: string, ...p: unknown[]) => t.db.prepare(sql).get(...p) as T;
const code = (r: { body: { error?: { code?: string } } }) => r.body.error?.code;
type Model = { id: string; name: string; version: number; status: string; isDefault: boolean; weightTotal: number; problems: string[]; components: { key: string; label: string; weight: number; providerKey: string; minSample: number }[] };
const models = async (cookie: string, q = ""): Promise<Model[]> => (await get(t.app, `/api/performance/models${q}`, cookie)).body.data;

async function setup() {
  t = makeAuthApp();
  const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
  const ids = await roleIds(t.app, owner);
  const mgr = await addPerson(t.app, owner, "mgr@example.com", ids.manager, "Max Manager");
  const emp = await addPerson(t.app, owner, "emp@example.com", ids.employee, "Emma Employee");
  return { owner, mgr, emp };
}

describe("Scoring models (stage 5.1)", () => {
  it("the standard models are added the first time scoring is opened: eight, all active, weights 100, Employee is the default", async () => {
    const { owner } = await setup();
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM scoring_models").n).toBe(0);
    const list = await models(owner);
    expect(list.map((m) => m.name).sort()).toEqual(["CEO", "Department head", "Employee", "Intern", "Manager", "Mentor", "Senior management", "Team lead"]);
    expect(list.every((m) => m.status === "active" && m.version === 1 && m.weightTotal === 100 && m.problems.length === 0)).toBe(true);
    expect(list.filter((m) => m.isDefault).map((m) => m.name)).toEqual(["Employee"]);
    expect(list.find((m) => m.name === "Employee")!.components.map((c) => [c.label, c.weight])).toEqual([["OKR achievement", 40], ["KPI achievement", 30], ["Delivery and reliability", 15], ["Quality and business impact", 15]]);
    await models(owner); // a second look adds nothing
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM scoring_models").n).toBe(8);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs WHERE action = 'scoring.seed'").n).toBe(1);
    // the CEO model contains no task-based measure
    expect(list.find((m) => m.name === "CEO")!.components.map((c) => c.providerKey)).not.toContain("tasks.delivery");
  });

  it("the what-if calculator: 85/90/80/90 → 86.5; no KPI → 85.0, provisional, 70% coverage; only one component → insufficient; nothing is stored", async () => {
    const { owner } = await setup();
    const emp = (await models(owner)).find((m) => m.name === "Employee")!;
    const run = async (values: Record<string, number | null>, periodClosed = true) => (await post(t.app, "/api/performance/models/preview", { modelId: emp.id, values, periodClosed }, owner)).body.data;
    const a = await run({ okr: 85, kpi: 90, delivery: 80, quality: 90 });
    expect(a).toMatchObject({ total: 86.5, status: "final", weightCoverage: 1 });
    expect(a.explanation.formula).toBe("(85.0 × 0.40) + (90.0 × 0.30) + (80.0 × 0.15) + (90.0 × 0.15) = 86.5");
    const b = await run({ okr: 85, kpi: null, delivery: 80, quality: 90 });
    expect(b).toMatchObject({ total: 85, status: "provisional" });
    expect(b.weightCoverage).toBeCloseTo(0.7);
    expect(b.components.find((c: { key: string }) => c.key === "kpi")).toMatchObject({ state: "missing", points: null });
    const c = await run({ okr: null, kpi: null, delivery: null, quality: 90 });
    expect(c).toMatchObject({ total: null, status: "insufficient" });
    expect((await run({ okr: 85, kpi: 90, delivery: 80, quality: 90 }, false)).status).toBe("provisional"); // the period is still open
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs WHERE action LIKE 'scoring.%' AND action <> 'scoring.seed'").n).toBe(0); // a dry run leaves nothing behind
    expect((await post(t.app, "/api/performance/models/preview", { modelId: emp.id, values: { okr: "x" } }, owner)).status).toBe(400);
  });

  it("editing creates a version: an active model gets a draft v2, the old one stays; weights must add up to 100 to activate, then v1 is retired", async () => {
    const { owner } = await setup();
    const emp = (await models(owner)).find((m) => m.name === "Employee")!;
    const comps = emp.components.map((c) => ({ key: c.key, label: c.label, weight: c.weight, providerKey: c.providerKey, minSample: c.minSample }));
    const bad = await send("patch", `/api/performance/models/${emp.id}`, { components: comps.map((c) => (c.key === "okr" ? { ...c, weight: 50 } : c)) }, owner);
    expect(bad.status).toBe(200);
    expect(bad.body.data).toMatchObject({ version: 2, status: "draft", weightTotal: 110 });
    expect(bad.body.data.problems[0]).toMatch(/add up to 110, not 100/);
    const draft = bad.body.data.id as string;
    expect(code(await post(t.app, `/api/performance/models/${draft}/activate`, undefined, owner))).toBe("model_invalid");
    expect(code(await send("patch", `/api/performance/models/${emp.id}`, { name: "x" }, owner))).toBe("draft_exists");
    // fix the draft in place (it is a draft: no third version), then activate
    const fixed = await send("patch", `/api/performance/models/${draft}`, { components: comps.map((c) => (c.key === "okr" ? { ...c, weight: 50 } : c.key === "kpi" ? { ...c, weight: 20 } : c)) }, owner);
    expect(fixed.body.data).toMatchObject({ version: 2, status: "draft", weightTotal: 100, problems: [] });
    const active = await post(t.app, `/api/performance/models/${draft}/activate`, undefined, owner);
    expect(active.status, JSON.stringify(active.body)).toBe(200);
    const all = await models(owner, "?includeRetired=true");
    expect(all.filter((m) => m.name === "Employee").map((m) => [m.version, m.status])).toEqual([[2, "active"], [1, "retired"]]);
    expect(await models(owner)).toHaveLength(8); // retired versions are hidden unless asked for
    expect(code(await post(t.app, `/api/performance/models/${draft}/activate`, undefined, owner))).toBe("already_active");
    expect(code(await post(t.app, `/api/performance/models/${emp.id}/activate`, undefined, owner))).toBe("retired");
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM scoring_model_components WHERE scoring_model_id = ?", emp.id).n).toBe(4); // the old version is untouched
    expect((t.db.prepare("SELECT action FROM audit_logs WHERE action LIKE 'scoring.model%' ORDER BY rowid").all() as { action: string }[]).map((r) => r.action)).toEqual(["scoring.model_update", "scoring.model_update", "scoring.model_activate"]);
  });

  it("creates a model from a template (a draft), refuses a name in use, an unknown template and an unknown measure", async () => {
    const { owner } = await setup();
    const made = await post(t.app, "/api/performance/models", { templateKey: "model_ceo", name: "Founder" }, owner);
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.data).toMatchObject({ name: "Founder", status: "draft", version: 1, templateKey: "model_ceo" });
    expect(code(await post(t.app, "/api/performance/models", { templateKey: "model_ceo", name: "founder" }, owner))).toBe("name_taken");
    expect(code(await post(t.app, "/api/performance/models", { templateKey: "nope" }, owner))).toBe("unknown_template");
    const bad = await send("patch", `/api/performance/models/${made.body.data.id}`, { components: [{ key: "a", label: "A", weight: 100, providerKey: "made.up" }] }, owner);
    expect(bad.body.data.problems[0]).toMatch(/does not exist/);
    expect((await get(t.app, "/api/performance/models/templates", owner)).body.data).toHaveLength(8);
  });

  it("permissions: only people who may configure change models; managers may read them; employees and people with no role may not", async () => {
    const { owner, mgr, emp } = await setup();
    const list = await models(owner);
    const e = list.find((m) => m.name === "Employee")!;
    expect((await get(t.app, "/api/performance/models", mgr.cookie)).status).toBe(200);
    expect((await get(t.app, `/api/performance/models/${e.id}`, mgr.cookie)).status).toBe(200);
    expect((await get(t.app, "/api/performance/models", emp.cookie)).status).toBe(403);
    expect((await post(t.app, "/api/performance/models", { templateKey: "model_ceo" }, mgr.cookie)).status).toBe(403);
    expect((await send("patch", `/api/performance/models/${e.id}`, { name: "Hacked" }, mgr.cookie)).status).toBe(403);
    expect((await post(t.app, `/api/performance/models/${e.id}/activate`, undefined, mgr.cookie)).status).toBe(403);
    expect((await post(t.app, "/api/performance/models/preview", { modelId: e.id, values: {} }, mgr.cookie)).status).toBe(403);
  });
});
