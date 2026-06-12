import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const { getModules } = require_("rollup-plugin-polyfill-node/dist/modules.js") as {
  getModules: () => Map<string, string>;
};

// Map bare Node-builtin specifiers to real npm browser-polyfill packages so
// the client bundle doesn't get Vite's empty `__vite-browser-external` stub.
// Several wallet SDKs (Privy, WalletConnect, etc.) do
// `import { Buffer } from "buffer"` / `import { EventEmitter } from "events"`
// at the top of ESM modules — Rollup then fails the production build with
// `"X" is not exported by "__vite-browser-external"`.
// Use ESM virtual polyfills rather than the CJS npm entrypoints; otherwise the
// dev browser can execute `buffer/index.js` directly and crash with
// `Can't find variable: require` before Glyph sign-in loads.
const nodePolyfillModules = getModules();
const NODE_POLYFILL_PREFIX = "\0lovable-node-polyfill:";
const polyfills: Record<string, string> = {
  buffer: "buffer",
  "buffer/": "buffer",
  "node:buffer": "buffer",
  events: "events",
  "events/": "events",
  "node:events": "events",
  process: "process",
  "process/browser": "process",
  "process/browser.js": "process",
  "node:process": "process",
};

export default defineConfig({
  vite: {
    optimizeDeps: {
      // Vite 7 can briefly serve a stale optimized-dependency URL when lazy
      // wallet/room modules discover a new dependency during navigation. Treat
      // those requests as cache misses instead of returning a preview-blanking
      // 504 "Outdated Optimize Dep" response.
      ignoreOutdatedRequests: true,
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
  plugins: [
    {
      name: "lovable:force-node-builtin-polyfills",
      enforce: "pre",
      resolveId(id, _importer, opts) {
        // Only patch the client bundle. The Cloudflare Worker SSR build uses
        // `nodejs_compat` and provides these built-ins natively at runtime.
        if (opts?.ssr) return null;
        const polyfill = polyfills[id];
        return polyfill ? `${NODE_POLYFILL_PREFIX}${polyfill}` : null;
      },
      load(id) {
        if (!id.startsWith(NODE_POLYFILL_PREFIX)) return null;
        return nodePolyfillModules.get(id.slice(NODE_POLYFILL_PREFIX.length)) ?? null;
      },
    },
  ],
});
