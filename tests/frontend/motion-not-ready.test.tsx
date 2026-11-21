// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MotionProvider, useMotionReady } from "@/motion/MotionProvider";
import { PageTransition } from "@/motion/PageTransition";
import { ProgressBar } from "@/motion/ProgressBar";
import { Stagger, StaggerItem } from "@/motion/Stagger";
import { stubMatchMedia } from "./helpers";

// The animation engine never arrives (slow network, blocked chunk): the page must still be fully visible.
vi.mock("@/motion/features", () => new Promise(() => undefined));

function Probe() {
  return <span>{String(useMotionReady())}</span>;
}

describe("animation engine not loaded", () => {
  it("renders every animated component in its final, visible state", () => {
    stubMatchMedia(false);
    render(
      <MotionProvider>
        <Probe />
        <PageTransition>
          <p>Page body</p>
          <Stagger>
            <StaggerItem>
              <p>Card one</p>
            </StaggerItem>
          </Stagger>
          <ProgressBar value={0.5} label="Half" />
        </PageTransition>
      </MotionProvider>,
    );
    expect(screen.getByText("false")).toBeTruthy(); // the engine really is not ready
    for (const t of ["Page body", "Card one"]) {
      let node: HTMLElement | null = screen.getByText(t);
      while (node && node !== document.body) {
        expect(node.style.opacity, `${t}: opacity of ${node.tagName}`).not.toBe("0");
        expect(["", "none"], `${t}: transform of ${node.tagName}`).toContain(node.style.transform);
        node = node.parentElement;
      }
    }
    const fill = screen.getByRole("progressbar", { name: "Half" }).firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("50%"); // final width at first paint, not 0
  });
});
