import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
    importProtection: {
      behavior: "error",
      client: {
        excludeFiles: ["**/*.functions.ts", "**/*.functions.tsx", "**/*.functions.js"],
      },
    },
  },
  // Force the bare `buffer` / `process` specifiers (used by Privy's
  // cross-app-connect crypto bundle) to resolve to the npm browser polyfills
  // instead of Vite's default `__vite-browser-external` stub, which does not
  // export `Buffer` and breaks the production Rollup build.
  vite: {
    resolve: {
      alias: [
        { find: /^buffer$/, replacement: "buffer/" },
        { find: /^process$/, replacement: "process/browser" },
      ],
    },
  },
});
