// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "@/components/common/ThemeToggle";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { stubMatchMedia } from "./helpers";

const root = () => document.documentElement;
const ui = () => (
  <ThemeProvider>
    <ThemeToggle />
  </ThemeProvider>
);

describe("light and dark mode", () => {
  it("starts from the system setting and toggles both ways, saving the choice", async () => {
    stubMatchMedia(false);
    const user = userEvent.setup();
    render(ui());
    expect(root().classList.contains("dark")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Switch to dark mode" }));
    expect(root().classList.contains("dark")).toBe(true);
    expect(root().style.colorScheme).toBe("dark");
    expect(localStorage.getItem("zentro.theme")).toBe("dark");
    await user.click(screen.getByRole("button", { name: "Switch to light mode" }));
    expect(root().classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("zentro.theme")).toBe("light");
  });

  it("starts dark when the system is dark and nothing is saved", () => {
    stubMatchMedia(true);
    render(ui());
    expect(root().classList.contains("dark")).toBe(true);
  });

  it("a saved choice beats the system setting", () => {
    stubMatchMedia(true);
    localStorage.setItem("zentro.theme", "light");
    render(ui());
    expect(root().classList.contains("dark")).toBe(false);
  });

  it("ignores a garbage saved value", () => {
    stubMatchMedia(false);
    localStorage.setItem("zentro.theme", "purple");
    render(ui());
    expect(root().classList.contains("dark")).toBe(false);
  });

  it("follows the system while no choice was made, and stops following after one", async () => {
    const setSystemDark = stubMatchMedia(false);
    const user = userEvent.setup();
    render(ui());
    act(() => setSystemDark(true));
    expect(root().classList.contains("dark")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Switch to light mode" }));
    act(() => setSystemDark(true));
    expect(root().classList.contains("dark")).toBe(false); // the explicit choice wins
  });

  it("still works when browser storage throws (private window, blocked site data)", async () => {
    stubMatchMedia(false);
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const user = userEvent.setup();
    render(ui());
    await user.click(screen.getByRole("button", { name: "Switch to dark mode" }));
    expect(root().classList.contains("dark")).toBe(true);
    spy.mockRestore();
    set.mockRestore();
  });
});
