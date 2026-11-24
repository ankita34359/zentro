import { afterEach, describe, expect, it } from "vitest";
import { lastRun, recentRuns } from "../backend/src/db/jobRuns.js";
import { JobRegistry } from "../backend/src/jobs/registry.js";
import { createTick } from "../backend/src/jobs/tick.js";
import { createLogger } from "../backend/src/lib/logger.js";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
afterEach(() => t?.cleanup());

function setup(register: (r: JobRegistry) => void, clockRef: { now: Date }, opts: { budgetMs?: number; staleAfterMs?: number } = {}) {
  t = makeTestApp();
  const reg = new JobRegistry();
  register(reg);
  const lines: string[] = [];
  const tick = createTick(t.db, reg, createLogger("debug", (l) => lines.push(l)), { ...opts, clock: () => clockRef.now });
  return { tick, lines };
}
const at = (iso: string) => ({ now: new Date(iso) });

describe("job registry", () => {
  it("validates names, intervals and duplicates", () => {
    const r = new JobRegistry();
    expect(() => r.register({ name: "Bad Name", minIntervalSeconds: 0, run: () => 1 })).toThrow(/Bad job name/);
    expect(() => r.register({ name: "ok.job", minIntervalSeconds: -1, run: () => 1 })).toThrow(/bad interval/);
    r.register({ name: "ok.job", minIntervalSeconds: 0, run: () => 1 });
    expect(() => r.register({ name: "ok.job", minIntervalSeconds: 0, run: () => 1 })).toThrow(/twice/);
  });
});

describe("tick", () => {
  it("runs due jobs, records each in scheduled_job_runs, and records the tick itself", async () => {
    const clock = at("2026-11-21T08:00:00.000Z");
    const { tick } = setup((r) => r.register({ name: "demo.job", minIntervalSeconds: 0, run: () => ({ did: 3 }) }), clock);
    const s = await tick.run();
    expect(s).toMatchObject({ started: true, ran: ["demo.job"], failed: [] });
    expect(lastRun(t.db, "demo.job")).toMatchObject({ status: "ok", summary: { did: 3 } });
    expect(lastRun(t.db, "tick")).toMatchObject({ status: "ok", summary: { ran: 1, failed: 0 } });
  });

  it("honours minIntervalSeconds across ticks (an hourly job runs once an hour on a 5-minute tick)", async () => {
    const clock = at("2026-11-21T08:00:00.000Z");
    let runs = 0;
    const { tick } = setup((r) => r.register({ name: "hourly.job", minIntervalSeconds: 3600, run: () => void runs++ }), clock);
    await tick.run();
    clock.now = new Date("2026-11-21T08:05:00.000Z");
    expect((await tick.run()).notDue).toEqual(["hourly.job"]);
    clock.now = new Date("2026-11-21T08:59:00.000Z");
    await tick.run();
    expect(runs).toBe(1);
    clock.now = new Date("2026-11-21T09:00:30.000Z");
    await tick.run();
    expect(runs).toBe(2);
  });

  it("a failing job is recorded with its message only, does not stop the others, and marks the tick partial", async () => {
    const clock = at("2026-11-21T08:00:00.000Z");
    const { tick, lines } = setup((r) => {
      r.register({ name: "bad.job", minIntervalSeconds: 0, run: () => { throw new Error("db exploded"); } });
      r.register({ name: "good.job", minIntervalSeconds: 0, run: () => "fine" });
    }, clock);
    const s = await tick.run();
    expect(s).toMatchObject({ ran: ["good.job"], failed: ["bad.job"] });
    expect(lastRun(t.db, "bad.job")).toMatchObject({ status: "failed", error: "db exploded" });
    expect(lastRun(t.db, "tick")?.status).toBe("partial");
    expect(lines.join("\n")).not.toMatch(/\bat \w/); // no stack
  });

  it("runs one tick at a time and tells the caller it skipped", async () => {
    const clock = at("2026-11-21T08:00:00.000Z");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { tick } = setup((r) => r.register({ name: "slow.job", minIntervalSeconds: 0, run: () => gate }), clock);
    const first = tick.run();
    expect(tick.isRunning()).toBe(true);
    expect(await tick.run()).toMatchObject({ started: false, skipped: "already running" });
    release();
    await first;
    expect(tick.isRunning()).toBe(false);
  });

  it("treats a tick older than the stale limit as dead", async () => {
    const clock = at("2026-11-21T08:00:00.000Z");
    const { tick } = setup((r) => r.register({ name: "slow.job", minIntervalSeconds: 0, run: () => new Promise(() => undefined) }), clock, { staleAfterMs: 20 });
    void tick.run(); // never finishes: a hung tick
    await new Promise((r) => setTimeout(r, 60));
    expect(tick.isRunning()).toBe(false);
  });

  it("stops starting new jobs when the time budget is spent and leaves them due for the next tick", async () => {
    const clock = at("2026-11-21T08:00:00.000Z");
    const { tick } = setup((r) => {
      r.register({ name: "first.job", minIntervalSeconds: 0, run: () => new Promise((res) => setTimeout(res, 40)) });
      r.register({ name: "second.job", minIntervalSeconds: 0, run: () => 1 });
    }, clock, { budgetMs: 10 });
    const s = await tick.run();
    expect(s.ran).toEqual(["first.job"]);
    expect(s.deferred).toEqual(["second.job"]);
    expect(lastRun(t.db, "second.job")).toBeNull();
  });

  it("marks rows left 'running' by a dead process as failed on the next tick", async () => {
    const clock = at("2026-11-21T08:00:00.000Z");
    const { tick } = setup((r) => r.register({ name: "demo.job", minIntervalSeconds: 0, run: () => 1 }), clock);
    t.db.prepare("INSERT INTO scheduled_job_runs (id, job_name, started_at, status) VALUES ('old','demo.job','2026-11-21T07:00:00.000Z','running')").run();
    await tick.run();
    expect(t.db.prepare("SELECT status, error FROM scheduled_job_runs WHERE id = 'old'").get()).toEqual({
      status: "failed",
      error: "interrupted (process restarted or timed out)",
    });
  });

  it("the default job: housekeeping prunes runs older than 30 days", async () => {
    t = makeTestApp();
    t.db.prepare("INSERT INTO scheduled_job_runs (id, job_name, started_at, finished_at, status) VALUES ('ancient','tick','2026-01-01T00:00:00.000Z','2026-01-01T00:00:01.000Z','ok')").run();
    await t.tick.run();
    expect(t.db.prepare("SELECT 1 AS x FROM scheduled_job_runs WHERE id = 'ancient'").get()).toBeUndefined();
    expect(recentRuns(t.db).map((r) => r.jobName).sort()).toEqual(["kpi.thresholds", "okr.health", "platform.backup", "platform.housekeeping", "scores.recalculate", "tasks.reminders", "tick"]);
  });
});
