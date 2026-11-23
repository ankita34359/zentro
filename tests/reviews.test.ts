import { afterEach, describe, expect, it } from "vitest";
import type { TestApp } from "./helpers/app.js";
import { get, makeAuthApp, post, send, signUpWithOrg } from "./helpers/auth.js";
import { addPerson, roleIds } from "./helpers/roles.js";

let t: TestApp;
afterEach(() => t?.cleanup());

const one = <T>(sql: string, ...p: unknown[]) => t.db.prepare(sql).get(...p) as T;
const code = (r: { body: { error?: { code?: string } } }) => r.body.error?.code;
const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** Max (manager role) has Rae and Sam as direct reports; Zed is nobody's report. */
async function setup() {
  t = makeAuthApp();
  const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
  const ids = await roleIds(t.app, owner);
  const max = await addPerson(t.app, owner, "max@example.com", ids.manager, "Max Manager");
  const rae = await addPerson(t.app, owner, "rae@example.com", ids.employee, "Rae Report");
  const sam = await addPerson(t.app, owner, "sam@example.com", ids.employee, "Sam Report");
  const zed = await addPerson(t.app, owner, "zed@example.com", ids.employee, "Zed Other");
  const mia = await addPerson(t.app, owner, "mia@example.com", ids.manager, "Mia Manager");
  for (const who of [rae, sam]) expect((await post(t.app, "/api/hierarchy/reporting", { subordinateId: who.membershipId, managerId: max.membershipId, startDate: day(-200) }, owner)).status).toBe(201);
  const period = (await post(t.app, "/api/performance/periods", { name: "Now", startDate: day(-60), endDate: day(30) }, owner)).body.data.id as string;
  return { owner, max, rae, sam, zed, mia, period };
}
const review = (cookie: string, periodId: string, subjectId: string, extra: Record<string, unknown> = {}) => post(t.app, "/api/performance/reviews", { periodId, subjectId, sharedSummary: "Strong quarter.", developmentFocus: "Own a bigger piece.", privateNotes: "Worth a stretch role. Do not share.", rating: 4, ...extra }, cookie);
const list = (cookie: string, periodId: string, q = "") => get(t.app, `/api/performance/reviews?periodId=${periodId}${q}`, cookie);

describe("Reviews with private notes (stage 5.6)", () => {
  it("a manager writes a draft for a report: only the author sees it; the person reviewed and others see nothing until it is submitted", async () => {
    const { owner, max, rae, period } = await setup();
    const r = await review(max.cookie, period, rae.membershipId);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data).toMatchObject({ status: "draft", rating: 4, sharedSummary: "Strong quarter.", privateNotes: "Worth a stretch role. Do not share.", can: { edit: true, acknowledge: false } });
    expect((await list(max.cookie, period)).body.data).toHaveLength(1);
    expect((await list(rae.cookie, period)).body.data).toEqual([]); // a draft is the author's alone
    expect((await list(owner, period)).body.data).toEqual([]); // even the owner does not read drafts
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs WHERE action = 'review.create'").n).toBe(1);
  });

  it("once submitted, the person reads the summary and development focus of their own review, and NEVER the private notes (the field is absent)", async () => {
    const { owner, max, rae, period } = await setup();
    const id = (await review(max.cookie, period, rae.membershipId)).body.data.id as string;
    const sub = await send(t.app, "patch", `/api/performance/reviews/${id}`, { submit: true }, max.cookie);
    expect(sub.body.data.status).toBe("submitted");
    const mine = (await list(rae.cookie, period)).body.data[0];
    expect(mine).toMatchObject({ sharedSummary: "Strong quarter.", developmentFocus: "Own a bigger piece.", status: "submitted", can: { edit: false, acknowledge: true }, reviewer: { name: "Max Manager" } });
    expect("privateNotes" in mine).toBe(false);
    expect(JSON.stringify((await list(rae.cookie, period)).body)).not.toMatch(/stretch role|Do not share/);
    // the author still has them; the owner (read_shared and read_private over everyone) sees them too
    expect((await list(max.cookie, period)).body.data[0].privateNotes).toBe("Worth a stretch role. Do not share.");
    expect((await list(owner, period)).body.data[0].privateNotes).toBe("Worth a stretch role. Do not share.");
  });

  it("who else reads it: a person with no review permission over them sees nothing; a manager with read_shared but not read_private sees the summary and no notes", async () => {
    const { owner, max, rae, zed, mia, period } = await setup();
    const id = (await review(max.cookie, period, rae.membershipId)).body.data.id as string;
    await send(t.app, "patch", `/api/performance/reviews/${id}`, { submit: true }, max.cookie);
    expect((await list(zed.cookie, period)).body.data).toEqual([]); // a colleague
    expect((await list(zed.cookie, period, `&subjectId=${rae.membershipId}`)).body.data).toEqual([]);
    expect((await list(mia.cookie, period)).body.data).toEqual([]); // another manager, Rae does not report to her
    // give Mia a reporting line over Rae: she may now read the shared parts, but not the private notes
    await post(t.app, "/api/hierarchy/reporting", { subordinateId: rae.membershipId, managerId: mia.membershipId, type: "secondary", startDate: day(-30) }, owner);
    const seen = (await list(mia.cookie, period)).body.data;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ sharedSummary: "Strong quarter.", status: "submitted", can: { edit: false, acknowledge: false } });
    expect("privateNotes" in seen[0]).toBe(false); // read_private is a separate permission nobody holds by default
  });

  it("permissions and rules: employees cannot write; only for people in scope; never yourself; one per person and period; bad ratings refused", async () => {
    const { max, rae, zed, period } = await setup();
    expect((await review(rae.cookie, period, zed.membershipId)).status).toBe(403);
    const outside = await review(max.cookie, period, zed.membershipId);
    expect(outside.status).toBe(403);
    expect(code(outside)).toBe("outside_scope");
    expect(code(await review(max.cookie, period, max.membershipId))).toBeDefined();
    expect((await review(max.cookie, period, rae.membershipId)).status).toBe(201);
    expect(code(await review(max.cookie, period, rae.membershipId))).toBe("exists");
    expect(code(await review(max.cookie, period, rae.membershipId, { rating: 9 }))).toBeDefined();
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM performance_reviews").n).toBe(1);
  });

  it("submitting needs a summary; only the author edits (anyone else gets 404); the person acknowledges, and then it is locked", async () => {
    const { max, rae, sam, period } = await setup();
    const blank = await review(max.cookie, period, rae.membershipId, { sharedSummary: "", submit: true });
    expect(code(blank)).toBe("summary_required");
    const id = (await review(max.cookie, period, rae.membershipId, { sharedSummary: "Good." })).body.data.id as string;
    expect((await send(t.app, "patch", `/api/performance/reviews/${id}`, { sharedSummary: "Hacked" }, sam.cookie)).status).toBe(403);
    expect(code(await post(t.app, `/api/performance/reviews/${id}/acknowledge`, undefined, rae.cookie))).toBe("not_found"); // a draft cannot be acknowledged
    await send(t.app, "patch", `/api/performance/reviews/${id}`, { submit: true }, max.cookie);
    expect((await post(t.app, `/api/performance/reviews/${id}/acknowledge`, undefined, sam.cookie)).status).toBe(404); // not their review
    const ack = await post(t.app, `/api/performance/reviews/${id}/acknowledge`, undefined, rae.cookie);
    expect(ack.body.data).toMatchObject({ status: "acknowledged", can: { acknowledge: false } });
    expect(code(await post(t.app, `/api/performance/reviews/${id}/acknowledge`, undefined, rae.cookie))).toBe("already_acknowledged");
    expect(code(await send(t.app, "patch", `/api/performance/reviews/${id}`, { sharedSummary: "Later" }, max.cookie))).toBe("acknowledged");
  });

  it("the audit log says a review was written, never what it said", async () => {
    const { owner, max, rae, period } = await setup();
    const id = (await review(max.cookie, period, rae.membershipId)).body.data.id as string;
    await send(t.app, "patch", `/api/performance/reviews/${id}`, { submit: true, privateNotes: "A very secret remark" }, max.cookie);
    const rows = t.db.prepare("SELECT summary, before_json, after_json FROM audit_logs WHERE action LIKE 'review.%'").all() as { summary: string; before_json: string | null; after_json: string | null }[];
    expect(rows.length).toBe(2);
    expect(JSON.stringify(rows)).not.toMatch(/secret remark|Worth a stretch|Strong quarter/);
    expect(JSON.stringify((await get(t.app, "/api/audit-logs?limit=50", owner)).body)).not.toMatch(/secret remark|Worth a stretch/);
  });
});

