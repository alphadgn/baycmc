import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import path from "node:path";
import type { Plugin } from "vite";

const bufferPath = path.resolve(process.cwd(), "node_modules/buffer/index.js");

/**
 * Force-resolve `buffer` (and `node:buffer`) to the npm `buffer` polyfill in
 * the *client* build. Privy/Glyph transitive deps (e.g.
 * `@privy-io/cross-app-connect/crypto`) `import { Buffer } from "buffer"`,
 * which Vite otherwise externalizes to `__vite-browser-external` for the
 * browser target, failing the build with
 * `"Buffer" is not exported by "__vite-browser-external"`. The plugin runs
 * with `enforce: "pre"` so it wins over Vite's builtin externalizer.
 *
 * Scoped to client builds only via `applyToEnvironment` so the SSR/worker
 * bundle keeps using Cloudflare's native `node:buffer` (preserves the
 * SSR-no-polyfills invariant enforced by scripts/check-no-polyfills-in-ssr.ts).
 */
function clientBufferAlias(): Plugin {
  return {
    name: "lovable:client-buffer-alias",
    enforce: "pre",
    applyToEnvironment(env) {
      return env.name === "client";
    },
    resolveId(id) {
      if (id === "buffer" || id === "node:buffer") {
        return bufferPath;
      }
      return null;
    },
  };
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
  plugins: [clientBufferAlias()],
});
