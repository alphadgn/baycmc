import { defineConfig } from "vitest/config";
import path from "node:path";

// Vitest runs unit/integration tests only. The Playwright e2e specs under
// tests/e2e/ import `@playwright/test` and are executed by Playwright, not
// Vitest — excluding them here keeps `bun run test` green.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["tests/unit/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**", ".output/**"],
    environment: "node",
  },
});
