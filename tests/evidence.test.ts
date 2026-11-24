import { afterEach, describe, expect, it } from "vitest";
import type { TestApp } from "./helpers/app.js";
import { get, makeAuthApp, post, signUpWithOrg } from "./helpers/auth.js";
import { addPerson, roleIds } from "./helpers/roles.js";

let t: TestApp;
afterEach(() => t?.cleanup());
const code = (r: { body: { error?: { code?: string } } }) => r.body.error?.code;
const one = <T>(sql: string, ...p: unknown[]) => t.db.prepare(sql).get(...p) as T;
const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");

/** Owner, a manager (Max) with Emma and Sam as reports, an unrelated employee (Zed), and a task of Emma's. */
async function setup() {
  t = makeAuthApp();
  const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
  const ids = await roleIds(t.app, owner);
  const max = await addPerson(t.app, owner, "max@example.com", ids.manager, "Max Manager");
  const emma = await addPerson(t.app, owner, "emma@example.com", ids.employee, "Emma Employee");
  const zed = await addPerson(t.app, owner, "zed@example.com", ids.employee, "Zed Other");
  expect((await post(t.app, "/api/hierarchy/reporting", { subordinateId: emma.membershipId, managerId: max.membershipId, startDate: day(-100) }, owner)).status).toBe(201);
  const task = (await post(t.app, "/api/tasks", { title: "Ship the report", assigneeIds: [emma.membershipId] }, owner)).body.data.id as string;
  return { owner, max, emma, zed, task };
}
const attach = (cookie: string, body: Record<string, unknown>) => post(t.app, "/api/evidence", { title: "Release notes", externalRef: "https://example.com/notes", ...body }, cookie);

