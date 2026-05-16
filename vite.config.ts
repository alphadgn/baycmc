// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Override the default import-protection rule (`**/server/**`) so that
// `*.functions.ts` files (createServerFn wrappers — safe to import from the
// client; the bundler splits handler bodies into a server-only chunk) and
// `url-guard.ts` (pure helper) are not blocked. `*.server.ts` files remain
// fully protected.
export default defineConfig({
  tanstackStart: {
    importProtection: {
      behavior: "error",
      client: {
        files: ["**/*.server.ts", "**/*.server.tsx", "**/*.server.js"],
        specifiers: ["server-only"],
      },
    },
  },
});