describe("Management responsibilities from reviews (stage 5.6)", () => {
  it("a manager's score counts reviews written for their direct reports: 1 of 2 on time → 50, in a closed period", async () => {
    const { owner, max, rae, period } = await setup();
    // a Manager model scored on that one thing
    const models = (await get(t.app, "/api/performance/models", owner)).body.data as { id: string; name: string }[];
    const des = (await post(t.app, "/api/designations", { name: "People manager" }, owner)).body.data.id as string;
    expect((await post(t.app, `/api/employees/${max.membershipId}/designation`, { designationId: des, startDate: day(-300) }, owner)).status).toBe(200);
    const draft = await send(t.app, "patch", `/api/performance/models/${models.find((m) => m.name === "Manager")!.id}`, { designationId: des, components: [{ key: "mgmt", label: "Management responsibilities", weight: 100, providerKey: "mgmt.responsibilities", minSample: 1 }] }, owner);
    expect(draft.status, JSON.stringify(draft.body)).toBe(200);
    expect((await post(t.app, `/api/performance/models/${draft.body.data.id}/activate`, undefined, owner)).status).toBe(200);
    // before anything is written, in a still-open period: not scored, not a zero
    await post(t.app, "/api/performance/scorecards/recalculate", { periodId: period, subjectId: max.membershipId }, owner);
    const open = (await get(t.app, `/api/performance/scorecards/for?periodId=${period}&subjectId=${max.membershipId}`, owner)).body.data.latest;
    expect(open.components[0]).toMatchObject({ state: "missing", score: null });
    expect(open.total).toBeNull();
    // Rae gets a submitted review, Sam none; the period closes
    const id = (await review(max.cookie, period, rae.membershipId)).body.data.id as string;
    await send(t.app, "patch", `/api/performance/reviews/${id}`, { submit: true }, max.cookie);
    expect((await post(t.app, `/api/performance/periods/${period}/close`, undefined, owner)).status).toBe(200);
    const closed = (await get(t.app, `/api/performance/scorecards/for?periodId=${period}&subjectId=${max.membershipId}`, owner)).body.data.latest;
    expect(closed.components[0]).toMatchObject({ state: "ok", score: 50 });
    expect(closed.components[0].contributors[0].label).toMatch(/on time for 1 of 2 direct reports/);
    expect(closed.components[0].notes.join(" ")).toMatch(/One-to-one cadence and blocker resolution are not measured yet/);
  });
});
