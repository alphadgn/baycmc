import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  resolve: {
    alias: {
      buffer: "buffer/",
    },
  },
  tanstackStart: {
    server: { entry: "server" },
    importProtection: {
      behavior: "error",
      client: {
        excludeFiles: ["**/*.functions.ts", "**/*.functions.tsx", "**/*.functions.js"],
      },
    },
  },
});

