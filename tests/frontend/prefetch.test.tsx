// @vitest-environment jsdom
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lazyWithPreload, prefetchWhenIdle } from "@/lib/preload";
import { NotFoundPage, OverviewPage, SectionPage } from "@/routes/pages";
import { HEALTH_OK, json, renderApp, stubFetch, stubMatchMedia } from "./helpers";

afterEach(() => vi.restoreAllMocks());

describe("lazyWithPreload", () => {
  it("starts the download once, however many times it is preloaded or rendered", async () => {
    const factory = vi.fn(() => Promise.resolve({ default: () => null }));
    const Page = lazyWithPreload(factory);
    await Promise.all([Page.preload(), Page.preload()]);
    await Page.preload();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("forgets a failed download so the real visit can try again", async () => {
    const factory = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ default: () => null });
    const Page = lazyWithPreload(factory);
    await expect(Page.preload()).rejects.toThrow("offline");
    await expect(Page.preload()).resolves.toBeTruthy();
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

describe("prefetchWhenIdle", () => {
  /** A scheduler we control: nothing runs until the test says the browser is idle. */
  const manual = () => {
    const pending: Array<() => void> = [];
    return { schedule: (cb: () => void) => void pending.push(cb), runNext: async () => { pending.shift()?.(); await Promise.resolve(); await Promise.resolve(); }, pending };
  };

  it("does nothing until the browser is idle, then loads one chunk at a time in order", async () => {
    const order: string[] = [];
    const loaders = ["a", "b", "c"].map((n) => () => { order.push(n); return Promise.resolve(); });
    const idle = manual();
    prefetchWhenIdle(loaders, idle.schedule);
    expect(order).toEqual([]);
    await idle.runNext();
    expect(order).toEqual(["a"]);
    await idle.runNext();
    await idle.runNext();
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("waits for the window load event if the page is still loading", async () => {
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    const idle = manual();
    const load = vi.fn(() => Promise.resolve());
    prefetchWhenIdle([load], idle.schedule);
    expect(idle.pending).toHaveLength(0);
    window.dispatchEvent(new Event("load"));
    expect(idle.pending).toHaveLength(1);
    await idle.runNext();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps going after one chunk fails, and stops when cancelled", async () => {
    const order: string[] = [];
    const idle = manual();
    const cancel = prefetchWhenIdle(
      [() => { order.push("bad"); return Promise.reject(new Error("x")); }, () => { order.push("good"); return Promise.resolve(); }, () => { order.push("never"); return Promise.resolve(); }],
      idle.schedule,
    );
    await idle.runNext();
    await idle.runNext();
    expect(order).toEqual(["bad", "good"]);
    cancel();
    await idle.runNext();
    expect(order).not.toContain("never");
  });
});

describe("the app shell prefetches while idle", () => {
  beforeEach(() => stubFetch(() => json(HEALTH_OK)));

  /** Run every idle callback straight away so the test does not wait on real timers. */
  const instantIdle = () => vi.stubGlobal("requestIdleCallback", (cb: () => void) => window.setTimeout(cb, 0));

  it("preloads every page chunk after the first load, without anyone visiting them", async () => {
    stubMatchMedia(false);
    instantIdle();
    const spies = [OverviewPage, SectionPage, NotFoundPage].map((p) => vi.spyOn(p, "preload"));
    renderApp("/overview");
    await waitFor(() => spies.forEach((s) => expect(s).toHaveBeenCalled()));
  });

  it("on a phone the menu is ready right after the first paint, without waiting for the browser to be idle", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("max-width: 1023px"), media: q, addEventListener() {}, removeEventListener() {} }));
    const idle = vi.fn(); // the idle callback never fires in this test: the menu must not depend on it
    vi.stubGlobal("requestIdleCallback", idle);
    renderApp("/overview");
    const button = await screen.findByRole("button", { name: /open navigation menu/i });
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); }); // a couple of frames, no idle time
    await userEvent.click(button);
    // No waiting: if the chunk had to be fetched on the tap, the dialog would not be there yet.
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
