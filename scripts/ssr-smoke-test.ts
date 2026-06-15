#!/usr/bin/env bun
/**
 * Smoke test: boot the production Cloudflare Worker build under
 * `wrangler dev --local` and hit a handful of routes to verify the SSR
 * entry returns non-5xx (catches the `{"unhandled":true}` regression we
 * saw when polyfills leaked into the worker bundle).
 *
 * The Cloudflare/Nitro build emits `dist/server/index.mjs` + a generated
 * `dist/server/wrangler.json` ready for `wrangler dev`. `vite preview`
 * does NOT serve the worker bundle (it expects a `dist/server/server.js`
 * Node entry that this preset never produces), so we deliberately bypass
 * vite preview here.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.env.SMOKE_PORT ?? 4173);
const BASE = `http://127.0.0.1:${PORT}`;
const ROUTES = ["/", "/login", "/api/public/health"];
const TIMEOUT_MS = 180_000;
const WORKER_DIR = join(process.cwd(), "dist", "server");
const WORKER_ENTRY = join(WORKER_DIR, "index.mjs");
const WRANGLER_CONFIG = join(WORKER_DIR, "wrangler.json");

if (!existsSync(WORKER_ENTRY) || !existsSync(WRANGLER_CONFIG)) {
  console.error(
    `[ssr-smoke-test] missing worker build output (${WORKER_ENTRY}). Run \`bun run build\` first.`,
  );
  process.exit(1);
}

const child = spawn(
  "bunx",
  [
    "wrangler",
    "dev",
    "--local",
    "--config",
    WRANGLER_CONFIG,
    "--port",
    String(PORT),
    "--ip",
    "127.0.0.1",
    "--log-level",
    "warn",
  ],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "production", CI: "1" },
  },
);

child.stdout.on("data", (d) => process.stdout.write(`[wrangler] ${d}`));
child.stderr.on("data", (d) => process.stderr.write(`[wrangler!] ${d}`));

async function waitReady() {
  const deadline = Date.now() + TIMEOUT_MS;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/public/health`, { signal: AbortSignal.timeout(2_000) });
      if (r.status < 500) return;
      lastErr = `health → ${r.status}`;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`wrangler worker did not become ready in time (last: ${String(lastErr)})`);
}

async function main() {
  try {
    await waitReady();
    const failures: string[] = [];
    for (const path of ROUTES) {
      const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
      const ok = res.status < 500;
      console.log(`  ${ok ? "✓" : "✗"} ${path} → ${res.status}`);
      if (!ok) {
        const body = await res.text();
        failures.push(`${path}: ${res.status}\n${body.slice(0, 400)}`);
      }
    }
    if (failures.length > 0) {
      console.error("\nSSR smoke test failures:\n" + failures.join("\n---\n"));
      process.exit(1);
    }
    console.log("\n[ssr-smoke-test] all routes healthy");
  } finally {
    child.kill("SIGTERM");
  }
}

void main().catch((e) => {
  console.error(e);
  child.kill("SIGTERM");
  process.exit(1);
});
