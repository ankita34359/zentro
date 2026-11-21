import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Only the jsdom test files have a document; backend tests skip this.
if (typeof document !== "undefined") {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.documentElement.className = "";
    document.documentElement.style.colorScheme = "";
    try {
      window.localStorage.clear();
    } catch {
      /* ignore */
    }
  });
}
