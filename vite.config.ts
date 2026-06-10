import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
// Resolve to the real `buffer` npm package (installed as a dependency).
const bufferEntry = require_.resolve("buffer/");

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
  plugins: [
    {
      // Force `buffer` (and `node:buffer`) to resolve to the real npm package
      // in the client bundle instead of Vite's empty `__vite-browser-external`
      // stub. @privy-io/cross-app-connect/crypto.mjs does
      // `import { Buffer } from "buffer"`, which otherwise fails the build
      // with `"Buffer" is not exported by "__vite-browser-external"`.
      name: "lovable:force-buffer-polyfill",
      enforce: "pre",
      resolveId(id, _importer, opts) {
        if (opts?.ssr) return null;
        if (id === "buffer" || id === "node:buffer") return bufferEntry;
        return null;
      },
    },
  ],
});
