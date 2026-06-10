import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);

// Map bare Node-builtin specifiers to real npm browser-polyfill packages so
// the client bundle doesn't get Vite's empty `__vite-browser-external` stub.
// Several wallet SDKs (Privy, WalletConnect, etc.) do
// `import { Buffer } from "buffer"` / `import { EventEmitter } from "events"`
// at the top of ESM modules — Rollup then fails the production build with
// `"X" is not exported by "__vite-browser-external"`.
const polyfills: Record<string, string> = {
  buffer: require_.resolve("buffer/"),
  "node:buffer": require_.resolve("buffer/"),
  events: require_.resolve("events/"),
  "node:events": require_.resolve("events/"),
  process: require_.resolve("process/browser.js"),
  "node:process": require_.resolve("process/browser.js"),
};

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
      name: "lovable:force-node-builtin-polyfills",
      enforce: "pre",
      resolveId(id, _importer, opts) {
        // Only patch the client bundle. The Cloudflare Worker SSR build uses
        // `nodejs_compat` and provides these built-ins natively at runtime.
        if (opts?.ssr) return null;
        return polyfills[id] ?? null;
      },
    },
  ],
});
