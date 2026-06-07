#!/usr/bin/env bun
/**
 * Fail CI early if any required build-time environment variable is missing,
 * empty, or the literal string "undefined".
 *
 * Run BEFORE `bun run build` so we get a single, obvious failure instead of
 * a cryptic SSR crash later in the pipeline (e.g. a `VITE_SUPABASE_URL`
 * that resolves to `undefined` baked into the client bundle, leading to
 * "Failed to construct 'URL'" at module init in the worker).
 */
const REQUIRED = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PROJECT_ID",
] as const;

const missing: string[] = [];
for (const name of REQUIRED) {
  const v = process.env[name];
  if (v === undefined || v === "" || v === "undefined" || v === "null") {
    missing.push(`${name}=${v === undefined ? "<unset>" : JSON.stringify(v)}`);
  }
}

if (missing.length > 0) {
  console.error("✗ Missing/invalid required environment variables:");
  for (const m of missing) console.error(`  - ${m}`);
  console.error(
    "\nSet these as repo-level GitHub Actions secrets (or in your local .env)" +
      " before running the build.",
  );
  process.exit(1);
}

console.log(`✓ All ${REQUIRED.length} required env vars present`);
