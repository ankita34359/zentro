import { afterEach, describe, expect, it } from "vitest";
import { keyResultAttainment, objectiveAttainment, toPercent } from "../backend/src/modules/okr/attainment.js";
import { ORIGIN, type TestApp } from "./helpers/app.js";
import { get, makeAuthApp, post, signUpWithOrg } from "./helpers/auth.js";
import { addPerson, roleIds } from "./helpers/roles.js";
import request from "supertest";

let t: TestApp;
afterEach(() => t?.cleanup());

const send = (method: "patch" | "delete", path: string, body: Record<string, unknown> | undefined, cookie: string) => {
  const r = request(t.app)[method](path).set("Origin", ORIGIN).set("Cookie", cookie);
  return body ? r.send(body) : r;
};
const created = async (path: string, body: Record<string, unknown>, cookie: string): Promise<string> => {
  const r = await post(t.app, path, body, cookie);
  expect(r.status, `${path} ${JSON.stringify(r.body)}`).toBe(201);
  return r.body.data.id as string;
};
const year = { startDate: "2026-01-01", endDate: "2026-12-31" };

describe("attainment math (golden values)", () => {
  const kr = (o: Partial<Parameters<typeof keyResultAttainment>[0]>) => ({ direction: "increase" as const, method: "linear" as const, start: 0, target: 100, current: 50 as number | null, weight: 1, ...o });
  it("increase, decrease, yes-or-no and manual percentages", () => {
    expect(keyResultAttainment(kr({ current: 50 })).value).toBe(0.5);
    expect(keyResultAttainment(kr({ start: 20, target: 120, current: 70 })).value).toBe(0.5);
    expect(keyResultAttainment(kr({ direction: "decrease", start: 10, target: 2, current: 6 })).value).toBe(0.5);
    expect(keyResultAttainment(kr({ method: "binary", start: 0, target: 1, current: 1 })).value).toBe(1);
    expect(keyResultAttainment(kr({ method: "binary", start: 0, target: 1, current: 0 })).value).toBe(0);
    expect(keyResultAttainment(kr({ method: "manual", current: 35 })).value).toBeCloseTo(0.35);
  });
  it("no recorded value is NO DATA, never zero; going backwards is floored and flagged; going beyond is capped and flagged", () => {
    expect(keyResultAttainment(kr({ current: null }))).toEqual({ value: null, regressed: false, degenerate: false, capped: false });
    expect(keyResultAttainment(kr({ current: 0 })).value).toBe(0);
    expect(keyResultAttainment(kr({ current: -10 }))).toMatchObject({ value: 0, regressed: true });
    expect(keyResultAttainment(kr({ current: 180 }))).toMatchObject({ value: 1, capped: true });
    expect(keyResultAttainment(kr({ current: 180 }), 1.5).value).toBe(1.5);
  });
  it("a target equal to the start is flagged and never divides by zero", () => {
    const a = keyResultAttainment(kr({ start: 5, target: 5, current: 5 }));
    expect(a).toMatchObject({ value: 1, degenerate: true });
    expect(Number.isFinite(a.value as number)).toBe(true);
  });
  it("an objective is the weighted mean of the key results that HAVE data, and says how much data it has", () => {
    expect(objectiveAttainment([])).toMatchObject({ value: null, dataState: "none" });
    expect(objectiveAttainment([{ attainment: null, weight: 1 }])).toMatchObject({ value: null, dataState: "none" });
    expect(objectiveAttainment([{ attainment: 1, weight: 3 }, { attainment: 0, weight: 1 }])).toMatchObject({ value: 0.75, dataState: "ok", coverage: 1 });
    const part = objectiveAttainment([{ attainment: 1, weight: 1 }, { attainment: null, weight: 3 }]);
    expect(part).toMatchObject({ value: 1, dataState: "insufficient", withData: 1, total: 2 });
    expect(part.coverage).toBeCloseTo(0.25);
    expect(toPercent(0.745)).toBe(75);
    expect(toPercent(null)).toBeNull();
  });
});

