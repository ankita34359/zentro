import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(here, "src") } },
  build: {
    // dist/ is the frontend; tsc writes the server to build/, so neither overwrites the other.
    outDir: path.resolve(here, "../dist"),
    emptyOutDir: true,
  },
  server: { proxy: { "/api": "http://localhost:3001", "/healthz": "http://localhost:3001" } },
});
