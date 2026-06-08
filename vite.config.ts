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
  resolve: {
    alias: {
      // Privy/Glyph transitive deps import `buffer` directly. Vite would
      // otherwise externalize it to __vite-browser-external in the client
      // bundle and break the build ("Buffer is not exported"). Point it at
      // the installed npm `buffer` polyfill package for the browser build.
      buffer: "buffer/",
    },
  },
});
