// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge, type Status } from "@/components/common/StatusBadge";
import { ThemeToggle } from "@/components/common/ThemeToggle";
import { ILLUSTRATION_NAMES, Illustration } from "@/components/illustrations";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { contrastRatio } from "@/lib/contrast";
import { CountUp } from "@/motion/CountUp";
import { MotionProvider } from "@/motion/MotionProvider";
import { ProgressBar } from "@/motion/ProgressBar";
import { ProgressRing } from "@/motion/ProgressRing";
import { NAV_ITEMS } from "@/routes/navigation";
import OverviewPage from "@/pages/OverviewPage";
import { HEALTH_OK, json, renderApp, stubFetch, stubMatchMedia } from "./helpers";

beforeEach(() => {
  stubMatchMedia(false);
  stubFetch(() => json(HEALTH_OK));
});

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>
    <ThemeProvider>
      <MotionProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </MotionProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

describe("grouped sidebar", () => {
  it("shows the four group headings, labels each list, and keeps every item exactly once", async () => {
    renderApp("/overview");
    await screen.findByRole("heading", { level: 1, name: "Overview" });
    const nav = screen.getAllByRole("navigation", { name: "Main" })[0]!;
    for (const g of ["Strategy", "Execution", "Insight", "System"]) {
      const label = within(nav).getByText(g);
      const list = within(nav).getByRole("list", { name: g });
      expect(list).toBeTruthy();
      expect(label.id).toBeTruthy();
    }
    expect(within(nav).getAllByRole("link")).toHaveLength(NAV_ITEMS.length);
  });

  it("has a single sliding indicator element in each sidebar", async () => {
    renderApp("/kpis");
    await screen.findByRole("heading", { level: 1, name: "KPIs" });
    expect(screen.getAllByTestId("nav-indicator").length).toBeGreaterThanOrEqual(1);
  });
});

describe("/design page", () => {
  it("exists, is titled, and is not in the sidebar", async () => {
    renderApp("/design");
    await screen.findByRole("heading", { level: 1, name: "Design system" });
    expect(document.title).toBe("Design system · Zentro");
    const nav = screen.getAllByRole("navigation", { name: "Main" })[0]!;
    expect(within(nav).queryByRole("link", { name: /design/i })).toBeNull();
    expect(NAV_ITEMS.some((n) => n.path === "/design")).toBe(false);
  });

  it("shows palette, type scale, components, illustrations, motion samples and a contrast table", async () => {
    renderApp("/design");
    await screen.findByRole("heading", { level: 1, name: "Design system" });
    for (const h of ["Brand and neutrals", "Status colours", "Typography", "Components", "Illustrations", "Motion", "Accessibility"]) {
      expect(screen.getByRole("heading", { level: 2, name: h })).toBeTruthy();
    }
    expect(screen.getAllByRole("button", { name: /Replay/ }).length).toBeGreaterThanOrEqual(4);
    expect(screen.getByRole("table", { name: /Contrast ratios/ })).toBeTruthy();
  });
});

describe("status colours always come with an icon and words", () => {
  it.each<[Status, string]>([
    ["on-track", "On track"],
    ["at-risk", "At risk"],
    ["off-track", "Off track"],
    ["info", "Info"],
    ["no-data", "No data"],
  ])("%s", (status, text) => {
    const { container } = render(<StatusBadge status={status} />);
    expect(screen.getByText(text)).toBeTruthy();
    expect(container.querySelector("svg[aria-hidden='true']")).toBeTruthy();
  });
});

describe("illustrations", () => {
  it("are decorative: hidden from assistive technology", () => {
    for (const name of ILLUSTRATION_NAMES) {
      const { container, unmount } = render(<Illustration name={name} />);
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("aria-hidden"), name).toBe("true");
      expect(svg.getAttribute("focusable")).toBe("false");
      unmount();
    }
    expect(ILLUSTRATION_NAMES.length).toBeGreaterThanOrEqual(10);
  });

  it("an empty state shows its illustration above the headline", () => {
    const { container } = render(<EmptyState illustration="target" title="Create the first objective" />);
    expect(container.querySelector("svg")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Create the first objective" })).toBeTruthy();
  });
});

describe("motion components", () => {
  it("CountUp ends on the exact final value and tells screen readers only the final value", async () => {
    render(wrap(<CountUp value={1284} />));
    await waitFor(() => expect(screen.getByTestId("countup-visual").textContent).toBe("1,284"), { timeout: 3000 });
    const sr = document.querySelector(".sr-only")!;
    expect(sr.textContent).toBe("1,284");
  });

  it("CountUp formats decimals, prefix and suffix", async () => {
    render(wrap(<CountUp value={86.5} decimals={1} suffix="%" />));
    await waitFor(() => expect(screen.getByTestId("countup-visual").textContent).toBe("86.5%"), { timeout: 3000 });
  });

  it("ProgressRing exposes its value to assistive technology and draws no arc at zero", () => {
    const { container, rerender } = render(wrap(<ProgressRing value={0} max={6} label="Steps done" />));
    const bar = screen.getByRole("progressbar", { name: "Steps done" });
    expect(bar.getAttribute("aria-valuenow")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("6");
    expect(bar.getAttribute("aria-valuetext")).toBe("0 of 6");
    expect(container.querySelectorAll("circle")).toHaveLength(1); // track only: no stray dot
    rerender(wrap(<ProgressRing value={4} max={6} label="Steps done" />));
    expect(container.querySelectorAll("circle")).toHaveLength(2);
  });

  it("ProgressRing and ProgressBar clamp out-of-range values", () => {
    render(wrap(<ProgressBar value={9} max={4} label="Over" />));
    expect(screen.getByRole("progressbar", { name: "Over" }).getAttribute("aria-valuenow")).toBe("9");
  });

  it("Overview shows the Getting started ring at 0 of 6", async () => {
    stubFetch(() => json(HEALTH_OK));
    render(wrap(<OverviewPage />));
    const ring = await screen.findByRole("progressbar", { name: "Getting started steps done" });
    expect(ring.getAttribute("aria-valuenow")).toBe("0");
    expect(ring.getAttribute("aria-valuemax")).toBe("6");
  });
});

describe("logo", () => {
  it("every logo on the page has its own gradient id (a duplicate would break the hidden-copy case on phones)", async () => {
    renderApp("/overview");
    await screen.findByRole("heading", { level: 1, name: "Overview" });
    const ids = [...document.querySelectorAll("linearGradient")].map((g) => g.id).filter(Boolean);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rect of document.querySelectorAll("svg rect[fill^='url(#']")) {
      const ref = /url\(#(.+)\)/.exec(rect.getAttribute("fill")!)![1]!;
      expect(document.getElementById(ref), `gradient ${ref} exists`).toBeTruthy();
    }
  });
});

describe("theme toggle morph", () => {
  it("renders both icons and marks the one for the current theme active", () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    const icons = document.querySelectorAll(".theme-icon");
    expect(icons).toHaveLength(2);
    expect([...icons].map((i) => i.getAttribute("data-active")).sort()).toEqual(["false", "true"]);
  });
});

describe("contrast helper", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
    expect(contrastRatio([119, 119, 119], [255, 255, 255])).toBeCloseTo(4.48, 1); // #777 on white
  });
});