describe("objectives and key results (stage 3.1)", () => {
  it("creates an objective with key results, shows null (not 0) until a value is recorded, then computes from the actual values", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const r = await post(t.app, "/api/objectives", { level: "company", title: "Grow the business", ...year, keyResults: [{ title: "Revenue", unit: "$", startValue: 100, targetValue: 200 }, { title: "Churn", direction: "decrease", startValue: 10, targetValue: 5, weight: 3 }] }, owner);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const o = r.body.data;
    expect(o).toMatchObject({ level: "company", lifecycle: "active", attainmentPct: null, dataState: "none", keyResultCount: 2, can: { edit: true, publish: true } });
    expect(o.keyResults.map((k: { attainmentPct: number | null }) => k.attainmentPct)).toEqual([null, null]);
    const [rev, churn] = o.keyResults as { id: string }[];
    const a = await post(t.app, `/api/key-results/${rev!.id}/progress`, { value: 150, note: "Q1 close" }, owner);
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body.data).toMatchObject({ attainmentPct: 50, dataState: "insufficient" }); // only the weight-1 result of weight 4 has data
    const b = await post(t.app, `/api/key-results/${churn!.id}/progress`, { value: 7.5 }, owner);
    expect(b.body.data).toMatchObject({ attainmentPct: 50, dataState: "ok" });
    const detail = (await get(t.app, `/api/objectives/${o.id}`, owner)).body.data;
    expect(detail.attainmentPct).toBe(50);
    // history is append only and a correction names the value it replaces
    await post(t.app, `/api/key-results/${rev!.id}/progress`, { value: 180 }, owner);
    const hist = (await get(t.app, `/api/objectives/${o.id}/history`, owner)).body.data as { keyResultId: string; value: number; source: string; note: string | null }[];
    expect(hist.filter((h) => h.keyResultId === rev!.id).map((h) => h.value)).toEqual([150, 180]);
    const rows = t.db.prepare("SELECT id, supersedes_id FROM objective_progress_history WHERE key_result_id = ? ORDER BY recorded_at, rowid").all(rev!.id) as { id: string; supersedes_id: string | null }[];
    expect(rows[1]!.supersedes_id).toBe(rows[0]!.id);
    expect(t.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action = 'key_result.progress'").get()).toEqual({ n: 3 });
    expect(t.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action = 'objective.create'").get()).toEqual({ n: 1 });
  });

  it("refuses nonsense: a target equal to the start, the wrong direction, a bad date, a yes-or-no value of 7, progress on a draft", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const bad = async (kr: Record<string, unknown>) => (await post(t.app, "/api/objectives", { level: "company", title: "O", ...year, keyResults: [kr] }, owner));
    expect((await bad({ title: "k", startValue: 5, targetValue: 5 })).body.error.code).toBe("target_equals_start");
    expect((await bad({ title: "k", startValue: 10, targetValue: 5 })).body.error.code).toBe("wrong_direction");
    expect((await bad({ title: "k", direction: "decrease", startValue: 5, targetValue: 10 })).body.error.code).toBe("wrong_direction");
    expect((await post(t.app, "/api/objectives", { level: "company", title: "O", startDate: "2026-12-31", endDate: "2026-01-01" }, owner)).body.error.code).toBe("invalid_date");
    expect((await post(t.app, "/api/objectives", { level: "company", title: "O", startDate: "2026-02-30", endDate: "2026-12-31" }, owner)).body.error.code).toBe("invalid_date");
    const o = (await post(t.app, "/api/objectives", { level: "company", title: "Yes or no", ...year, lifecycle: "draft", keyResults: [{ title: "Ship it", measurementType: "boolean", targetValue: 1 }] }, owner)).body.data;
    const k = o.keyResults[0].id as string;
    expect((await post(t.app, `/api/key-results/${k}/progress`, { value: 1 }, owner)).body.error.code).toBe("objective_not_active");
    await send("patch", `/api/objectives/${o.id}`, { lifecycle: "active" }, owner);
    expect((await post(t.app, `/api/key-results/${k}/progress`, { value: 7 }, owner)).body.error.code).toBe("invalid_value");
    expect((await post(t.app, `/api/key-results/${k}/progress`, { value: 1 }, owner)).body.data.attainmentPct).toBe(100);
  });

  it("the lifecycle follows its moves and changing a target is written to the history", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const o = (await post(t.app, "/api/objectives", { level: "company", title: "Life", ...year, keyResults: [{ title: "k", targetValue: 100 }] }, owner)).body.data;
    expect(o.nextLifecycles).toEqual(["draft", "completed", "cancelled"]);
    expect((await send("patch", `/api/objectives/${o.id}`, { lifecycle: "completed" }, owner)).body.data.lifecycle).toBe("completed");
    expect((await send("patch", `/api/objectives/${o.id}`, { lifecycle: "draft" }, owner)).body.error.code).toBe("invalid_transition");
    expect((await post(t.app, `/api/objectives/${o.id}/key-results`, { title: "late", targetValue: 5 }, owner)).body.error.code).toBe("objective_closed");
    await send("patch", `/api/objectives/${o.id}`, { lifecycle: "active" }, owner);
    await post(t.app, `/api/key-results/${o.keyResults[0].id}/progress`, { value: 50 }, owner);
    const up = await send("patch", `/api/key-results/${o.keyResults[0].id}`, { targetValue: 200 }, owner);
    expect(up.body.data.keyResults[0]).toMatchObject({ targetValue: 200, attainmentPct: 25 });
    const hist = (await get(t.app, `/api/objectives/${o.id}/history`, owner)).body.data as { source: string }[];
    expect(hist.map((h) => h.source)).toEqual(["manual", "target_change"]);
    expect(t.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action = 'objective.lifecycle'").get()).toEqual({ n: 2 });
  });

  it("scope: a department objective needs a department in scope; employees see their own and published ones, never others' drafts", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ids = await roleIds(t.app, owner);
    const eng = await created("/api/departments", { name: "Engineering" }, owner);
    const emp = await addPerson(t.app, owner, "emp@example.com", ids.employee, "Emma Employee");
    const other = await addPerson(t.app, owner, "other@example.com", ids.employee, "Olly Other");
    // an employee may create personal objectives only
    expect((await post(t.app, "/api/objectives", { level: "company", title: "Nope", ...year }, emp.cookie)).status).toBe(403);
    expect((await post(t.app, "/api/objectives", { level: "department", departmentId: eng, title: "Nope", ...year }, emp.cookie)).status).toBe(403);
    expect((await post(t.app, "/api/objectives", { level: "individual", ownerId: other.membershipId, title: "For someone else", ...year }, emp.cookie)).status).toBe(403);
    const mine = (await post(t.app, "/api/objectives", { level: "individual", title: "Learn Rust", ...year, keyResults: [{ title: "Chapters", targetValue: 10 }] }, emp.cookie));
    expect(mine.status, JSON.stringify(mine.body)).toBe(201);
    expect(mine.body.data.owner.id).toBe(emp.membershipId);
    // others do not see it; the Owner does; recording on it as the owner of the objective works
    expect((await get(t.app, "/api/objectives", other.cookie)).body.data).toEqual([]);
    expect((await get(t.app, `/api/objectives/${mine.body.data.id}`, other.cookie)).status).toBe(404);
    expect((await get(t.app, "/api/objectives", owner)).body.data).toHaveLength(1);
    expect((await post(t.app, `/api/key-results/${mine.body.data.keyResults[0].id}/progress`, { value: 3 }, emp.cookie)).status).toBe(201);
    expect((await post(t.app, `/api/key-results/${mine.body.data.keyResults[0].id}/progress`, { value: 3 }, other.cookie)).status).toBe(404);
    // publishing: only okr.publish, never a draft; once published everyone can read it but not change it
    const co = (await post(t.app, "/api/objectives", { level: "company", title: "Company goal", ...year }, owner)).body.data;
    expect((await get(t.app, "/api/objectives", other.cookie)).body.data).toEqual([]);
    expect((await post(t.app, `/api/objectives/${co.id}/publish`, { published: true }, other.cookie)).status).toBe(403);
    expect((await post(t.app, `/api/objectives/${co.id}/publish`, { published: true }, owner)).body.data.published).toBe(true);
    expect((await get(t.app, "/api/objectives", other.cookie)).body.data.map((x: { title: string }) => x.title)).toEqual(["Company goal"]);
    expect((await send("patch", `/api/objectives/${co.id}`, { title: "Hijack" }, other.cookie)).status).toBe(403);
    const draft = (await post(t.app, "/api/objectives", { level: "company", title: "Secret draft", ...year, lifecycle: "draft" }, owner)).body.data;
    expect((await post(t.app, `/api/objectives/${draft.id}/publish`, { published: true }, owner)).body.error.code).toBe("draft_not_publishable");
    expect((await get(t.app, `/api/objectives/${draft.id}`, other.cookie)).status).toBe(404);
  });

  it("archiving needs okr.archive, refuses while open tasks are linked, and archived objectives leave the list", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const o = (await post(t.app, "/api/objectives", { level: "company", title: "Old goal", ...year, keyResults: [{ title: "k", targetValue: 10 }] }, owner)).body.data;
    const task = await created("/api/tasks", { title: "Linked work" }, owner);
    expect((await send("patch", `/api/tasks/${task}`, { objectiveId: o.id, keyResultId: o.keyResults[0].id }, owner)).status).toBe(200);
    expect((await send("delete", `/api/objectives/${o.id}`, undefined, owner)).body.error.code).toBe("has_open_tasks");
    await post(t.app, `/api/tasks/${task}/updates`, { type: "status_change", toStatus: "cancelled" }, owner);
    expect((await send("delete", `/api/objectives/${o.id}`, undefined, owner)).status).toBe(200);
    expect((await get(t.app, "/api/objectives", owner)).body.data).toEqual([]);
    expect((await get(t.app, "/api/objectives?includeArchived=true", owner)).body.data).toHaveLength(1);
    expect(t.db.prepare("SELECT COUNT(*) n FROM objectives").get()).toEqual({ n: 1 }); // archived, never deleted
  });
});
