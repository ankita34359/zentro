import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { csvCell } from "../backend/src/lib/csv.js";
import { makeZip, readStoredZip } from "../backend/src/lib/zip.js";
import { ORIGIN, type TestApp } from "./helpers/app.js";
import { get, makeAuthApp, post, signUpWithOrg } from "./helpers/auth.js";
import { addPerson, roleIds } from "./helpers/roles.js";

let t: TestApp;
afterEach(() => t?.cleanup());
const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const exportZip = (cookie: string) => request(t.app).post("/api/export").set("Origin", ORIGIN).set("Cookie", cookie).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on("data", (c: Buffer) => chunks.push(c)); res.on("end", () => cb(null, Buffer.concat(chunks))); });

describe("zip and csv helpers (batch L)", () => {
  it("a zip written here is read back byte for byte, and a spreadsheet formula in a cell is made harmless", () => {
    const zip = makeZip([{ name: "a.csv", data: Buffer.from("x,y\r\n1,2\r\n") }, { name: "b/ü.txt", data: Buffer.from("héllo") }], new Date("2026-11-24T10:00:00Z"));
    expect(readStoredZip(zip).map((f) => [f.name, f.data.toString()])).toEqual([["a.csv", "x,y\r\n1,2\r\n"], ["b/ü.txt", "héllo"]]);
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a, b")).toBe("\"a, b\"");
    expect(csvCell(null)).toBe("");
    expect(csvCell(-5)).toBe("-5"); // a real number stays a number
  });
});

