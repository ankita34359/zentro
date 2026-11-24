import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Only the jsdom test files have a document; backend tests skip this.
if (typeof document !== "undefined") {
  // Pages load as lazy chunks, so the first render of a page can take longer than Testing Library's default 1 second to wait for
  // (findBy and waitFor) on a busy machine. Waiting longer costs nothing when the element is there: a wait ends the moment it appears.
  configure({ asyncUtilTimeout: 8000 });
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
