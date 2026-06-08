import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import path from "node:path";

const bufferPath = path.resolve(process.cwd(), "node_modules/buffer/index.js");

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
      alias: {
        // Privy/Glyph transitive deps (e.g. @privy-io/cross-app-connect/crypto)
        // statically `import { Buffer } from "buffer"`. Without an alias Vite
        // externalizes the node builtin name to `__vite-browser-external` in
        // the browser build and the import fails with
        // `"Buffer" is not exported by "__vite-browser-external"`. Point it
        // at the installed npm `buffer` polyfill so the client build links.
        buffer: bufferPath,
      },
    },
  },
});
