// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// The lovable wrapper sets a default `client.files: ["**/server/**"]` for the
// TanStack import-protection plugin and merges via vite's `mergeConfig`, which
// concatenates arrays. That means we can't drop the default by overriding
// `files`. Instead we whitelist `*.functions.*` modules (createServerFn
// wrappers — safe to import from the client; TanStack splits handler bodies
// into a server-only chunk) via `excludeFiles`. Genuinely server-only modules
// (`*.server.ts`) stay protected.
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
    resolve: {
      alias: [
        // @privy-io/cross-app-connect (pulled in by Glyph SDK) imports `Buffer`
        // from the bare `buffer` specifier, which Vite otherwise stubs with
        // __vite-browser-external and breaks the production build. Point it at
        // the real npm `buffer` polyfill so the browser bundle can use it.
        { find: /^buffer$/, replacement: "buffer/index.js" },
      ],
    },
    optimizeDeps: {
      include: ["buffer"],
    },
  },
});
