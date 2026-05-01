#!/usr/bin/env bun
/**
 * Build-time guard: scan the client-eligible source tree for any static import
 * of a `*.server` module. The Vite import-protection plugin catches this at
 * bundle time too, but failing fast with a clear message keeps CI green and
 * gives a precise file:line pointer.
 *
 * Allowed to import *.server modules:
 *   - src/server/**            (server functions surface)
 *   - src/**\/*.server.*       (server-only helpers)
 *   - src/**\/*.functions.*    (createServerFn wrappers)
 *   - src/integrations/supabase/auth-middleware.ts
 *   - src/routes/api/**        (server routes)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");

const SERVER_IMPORT_RE =
  /(?:import|export)\s+(?:[^'"`;]+from\s+)?['"`]([^'"`]*\.server(?:\.[a-zA-Z]+)?)['"`]/g;

const ALLOWLIST = [
  /^src\/server\//,
  /\.server(\.[tj]sx?)?$/,
  /\.functions\.[tj]sx?$/,
  /^src\/integrations\/supabase\/auth-middleware\.ts$/,
  /^src\/routes\/api\//,
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (/\.[tj]sx?$/.test(entry)) yield full;
  }
}

let violations = 0;
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  if (ALLOWLIST.some((re) => re.test(rel))) continue;
  const src = readFileSync(file, "utf8");
  const matches = [...src.matchAll(SERVER_IMPORT_RE)];
  for (const m of matches) {
    const before = src.slice(0, m.index ?? 0).split("\n");
    const line = before.length;
    console.error(`✗ ${rel}:${line}  imports server-only module "${m[1]}"`);
    violations++;
  }
}

if (violations > 0) {
  console.error(
    `\n${violations} forbidden *.server.* import(s) from client/shared code.\n` +
      `Wrap the logic in a createServerFn (.functions.ts) and import that instead.`,
  );
  process.exit(1);
}
console.log("✓ no client-side imports of *.server modules");
