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

const CANDIDATE_DIRS = [
  "dist/server",
  "dist/_worker.js",
  ".output/server",
  ".output",
  "dist",
];

const POLYFILL_FINGERPRINTS = [
  "vite-plugin-node-polyfills",
  "node-stdlib-browser",
  "@jspm/core/nodelibs/browser",
  // Vite's stub for an unresolved bare specifier — symptom of the
  // original Buffer-import build break.
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
  // Heuristic: only worker / SSR bundles live alongside `index.js` or
  // `_worker.js`. Client bundles under dist/client may legitimately
  // contain polyfill code.
  if (file.includes("/client/") || file.includes("/assets/")) continue;
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
