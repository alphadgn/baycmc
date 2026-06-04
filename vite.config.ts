// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// @privy-io/cross-app-connect (pulled in by Glyph SDK) imports `Buffer` from
// the bare `buffer` specifier in browser code. Polyfill it for the CLIENT
// build only — injecting these polyfills into the SSR (Cloudflare Worker)
// bundle breaks the worker runtime and surfaces as
// `{"status":500,"unhandled":true,"message":"HTTPError"}` on every request.
const clientOnlyNodePolyfills = nodePolyfills({
  globals: { Buffer: true, global: true, process: true },
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
