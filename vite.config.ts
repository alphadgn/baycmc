import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

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

// Relay's swap widget calls viem's parseUnits("") while its amount box is
// empty, which current viem rejects (it crashed My activity). Relay's own
// imports of "viem" go through a shim that reads unfinished amounts as 0.
const RELAY_VIEM_SHIM = fileURLToPath(
  new URL("./src/lib/relay/viem-relay-shim.ts", import.meta.url),
);
const isRelayImporter = (importer?: string) =>
  !!importer && /[\\/]@relayprotocol[\\/]/.test(importer);

export default defineConfig({
  vite: {
    optimizeDeps: {
      // Vite 7 can briefly serve a stale optimized-dependency URL when lazy
      // wallet/room modules discover a new dependency during navigation. Treat
      // those requests as cache misses instead of returning a preview-blanking
      // 504 "Outdated Optimize Dep" response.
      ignoreOutdatedRequests: true,
      // Dev pre-bundling uses esbuild, which skips Vite plugins: same redirect.
      esbuildOptions: {
        plugins: [
          {
            name: "baycmc:relay-viem-shim",
            setup(build: {
              onResolve: (
                o: { filter: RegExp },
                cb: (a: { importer: string }) => { path: string } | undefined,
              ) => void;
            }) {
              build.onResolve({ filter: /^viem$/ }, (args) =>
                isRelayImporter(args.importer) ? { path: RELAY_VIEM_SHIM } : undefined,
              );
            },
          },
        ],
      },
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
    mcpPlugin(),
    {
      name: "baycmc:relay-viem-shim",
      enforce: "pre",
      resolveId(id, importer) {
        return id === "viem" && isRelayImporter(importer) ? RELAY_VIEM_SHIM : null;
      },
    },
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
