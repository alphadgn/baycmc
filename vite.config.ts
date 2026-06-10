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
  vite: {
    resolve: {
      alias: [
        // Force the npm `buffer` package to resolve as a real module on the
        // client instead of Vite's empty browser-external stub. Without this,
        // @privy-io/cross-app-connect/crypto.mjs (`import { Buffer } from "buffer"`)
        // breaks the build with `"Buffer" is not exported by "__vite-browser-external"`.
        { find: /^buffer$/, replacement: "buffer/index.js" },
      ],
    },
  },
});
