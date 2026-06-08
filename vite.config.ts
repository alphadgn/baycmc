import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
    importProtection: {
      behavior: "error",
      client: {
        excludeFiles: [
          "**/*.functions.ts",
          "**/*.functions.tsx",
          "**/*.functions.js",
        ],
      },
    },
  },
});