describe("Export all data (batch L)", () => {
  it("an administrator downloads a zip with only their organization's records; the excluded things and another organization's data are absent; the export is audited", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ids = await roleIds(t.app, owner);
    const max = await addPerson(t.app, owner, "max@example.com", ids.manager, "Max Manager");
    const emma = await addPerson(t.app, owner, "emma@example.com", ids.employee, "Emma Employee");
    expect((await post(t.app, "/api/hierarchy/reporting", { subordinateId: emma.membershipId, managerId: max.membershipId, startDate: day(-100) }, owner)).status).toBe(201);
    expect((await post(t.app, "/api/objectives", { title: "Grow the Acme base", level: "company", startDate: day(-30), endDate: day(60) }, owner)).status).toBe(201);
    expect((await post(t.app, "/api/tasks", { title: "=Call the Acme customers", assigneeIds: [emma.membershipId] }, owner)).status).toBe(201);
    const period = (await post(t.app, "/api/performance/periods", { name: "Now", startDate: day(-60), endDate: day(30) }, owner)).body.data.id as string;
    expect((await post(t.app, "/api/performance/reviews", { periodId: period, subjectId: emma.membershipId, sharedSummary: "SHARED-SUMMARY-QQ", privateNotes: "PRIVATE-NOTE-ZULU", rating: 4 }, max.cookie)).status).toBe(201);
    expect((await post(t.app, "/api/evidence", { title: "Release notes", externalRef: "https://example.com/secret-link-token-123", relatedMembershipId: emma.membershipId }, owner)).status).toBe(201);
    const file = (await post(t.app, "/api/evidence", { title: "With a file" }, owner)).body.data.id as string;
    expect((await post(t.app, `/api/evidence/${file}/file`, { filename: "proof.txt", dataBase64: Buffer.from("FILE-CONTENT-ZULU").toString("base64") }, owner)).status).toBe(201);
    expect((await post(t.app, "/api/evidence", { title: "RESTRICTED-EVIDENCE-ZULU", description: "HR matter", relatedMembershipId: emma.membershipId, confidentiality: "restricted" }, owner)).status).toBe(201);
    // another organization with data of its own
    const b = await signUpWithOrg(t.app, "b-owner@example.com", "Beta Co");
    await post(t.app, "/api/objectives", { title: "BETA-SECRET-OBJECTIVE", level: "company", startDate: day(-30), endDate: day(60) }, b);
    await post(t.app, "/api/tasks", { title: "BETA-SECRET-TASK" }, b);

    const res = await exportZip(owner);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="zentro-export-.*-\d{4}-\d{2}-\d{2}\.zip"$/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    const files = readStoredZip(res.body as Buffer);
    const names = files.map((f) => f.name);
    for (const n of ["people.csv", "teams.csv", "objectives.csv", "key_results.csv", "kpis.csv", "kpi_values.csv", "tasks.csv", "evidence.csv", "scores.csv", "README.txt"]) expect(names).toContain(n);
    const text = Object.fromEntries(files.map((f) => [f.name, f.data.toString("utf8")]));
    const all = files.filter((f) => f.name.endsWith(".csv")).map((f) => f.data.toString("utf8")).join("\n"); // the data files (the README names what is left out, so it is not scanned)
    // the organization's own data is there
    expect(text["people.csv"]).toContain("Emma Employee");
    expect(text["objectives.csv"]).toContain("Grow the Acme base");
    expect(text["evidence.csv"]).toContain("Release notes");
    expect(text["tasks.csv"]).toContain("'=Call the Acme customers"); // a formula is made harmless
    // what must never be in it
    for (const forbidden of ["BETA-SECRET", "Beta Co", "b-owner@example.com", "PRIVATE-NOTE-ZULU", "SHARED-SUMMARY-QQ", "RESTRICTED-EVIDENCE-ZULU", "HR matter", "FILE-CONTENT-ZULU", "proof.txt", "secret-link-token-123", "password_hash", "$argon2", "scrypt", "session", "token_hash", "reset", "ENCRYPTION", "SESSION_SECRET", "test-session-secret", "test-encryption-key"]) {
      expect(all.toLowerCase(), `${forbidden} is in the export`).not.toContain(forbidden.toLowerCase());
    }
    expect(names.some((n) => /review|session|user|invit|token|secret|file/i.test(n))).toBe(false);
    // the README says what is left out
    expect(text["README.txt"]).toMatch(/private review notes/);
    expect(text["README.txt"]).toMatch(/Not included, on purpose/);
    // audited with who, when and which files
    const a = t.db.prepare("SELECT actor_membership_id, created_at, summary, after_json FROM audit_logs WHERE action = 'data.export'").all() as { actor_membership_id: string; created_at: string; after_json: string }[];
    expect(a).toHaveLength(1);
    expect(a[0]!.actor_membership_id).toBeTruthy();
    expect(a[0]!.created_at).toBeTruthy();
    expect(JSON.parse(a[0]!.after_json).files.map((f: { name: string }) => f.name)).toEqual(expect.arrayContaining(["people.csv", "tasks.csv"]));
    expect(a[0]!.after_json).not.toContain("Emma"); // file names and counts only, never the data
    // the other organization exports only its own
    const bzip = readStoredZip((await exportZip(b)).body as Buffer);
    const bAll = bzip.map((f) => f.data.toString("utf8")).join("\n");
    expect(bAll).toContain("BETA-SECRET-OBJECTIVE");
    expect(bAll).not.toContain("Grow the Acme base");
    expect(bAll).not.toContain("Emma Employee");
  });

  it("only an administrator may export: a manager, an employee and a signed-out caller are refused, and nothing is audited", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    const ids = await roleIds(t.app, owner);
    const max = await addPerson(t.app, owner, "max@example.com", ids.manager, "Max Manager");
    const emma = await addPerson(t.app, owner, "emma@example.com", ids.employee, "Emma Employee");
    expect((await request(t.app).post("/api/export").set("Origin", ORIGIN)).status).toBe(401);
    for (const who of [max.cookie, emma.cookie]) {
      expect((await request(t.app).post("/api/export").set("Origin", ORIGIN).set("Cookie", who)).status).toBe(403);
      expect((await get(t.app, "/api/export", who)).status).toBe(403);
    }
    expect((await get(t.app, "/api/export", owner)).body.data.files).toContain("people.csv");
    expect((t.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action = 'data.export'").get() as { n: number }).n).toBe(0);
  });

  it("exporting is limited to a few a hour per person", async () => {
    t = makeAuthApp();
    const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
    let blocked = 0;
    for (let i = 0; i < 9; i++) if ((await exportZip(owner)).status === 429) blocked += 1;
    expect(blocked).toBeGreaterThanOrEqual(1);
  });
});
