#!/usr/bin/env bun
/**
 * Build-time guard: after a production build, scan the Cloudflare Worker
 * SSR output for any `vite-plugin-node-polyfills` markers.
 *
 * Leaking these polyfills into the worker bundle breaks the runtime with
 * `{"status":500,"unhandled":true,"message":"HTTPError"}` on every
 * request (see `vite.config.ts` for the original incident). CI runs this
 * after `bun run build` so the regression can't ship again.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const CANDIDATE_DIRS = ["dist/server", "dist/_worker.js", ".output/server", ".output", "dist"];

// `vite-plugin-node-polyfills` is the regression we're catching. Its
// presence in the worker bundle was the original Buffer-import break.
// Nitro's cloudflare-module preset vendors browser-shim chunks
// (node-stdlib-browser, stream-browserify, https-browserify, etc.) under
// `_libs/` for packages like `ethers` and `ws` even with `nodeCompat: true`
// — those are transitive vendor chunks the Worker tolerates at runtime
// (the SSR boot test in CI validates this end-to-end). We only flag the
// `vite-plugin-node-polyfills` fingerprint and the unresolved
// `__vite-browser-external` stub that broke the worker the first time.
const POLYFILL_FINGERPRINTS = [
  // Actual plugin-injected virtual modules (not the bare string, which
  // appears in our own polyfill-check.ts diagnostic message).
  "\\0vite-plugin-node-polyfills",
  "@jspm/core/nodelibs/browser",
  "__vite-browser-external",
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (/\.(m?js|cjs|map)$/.test(entry)) yield full;
  }
}

function pickDir(): string | undefined {
  for (const d of CANDIDATE_DIRS) {
    if (existsSync(d) && statSync(d).isDirectory()) return d;
  }
  return undefined;
}

const target = pickDir();
if (!target) {
  console.warn("[check-no-polyfills-in-ssr] No build output found — skipping.");
  process.exit(0);
}

let bad = 0;
for (const file of walk(target)) {
  // Skip client bundles (legitimate polyfill targets) and Nitro's vendored
  // dependency chunks under `_libs/` — those are deps Nitro chose to bundle
  // with browser shims for cloudflare-module + nodeCompat; the worker
  // tolerates them at runtime. We only care about the worker entry and
  // SSR route chunks.
  if (file.includes("/client/") || file.includes("/assets/")) continue;
  if (file.includes("/_libs/")) continue;
  const text = readFileSync(file, "utf8");
  for (const needle of POLYFILL_FINGERPRINTS) {
    if (text.includes(needle)) {
      console.error(`[ssr-polyfill-leak] ${file} contains "${needle}"`);
      bad++;
    }
  }
}

if (bad > 0) {
  console.error(
    `\n${bad} polyfill leak(s) detected in the SSR/Worker bundle.\n` +
      "Polyfills must be scoped to the client build (see vite.config.ts).",
  );
  process.exit(1);
}
console.log(`[check-no-polyfills-in-ssr] clean (${target})`);
