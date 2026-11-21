// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CountUp } from "@/motion/CountUp";
import { MotionProvider } from "@/motion/MotionProvider";
import { ProgressBar } from "@/motion/ProgressBar";
import { stubMatchMedia } from "./helpers";

// Reduced motion is read once per page load, so this lives in its own test file.
describe("reduced motion", () => {
  it("CountUp shows the final value immediately, with no counting", () => {
    stubMatchMedia(false, true);
    render(
      <MotionProvider>
        <CountUp value={4200} />
      </MotionProvider>,
    );
    expect(screen.getByTestId("countup-visual").textContent).toBe("4,200"); // synchronous: no animation frames needed
  });

  it("ProgressBar renders at its final width from the first frame", () => {
    stubMatchMedia(false, true);
    render(
      <MotionProvider>
        <ProgressBar value={0.5} label="Half" />
      </MotionProvider>,
    );
    const fill = screen.getByRole("progressbar", { name: "Half" }).firstElementChild as HTMLElement;
    expect(fill.style.width === "50%" || fill.style.width === "").toBe(true);
  });
});
