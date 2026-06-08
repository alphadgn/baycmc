import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import type { Plugin } from "vite";

/**
 * Wrap vite-plugin-node-polyfills so it only attaches to the *client* build.
 * The Cloudflare Worker SSR bundle relies on `nodejs_compat` for the real
 * `node:*` modules — leaking the polyfill shim into SSR breaks the worker
 * runtime and trips `scripts/check-no-polyfills-in-ssr.ts`.
 *
 * Privy/Glyph transitive deps (e.g. `@privy-io/cross-app-connect/crypto`,
 * `@walletconnect/heartbeat`) statically `import` from `buffer` / `events` /
 * `process`; without these polyfills Vite externalizes them to
 * `__vite-browser-external` for the browser target and the build fails with
 * `"Buffer" is not exported by "__vite-browser-external"` (and similar for
 * `EventEmitter`).
 */
function clientOnlyNodePolyfills(): Plugin[] {
  const plugins = nodePolyfills({
    include: ["buffer", "process", "events", "util", "stream", "crypto"],
    globals: { Buffer: true, global: true, process: true },
    protocolImports: true,
  });
  const list = Array.isArray(plugins) ? plugins : [plugins];
  return list.map((p) => ({
    ...p,
    applyToEnvironment(env: { name: string }) {
      return env.name === "client";
    },
  }));
}

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
  plugins: [...clientOnlyNodePolyfills()],
});