describe("Evidence (stage 4.3)", () => {
  it("an employee attaches a link to their own task; it is listed behind the task, audited, and not verified yet", async () => {
    const { emma, task } = await setup();
    const r = await attach(emma.cookie, { evidenceType: "document", links: [{ type: "task", id: task }] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data).toMatchObject({ title: "Release notes", type: "document", confidentiality: "scope", verification: { status: "unverified" }, links: [{ type: "task", id: task }], submittedBy: { name: "Emma Employee" } });
    const behind = (await get(t.app, `/api/evidence?targetType=task&targetId=${task}`, emma.cookie)).body.data;
    expect(behind).toHaveLength(1);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs WHERE action = 'evidence.create'").n).toBe(1);
  });

  it("validates: a link must be http(s), the title is required, a record that does not exist or is not visible is 404, nothing is written on a refusal", async () => {
    const { emma, zed, task } = await setup();
    expect(code(await attach(emma.cookie, { externalRef: "javascript:alert(1)" }))).toBe("invalid_link");
    expect((await attach(emma.cookie, { title: "" })).status).toBe(400);
    expect((await attach(emma.cookie, { links: [{ type: "task", id: "00000000-0000-4000-8000-000000000000" }] })).status).toBe(404);
    expect((await attach(zed.cookie, { links: [{ type: "task", id: task }] })).status).toBe(404); // Zed cannot see Emma's task, so cannot attach to it
    expect(code(await attach(emma.cookie, { occurredOn: day(3) }))).toBe("invalid_date");
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM evidence").n).toBe(0);
  });

  it("confidentiality: scope evidence is seen by the submitter and the manager over them, not a colleague; restricted needs the restricted permission", async () => {
    const { owner, max, emma, zed, task } = await setup();
    const id = (await attach(emma.cookie, { links: [{ type: "task", id: task }] })).body.data.id as string;
    expect((await get(t.app, `/api/evidence/${id}`, max.cookie)).status).toBe(200);
    expect((await get(t.app, `/api/evidence/${id}`, zed.cookie)).status).toBe(404);
    expect((await get(t.app, "/api/evidence", zed.cookie)).body.data).toEqual([]);
    // the person marks it organization-wide: any holder of evidence.view reads it
    const shared = (await attach(emma.cookie, { title: "Public win", confidentiality: "organization" })).body.data.id as string;
    expect((await get(t.app, `/api/evidence/${shared}`, zed.cookie)).status).toBe(200); // organization-level evidence is open to anyone who holds evidence.view
    // restricted: an employee cannot even mark it; the owner can, and the manager (restricted over reports) sees it, Zed does not
    expect(code(await attach(emma.cookie, { confidentiality: "restricted" }))).toBe("permission_denied");
    const restricted = (await attach(owner, { title: "HR matter", relatedMembershipId: emma.membershipId, confidentiality: "restricted" })).body.data.id as string;
    expect((await get(t.app, `/api/evidence/${restricted}`, zed.cookie)).status).toBe(404);
    expect((await get(t.app, `/api/evidence/${restricted}`, emma.cookie)).status).toBe(404); // not even the person it is about
    expect((await get(t.app, `/api/evidence/${restricted}`, max.cookie)).status).toBe(200);
  });

  it("verification: the manager verifies; nobody verifies their own; a rejection needs a reason; an employee cannot verify; each is audited", async () => {
    const { owner, max, emma, task } = await setup();
    const id = (await attach(emma.cookie, { links: [{ type: "task", id: task }] })).body.data.id as string;
    const url = `/api/evidence/${id}/verify`;
    expect((await post(t.app, url, { status: "verified" }, emma.cookie)).status).toBe(403);
    expect(code(await post(t.app, url, { status: "rejected" }, max.cookie))).toBe("note_required");
    const ok = await post(t.app, url, { status: "verified", note: "Matches the release" }, max.cookie);
    expect(ok.body.data.verification).toMatchObject({ status: "verified", by: { name: "Max Manager" }, note: "Matches the release" });
    const own = (await attach(owner, { title: "Owner's own" })).body.data.id as string;
    expect(code(await post(t.app, `/api/evidence/${own}/verify`, { status: "verified" }, owner))).toBe("self_verification");
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_logs WHERE action = 'evidence.verify'").n).toBe(1);
  });

  it("files: a small pdf is stored and downloaded with nosniff and an attachment header; wrong types, empty and too large files are refused; one file per item", async () => {
    const { max, emma, zed } = await setup();
    const id = (await attach(emma.cookie, {})).body.data.id as string;
    const pdf = Buffer.from("%PDF-1.4 tiny");
    const up = await post(t.app, `/api/evidence/${id}/file`, { filename: "report.pdf", dataBase64: b64(pdf) }, emma.cookie);
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    expect(up.body.data.file).toMatchObject({ filename: "report.pdf", contentType: "application/pdf", sizeBytes: pdf.length });
    const dl = await (await import("supertest")).default(t.app).get(`/api/evidence/${id}/file`).set("Cookie", max.cookie);
    expect(dl.status).toBe(200);
    expect(dl.headers["content-type"]).toMatch(/application\/pdf/);
    expect(dl.headers["content-disposition"]).toBe('attachment; filename="report.pdf"');
    expect(dl.headers["x-content-type-options"]).toBe("nosniff");
    expect((await (await import("supertest")).default(t.app).get(`/api/evidence/${id}/file`).set("Cookie", zed.cookie)).status).toBe(404);
    expect(code(await post(t.app, `/api/evidence/${id}/file`, { filename: "again.pdf", dataBase64: b64(pdf) }, emma.cookie))).toBe("file_exists");
    const id2 = (await attach(emma.cookie, { title: "Second" })).body.data.id as string;
    expect(code(await post(t.app, `/api/evidence/${id2}/file`, { filename: "run.exe", dataBase64: b64("x") }, emma.cookie))).toBe("file_type");
    expect((await post(t.app, `/api/evidence/${id2}/file`, { filename: "a.txt", dataBase64: "" }, emma.cookie)).status).toBe(400);
    const big = await post(t.app, `/api/evidence/${id2}/file`, { filename: "big.txt", dataBase64: b64(Buffer.alloc(2 * 1024 * 1024 + 1, 65)) }, emma.cookie);
    expect(big.status).toBe(413);
    expect(code(big)).toBe("file_too_large");
    expect((await post(t.app, `/api/evidence/${id2}/file`, { filename: "ok.txt", dataBase64: b64("hello") }, max.cookie)).status).toBe(403); // only the submitter adds the file
  });

  it("evidence shows beside the numbers on a scorecard: how many pieces and how many verified, only those the viewer may see; the score itself does not change", async () => {
    const { owner, max, emma } = await setup();
    const o = await post(t.app, "/api/objectives", { level: "individual", ownerId: emma.membershipId, title: "Grow", startDate: day(-100), endDate: day(100), lifecycle: "active", keyResults: [{ title: "Result", targetValue: 100 }] }, owner);
    const kr = one<{ id: string }>("SELECT id FROM key_results WHERE objective_id = ?", o.body.data.id).id;
    await post(t.app, `/api/key-results/${kr}/progress`, { value: 60 }, owner);
    const period = (await post(t.app, "/api/performance/periods", { name: "Now", startDate: day(-60), endDate: day(30) }, owner)).body.data.id as string;
    await post(t.app, "/api/performance/scorecards/recalculate", { periodId: period, subjectId: emma.membershipId }, owner);
    const totalOf = async () => (await get(t.app, `/api/performance/scorecards/for?periodId=${period}&subjectId=${emma.membershipId}`, owner)).body.data.latest;
    const before = await totalOf();
    const id = (await attach(emma.cookie, { links: [{ type: "key_result", id: kr }] })).body.data.id as string;
    await post(t.app, `/api/evidence/${id}/verify`, { status: "verified" }, max.cookie);
    await attach(emma.cookie, { title: "Second", links: [{ type: "key_result", id: kr }] });
    const after = await totalOf();
    const contributor = after.components.find((c: { key: string }) => c.key === "okr").contributors[0];
    expect(contributor.evidence).toEqual({ total: 2, verified: 1 });
    expect(after.total).toBe(before.total);
    await post(t.app, "/api/performance/scorecards/recalculate", { periodId: period, subjectId: emma.membershipId }, owner);
    expect((await totalOf()).runNumber).toBe(before.runNumber); // no new run: evidence does not enter the score
  });

  it("scenario 3, daily execution: the employee updates a task and attaches evidence, the manager sees both and verifies, and after the outcome is recorded the key result moves", async () => {
    const { owner, max, emma } = await setup();
    const o = await post(t.app, "/api/objectives", { level: "individual", ownerId: emma.membershipId, title: "Deliver", startDate: day(-30), endDate: day(60), lifecycle: "active", keyResults: [{ title: "Reports shipped", targetValue: 10 }] }, owner);
    const kr = one<{ id: string }>("SELECT id FROM key_results WHERE objective_id = ?", o.body.data.id).id;
    const task = (await post(t.app, "/api/tasks", { title: "Quarterly report", assigneeIds: [emma.membershipId] }, owner)).body.data.id as string;
    expect((await (await import("supertest")).default(t.app).patch(`/api/tasks/${task}`).set("Origin", "https://zentro.test").set("Cookie", owner).send({ keyResultId: kr })).status).toBe(200);
    const up = await post(t.app, `/api/tasks/${task}/updates`, { type: "progress", progressPct: 60, note: "Draft done" }, emma.cookie);
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const ev = await attach(emma.cookie, { title: "Draft of the report", evidenceType: "report", links: [{ type: "task", id: task }] });
    expect(ev.status, JSON.stringify(ev.body)).toBe(201);
    const seen = (await get(t.app, `/api/tasks/${task}/updates`, max.cookie)).body.data;
    expect(JSON.stringify(seen)).toMatch(/Draft done/);
    expect((await get(t.app, `/api/evidence?targetType=task&targetId=${task}`, max.cookie)).body.data.map((e: { title: string }) => e.title)).toEqual(["Draft of the report"]);
    expect((await post(t.app, `/api/evidence/${ev.body.data.id}/verify`, { status: "verified" }, max.cookie)).body.data.verification.status).toBe("verified");
    const before = one<{ current_value: number | null }>("SELECT current_value FROM key_results WHERE id = ?", kr).current_value;
    expect((await post(t.app, `/api/tasks/${task}/updates`, { type: "status_change", toStatus: "completed" }, emma.cookie)).status).toBeLessThan(300);
    const out = await post(t.app, `/api/tasks/${task}/outcome`, { summary: "Shipped", value: 1, recordOnKeyResult: true }, emma.cookie);
    expect(out.status, JSON.stringify(out.body)).toBeLessThan(300);
    const after = one<{ current_value: number | null }>("SELECT current_value FROM key_results WHERE id = ?", kr).current_value;
    expect(after).not.toBe(before);
  });
});
