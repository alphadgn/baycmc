import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { nodePolyfills } from "vite-plugin-node-polyfills";

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
  // Privy's `@privy-io/cross-app-connect/dist/esm/crypto.mjs` does
  // `import { Buffer } from "buffer"` at module scope. Without a real
  // polyfill, Vite resolves bare `buffer` to its `__vite-browser-external`
  // stub which has no `Buffer` named export, breaking the production Rollup
  // build. The polyfill plugin provides browser-compatible shims for the
  // few Node built-ins Privy / Glyph / wagmi reach for at module scope.
  plugins: [
    nodePolyfills({
      include: ["buffer", "process", "events", "util", "stream"],
      globals: { Buffer: true, process: true, global: true },
      protocolImports: true,
    }),
  ],
});
