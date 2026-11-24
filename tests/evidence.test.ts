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

describe("Evidence in the demo company (stage 4.6)", () => {
  it("the demo has evidence in every verification state, behind tasks and key results; an employee sees only their own; Remove demo data takes it and spares a real item", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const load = await post(t.app, "/api/demo/load", undefined, owner);
    expect(load.status).toBe(201);
    expect(load.body.data.counts.evidence).toBeGreaterThanOrEqual(15);
    const all = (await get(t.app, "/api/evidence", owner)).body.data as { verification: { status: string }; links: { type: string }[]; confidentiality: string; isDemo: boolean }[];
    const states = new Set(all.map((e) => e.verification.status));
    for (const s of ["verified", "rejected", "needs_info", "unverified"]) expect(states.has(s), s).toBe(true);
    expect(all.every((e) => e.isDemo)).toBe(true);
    expect(all.some((e) => e.links.some((l) => l.type === "key_result"))).toBe(true);
    // an employee sees their own and nothing about people outside their scope
    const ps = (await get(t.app, "/api/demo/personas", owner)).body.data as { id: string; designation: string; roles: string[] }[];
    const subjectIds = new Set((t.db.prepare("SELECT DISTINCT related_membership_id AS id FROM evidence").all() as { id: string }[]).map((r) => r.id));
    const emp = ps.find((p) => p.roles.includes("Employee") && subjectIds.has(p.id))!;
    const asEmp = await post(t.app, `/api/demo/view-as/${emp.id}`, undefined, owner);
    const cookies = ([] as string[]).concat((asEmp.headers["set-cookie"] as unknown as string[]) ?? []).map((c) => c.split(";")[0] ?? "").filter((c) => /^zentro_(admin_)?session=/.test(c)).join("; ");
    const mine = (await get(t.app, "/api/evidence", cookies)).body.data as { submittedBy: { id: string }; confidentiality: string }[];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.some((e) => e.submittedBy.id === emp.id)).toBe(true);
    expect(mine.every((e) => e.submittedBy.id === emp.id || e.confidentiality === "organization")).toBe(true); // others' evidence only when it was shared organization-wide
    expect(mine.length).toBeLessThan(all.length / 2);
    // real items attached to a demo task never block the removal: one attached ONLY to demo records goes with them (even withdrawn, with a file),
    // one that also points at something real stays and only loses its link to the demo task
    const demoTask = one<{ id: string }>("SELECT id FROM tasks WHERE is_demo = 1 LIMIT 1").id;
    const realTask = (await post(t.app, "/api/tasks", { title: "A real task" }, owner)).body.data.id as string;
    const onlyDemo = await post(t.app, "/api/evidence", { title: "My own note", links: [{ type: "task", id: demoTask }] }, owner);
    expect(onlyDemo.status, JSON.stringify(onlyDemo.body)).toBe(201);
    expect((await post(t.app, `/api/evidence/${onlyDemo.body.data.id}/file`, { filename: "n.txt", dataBase64: b64("hi") }, owner)).status).toBe(201);
    const withdrawnOne = await post(t.app, "/api/evidence", { title: "Taken back", links: [{ type: "task", id: demoTask }] }, owner);
    expect((await post(t.app, `/api/evidence/${withdrawnOne.body.data.id}/withdraw`, undefined, owner)).status).toBe(200);
    const both = await post(t.app, "/api/evidence", { title: "Both worlds", links: [{ type: "task", id: demoTask }, { type: "task", id: realTask }] }, owner);
    expect(both.status).toBe(201);
    const removed = await post(t.app, "/api/demo/remove", undefined, owner);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM evidence WHERE is_demo = 1").n).toBe(0);
    expect((t.db.prepare("SELECT title FROM evidence").all() as { title: string }[]).map((r) => r.title)).toEqual(["Both worlds"]);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM evidence_files").n).toBe(0);
    expect((t.db.prepare("SELECT target_id FROM evidence_links").all() as { target_id: string }[]).map((r) => r.target_id)).toEqual([realTask]); // the link to the demo task went with the task
  });

  it("a person withdraws their own unverified evidence: hidden everywhere, file removed, audited with who and when; verified, rejected or someone else's cannot be withdrawn", async () => {
    const { max, emma, zed, task } = await setup();
    const id = (await attach(emma.cookie, { links: [{ type: "task", id: task }] })).body.data.id as string;
    expect((await post(t.app, `/api/evidence/${id}/file`, { filename: "a.txt", dataBase64: b64("proof") }, emma.cookie)).status).toBe(201);
    expect((await get(t.app, `/api/evidence/${id}`, emma.cookie)).body.data.can.withdraw).toBe(true);
    expect((await get(t.app, `/api/evidence/${id}`, max.cookie)).body.data.can.withdraw).toBe(false); // the manager cannot withdraw someone else's
    expect(code(await post(t.app, `/api/evidence/${id}/withdraw`, undefined, max.cookie))).toBe("permission_denied");
    expect((await post(t.app, `/api/evidence/${id}/withdraw`, undefined, zed.cookie)).status).toBe(404); // not even visible
    const w = await post(t.app, `/api/evidence/${id}/withdraw`, undefined, emma.cookie);
    expect(w.status, JSON.stringify(w.body)).toBe(200);
    // hidden from the item, the lists and the file download; kept in the table and the audit log with who and when
    expect((await get(t.app, `/api/evidence/${id}`, emma.cookie)).status).toBe(404);
    expect((await get(t.app, "/api/evidence", emma.cookie)).body.data).toEqual([]);
    expect((await get(t.app, `/api/evidence?targetType=task&targetId=${task}`, emma.cookie)).body.data).toEqual([]);
    expect((await get(t.app, `/api/evidence/${id}/file`, emma.cookie)).status).toBe(404);
    expect(one<{ verification_status: string; withdrawn_at: string; withdrawn_by_membership_id: string }>("SELECT verification_status, withdrawn_at, withdrawn_by_membership_id FROM evidence WHERE id = ?", id)).toMatchObject({ verification_status: "withdrawn", withdrawn_by_membership_id: emma.membershipId });
    expect(one<{ withdrawn_at: string }>("SELECT withdrawn_at FROM evidence WHERE id = ?", id).withdrawn_at).toBeTruthy();
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM evidence_files WHERE evidence_id = ?", id).n).toBe(0);
    const audit = one<{ actor_membership_id: string; created_at: string }>("SELECT actor_membership_id, created_at FROM audit_logs WHERE action = 'evidence.withdraw' AND entity_id = ?", id);
    expect(audit.actor_membership_id).toBe(emma.membershipId);
    expect(audit.created_at).toBeTruthy();
    expect((await post(t.app, `/api/evidence/${id}/withdraw`, undefined, emma.cookie)).status).toBe(404); // already gone
    // verified or rejected evidence cannot be withdrawn
    const v = (await attach(emma.cookie, { title: "Checked" })).body.data.id as string;
    expect((await post(t.app, `/api/evidence/${v}/verify`, { status: "verified" }, max.cookie)).status).toBe(200);
    expect(code(await post(t.app, `/api/evidence/${v}/withdraw`, undefined, emma.cookie))).toBe("not_withdrawable");
    const r = (await attach(emma.cookie, { title: "Refused" })).body.data.id as string;
    expect((await post(t.app, `/api/evidence/${r}/verify`, { status: "rejected", note: "Not enough" }, max.cookie)).status).toBe(200);
    expect(code(await post(t.app, `/api/evidence/${r}/withdraw`, undefined, emma.cookie))).toBe("not_withdrawable");
    expect((await get(t.app, `/api/evidence/${v}`, emma.cookie)).body.data.can.withdraw).toBe(false);
  });
});
