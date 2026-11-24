// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { NAV_ITEMS } from "@/routes/navigation";
import { envelope, HEALTH_OK, json, renderApp, stubFetch, stubMatchMedia } from "./helpers";

beforeEach(() => {
  stubMatchMedia(false);
  stubFetch(() => json(HEALTH_OK));
});

const LABELS = [
  "Overview",
  "Organization",
  "OKRs & Goals",
  "KPIs",
  "My Work",
  "Team Performance",
  "Performance Intelligence",
  "AI Intelligence",
  "Leadership",
  "Integrations",
  "Settings",
];

describe("sidebar", () => {
  it("lists all eleven items in the order of the spec, each linking to its own route", async () => {
    expect(NAV_ITEMS.map((n) => n.label)).toEqual(LABELS);
    renderApp("/overview");
    await screen.findByRole("heading", { level: 1, name: "Overview" }); // the signed-in person is known now
    const nav = screen.getAllByRole("navigation", { name: "Main" })[0]!;
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(LABELS);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(NAV_ITEMS.map((n) => n.path));
  });

  it("marks the current page with aria-current", async () => {
    renderApp("/kpis");
    await screen.findByRole("heading", { level: 1, name: "KPIs" });
    const nav = screen.getAllByRole("navigation", { name: "Main" })[0]!;
    const current = within(nav).getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page");
    expect(current.map((l) => l.textContent)).toEqual(["KPIs"]);
  });

  it("opens the phone menu as a dialog and closes it after choosing a page", async () => {
    const user = userEvent.setup();
    renderApp("/overview");
    await screen.findByRole("heading", { level: 1, name: "Overview" });
    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const dialog = await screen.findByRole("dialog", { name: "Navigation" });
    expect(within(dialog).getAllByRole("link")).toHaveLength(11);
    await user.click(within(dialog).getByRole("link", { name: "My Work" }));
    await screen.findByRole("heading", { level: 1, name: "My Work" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("phone menu focus", () => {
  it("returns focus to the menu button after Escape, and leaves it on the new page after choosing one", async () => {
    const user = userEvent.setup();
    renderApp("/overview");
    await screen.findByRole("heading", { level: 1, name: "Overview" });
    const button = screen.getByRole("button", { name: "Open navigation menu" });
    await user.click(button);
    await screen.findByRole("dialog", { name: "Navigation" });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);

    await user.click(button);
    await user.click(within(await screen.findByRole("dialog", { name: "Navigation" })).getByRole("link", { name: "KPIs" }));
    await screen.findByRole("heading", { level: 1, name: "KPIs" });
    expect(document.activeElement).toBe(document.getElementById("main"));
  });
});

describe("routes", () => {
  it("sends / to the Overview", async () => {
    renderApp("/");
    await screen.findByRole("heading", { level: 1, name: "Overview" });
    expect(document.title).toBe("Overview · Zentro");
  });

  it.each(NAV_ITEMS.filter((n) => n.key !== "overview" && n.key !== "settings" && n.key !== "organization" && n.key !== "my-work" && n.key !== "okrs" && n.key !== "kpis" && n.key !== "performance" && n.key !== "team-performance" && n.key !== "leadership" && n.key !== "ai" && n.key !== "integrations"))("renders $label with an empty state that says what to do", async (n) => {
    renderApp(n.path);
    await screen.findByRole("heading", { level: 1, name: n.label });
    expect(screen.getByRole("heading", { level: 2 })).toBeTruthy(); // the empty-state headline
    expect(document.title).toBe(`${n.label} · Zentro`);
    expect(screen.getByText(/Planned for stage \d\.\d/)).toBeTruthy(); // honest about what is not built yet
  });

  it("renders Performance Intelligence as a real page (stage 5.2): its own title and the standing note that scores are information, not employment decisions", async () => {
    renderApp("/performance");
    await screen.findByRole("heading", { level: 1, name: "Performance Intelligence" });
    expect(document.title).toBe("Performance Intelligence · Zentro");
    expect(screen.getByText(/They are not employment decisions/)).toBeTruthy();
  });

  it("renders Organization as a real page (stage 2.6): the chart and the people list", async () => {
    renderApp("/organization");
    await screen.findByRole("heading", { level: 1, name: "Organization" });
    expect(document.title).toBe("Organization · Zentro");
    expect(screen.getByRole("tab", { name: "Chart" }).getAttribute("href")).toBe("/organization");
    expect(screen.getByRole("tab", { name: "People" }).getAttribute("href")).toBe("/organization/people");
  });

  it("renders My Work as a real page (stages 4.1 and 4.4): Today and All tasks", async () => {
    renderApp("/my-work");
    await screen.findByRole("heading", { level: 1, name: "My Work" });
    expect(document.title).toBe("My Work · Zentro");
    expect(screen.getByRole("tab", { name: "Today" }).getAttribute("href")).toBe("/my-work");
    expect(screen.getByRole("tab", { name: "All tasks" }).getAttribute("href")).toBe("/my-work/tasks");
  });

  it("renders Settings as a real index (stage 2.2): users and invitations, and profile", async () => {
    renderApp("/settings");
    await screen.findByRole("heading", { level: 1, name: "Settings" });
    expect(document.title).toBe("Settings · Zentro");
    expect(screen.getByRole("link", { name: /Users and invitations/ }).getAttribute("href")).toBe("/settings/users");
    expect(screen.getByRole("link", { name: /Profile/ }).getAttribute("href")).toBe("/settings/profile");
  });

  it("renders OKRs & Goals as a real page (stage 3.1) with an honest empty state, and keeps sub-paths inside their section", async () => {
    stubFetch((url) => (url.startsWith("/api/objectives") ? envelope([]) : json(HEALTH_OK)));
    renderApp("/okrs");
    await screen.findByRole("heading", { level: 1, name: "OKRs & Goals" });
    expect(document.title).toBe("OKRs & Goals · Zentro");
    expect(await screen.findByRole("heading", { level: 2, name: "No objectives yet" })).toBeTruthy();
    expect(screen.queryByText(/Planned for stage/)).toBeNull();
  });

  it("renders KPIs as a real page (stages 3.3 and 3.4) with an honest empty state", async () => {
    stubFetch((url) => (url.startsWith("/api/kpis") ? envelope([]) : json(HEALTH_OK)));
    renderApp("/kpis");
    await screen.findByRole("heading", { level: 1, name: "KPIs" });
    expect(document.title).toBe("KPIs · Zentro");
    expect(await screen.findByRole("heading", { level: 2, name: "No KPIs yet" })).toBeTruthy();
    expect(screen.queryByText(/Planned for stage/)).toBeNull();
  });

  it("keeps sub-paths inside their section (deep links work)", async () => {
    renderApp("/team-performance/123/edit");
    await screen.findByRole("heading", { level: 1, name: "Team Performance" });
  });

  it("shows a 404 page inside the shell for an unknown address, with a way back", async () => {
    renderApp("/definitely/not/here");
    await screen.findByRole("heading", { name: "Page not found" });
    expect(document.title).toBe("Page not found · Zentro");
    expect(screen.getAllByRole("navigation", { name: "Main" })).not.toHaveLength(0); // sidebar still there
    expect(screen.getByRole("link", { name: "Go to Overview" }).getAttribute("href")).toBe("/overview");
  });

  it("offers a skip link to the main content", async () => {
    renderApp("/overview");
    const skip = await screen.findByRole("link", { name: "Skip to content" });
    expect(skip.getAttribute("href")).toBe("#main");
    expect(document.getElementById("main")?.tagName).toBe("MAIN");
  });

  it("shows no sample numbers: the Overview has steps and live server facts only", async () => {
    renderApp("/overview");
    await screen.findByText("2 of 2 applied");
    expect(screen.getByText("abc1234", { selector: "dd" })).toBeTruthy();
    expect(screen.getByText("Getting started")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/(?<![\d.])(?!0\s*%)\d+\s*%/); // only the derived 0% of the setup ring, no sample percentages
  });
});
