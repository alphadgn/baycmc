// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// @privy-io/cross-app-connect (pulled in by Glyph SDK) imports `Buffer` from
// the bare `buffer` specifier in browser code. We inline the `Buffer` /
// `process` / `global` polyfills via `src/lib/polyfill-shim.ts` (bundled
// with the main entry) rather than letting `vite-plugin-node-polyfills`
// inject its own `_shims_*.js` deps chunk — that chunk intermittently
// 401/502s in the sandbox preview and, when it fails, the entire client
// entry stops evaluating and React never hydrates (every onClick — VIP,
// hamburger, etc. — becomes inert while SSR HTML keeps rendering).
//
// We still pass the plugin through so bare specifiers like `import "buffer"`
// resolve to its browser shims for the client build only — never the SSR
// (Cloudflare Worker) bundle, where these polyfills break the runtime.
const clientOnlyNodePolyfills = nodePolyfills({
  globals: { Buffer: false, global: false, process: false },
}).map((plugin) => ({
  ...plugin,
  apply: (_config: unknown, env: { isSsrBuild?: boolean; command: string }) =>
    !env.isSsrBuild,
}));

export default defineConfig({
  tanstackStart: {
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
  vite: {
    plugins: [clientOnlyNodePolyfills],
  },
});
