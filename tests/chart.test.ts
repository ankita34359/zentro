import { afterEach, describe, expect, it } from "vitest";
import type { TestApp } from "./helpers/app.js";
import { get, makeAuthApp, post, signUpWithOrg } from "./helpers/auth.js";
import { roleIds } from "./helpers/roles.js";

let t: TestApp;
afterEach(() => t?.cleanup());

const created = async (path: string, body: Record<string, unknown>, cookie: string): Promise<string> => {
  const r = await post(t.app, path, body, cookie);
  expect(r.status, `${path} ${JSON.stringify(r.body)}`).toBe(201);
  return r.body.data.id as string;
};
const add = async (cookie: string, name: string, extra: Record<string, unknown> = {}) => created("/api/employees", { name, ...extra }, cookie);

async function setup() {
  t = makeAuthApp();
  const owner = await signUpWithOrg(t.app, "owner@example.com", "Acme");
  const ids = await roleIds(t.app, owner);
  const eng = await created("/api/departments", { name: "Engineering" }, owner);
  const sales = await created("/api/departments", { name: "Sales" }, owner);
  const core = await created("/api/teams", { name: "Core", departmentId: eng }, owner);
  const infra = await created("/api/teams", { name: "Infra", departmentId: eng, parentTeamId: core }, owner);
  const inside = await created("/api/teams", { name: "Inside sales", departmentId: sales }, owner);
  const fam = await created("/api/role-families", { name: "Engineering roles" }, owner);
  const dev = await created("/api/designations", { name: "Developer", roleFamilyId: fam }, owner);
  const lead = await created("/api/designations", { name: "Tech Lead", roleFamilyId: fam }, owner);
  return { owner, ids, eng, sales, core, infra, inside, fam, dev, lead };
}

describe("the chart", () => {
  it("the reporting view follows primary lines, loads by depth, and says how many children are not loaded yet", async () => {
    const s = await setup();
    const ceo = await add(s.owner, "Ceo", { designationId: s.lead });
    const v1 = await add(s.owner, "VP One", { managerId: ceo });
    const v2 = await add(s.owner, "VP Two", { managerId: ceo });
    const m1 = await add(s.owner, "Mgr", { managerId: v1, teamId: s.core });
    await add(s.owner, "Dev", { managerId: m1 });
    await post(t.app, "/api/hierarchy/reporting", { subordinateId: v2, managerId: v1, type: "dotted" }, s.owner); // dotted lines do not move anyone in the tree
    const top = (await get(t.app, "/api/hierarchy/tree?depth=2", s.owner)).body.data.nodes as { id: string; name: string; subtitle: string | null; childCount: number; children: { name: string; childCount: number; children: unknown }[] | null }[];
    const roots = top.map((n) => n.name);
    expect(roots).toContain("Ceo");
    const c = top.find((n) => n.id === ceo)!;
    expect(c.subtitle).toBe("Tech Lead");
    expect(c.childCount).toBe(2);
    expect(c.children!.map((x) => x.name)).toEqual(["VP One", "VP Two"]);
    const vp1 = c.children!.find((x) => x.name === "VP One")!;
    expect(vp1.childCount).toBe(1);
    expect(vp1.children).toBeNull(); // not loaded: ask again with VP One as the root
    const sub = (await get(t.app, `/api/hierarchy/tree?root=${v1}&depth=3`, s.owner)).body.data.nodes[0];
    expect(sub.children[0]).toMatchObject({ name: "Mgr", detail: "Core", childCount: 1 });
    expect(sub.children[0].children[0].name).toBe("Dev");
    expect((await get(t.app, `/api/hierarchy/tree?root=11111111-1111-4111-8111-111111111111`, s.owner)).status).toBe(404);
  });

  it("the organization view goes department → sub-department / team → sub-team → people, with the head and lead shown", async () => {
    const s = await setup();
    const a = await add(s.owner, "Ann", { teamId: s.infra });
    await add(s.owner, "Loose", { departmentId: s.eng });
    const r = (await get(t.app, "/api/hierarchy/tree?view=organization&depth=4", s.owner)).body.data.nodes as { name: string; kind: string; childCount: number; children: { name: string; kind: string; children: { name: string; kind: string; children: { name: string }[] }[] }[] }[];
    expect(r.map((n) => n.name)).toEqual(["Engineering", "Sales"]);
    const eng = r[0]!;
    expect(eng.kind).toBe("department");
    expect(eng.children.map((c) => `${c.kind}:${c.name}`)).toEqual(["team:Core", "person:Loose"]);
    expect(eng.children[0]!.children.map((c) => `${c.kind}:${c.name}`)).toEqual(["team:Infra"]);
    expect(eng.children[0]!.children[0]!.children.map((c) => c.name)).toEqual(["Ann"]);
    const part = (await get(t.app, `/api/hierarchy/tree?view=organization&root=${s.core}&rootKind=team`, s.owner)).body.data.nodes;
    expect(part.map((n: { name: string }) => n.name)).toEqual(["Core"]);
    expect((await get(t.app, `/api/hierarchy/tree?view=organization&root=${s.core}`, s.owner)).status).toBe(404); // a team id is not a department id
    void a;
  });

  it("asOf shows the chart as it was", async () => {
    const s = await setup();
    const boss1 = await add(s.owner, "Old boss");
    const boss2 = await add(s.owner, "New boss");
    const p = await add(s.owner, "Pat", { managerId: boss1 });
    t.db.prepare("UPDATE reporting_relationships SET start_date = '2020-01-01'").run();
    await post(t.app, "/api/hierarchy/reporting", { subordinateId: p, managerId: boss2, startDate: "2022-01-01" }, s.owner);
    const under = async (asOf: string, boss: string) => {
      const n = ((await get(t.app, `/api/hierarchy/tree?asOf=${asOf}`, s.owner)).body.data.nodes as { id: string; children: { name: string }[] }[]).find((x) => x.id === boss)!;
      return n.children.map((c) => c.name);
    };
    expect(await under("2021-06-01", boss1)).toEqual(["Pat"]);
    expect(await under("2023-06-01", boss1)).toEqual([]);
    expect(await under("2023-06-01", boss2)).toEqual(["Pat"]);
  });
});

