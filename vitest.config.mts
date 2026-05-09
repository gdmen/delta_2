import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next", "src/app/dev/**"],
    // pglite (in-process WASM Postgres) takes ~500ms-2s to spin up per
    // call to createTestDb(); the default 5s leaves no room for the
    // first test in a file plus the actual assertions. Bump to 30s.
    testHookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
