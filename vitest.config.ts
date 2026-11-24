import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "frontend/src") } },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node", // frontend test files switch to jsdom with a "@vitest-environment jsdom" comment
    testTimeout: 20_000, // a test that waits for a lazy page on a busy machine; a passing test never waits this long
    setupFiles: ["tests/frontend/setup.ts"],
  },
});
