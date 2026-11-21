import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "frontend/src") } },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node", // frontend test files switch to jsdom with a "@vitest-environment jsdom" comment
    setupFiles: ["tests/frontend/setup.ts"],
  },
});
