#!/usr/bin/env bun
/**
 * SSR / Cloudflare Worker boot test.
 *
 * Boots the production worker bundle under `wrangler dev --local` and
 * asserts the Worker entry (`src/server.ts` → `@tanstack/react-start/
 * server-entry`) evaluates without throwing at module init and that the
 * router dispatches (no h3 swallowed-error envelope on `/`, no 5xx on the
 * server-route health endpoint).
 *
 * We use wrangler — not `vite preview` — because the Cloudflare/Nitro
 * preset emits `dist/server/index.mjs` (a Worker bundle), not the Node
 * `dist/server/server.js` entry that `vite preview` would expect.
 *
 * On failure, captures the worker's full stdout/stderr and the boot-error
 * stack trace as plain files at the repo root so the CI workflow can
 * upload them as artifacts:
 *   - worker-stdout.log
 *   - worker-stderr.log
 *   - boot-error.log   (the error from this script, including stack)
 */
import { spawn } from "node:child_process";
import { writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.env.BOOT_PORT ?? 4174);
const BASE = `http://127.0.0.1:${PORT}`;
const TIMEOUT_MS = 180_000;
const WORKER_DIR = join(process.cwd(), "dist", "server");
const WORKER_ENTRY = join(WORKER_DIR, "index.mjs");
const WRANGLER_CONFIG = join(WORKER_DIR, "wrangler.json");

const STDOUT_LOG = "worker-stdout.log";
const STDERR_LOG = "worker-stderr.log";
const ERROR_LOG = "boot-error.log";

// Truncate the artifact files on each run so we never upload stale logs.
writeFileSync(STDOUT_LOG, "");
writeFileSync(STDERR_LOG, "");
writeFileSync(ERROR_LOG, "");

if (!existsSync(WORKER_ENTRY) || !existsSync(WRANGLER_CONFIG)) {
  const msg = `[ssr-boot-test] missing worker build output (${WORKER_ENTRY}). Run \`bun run build\` first.`;
  console.error(msg);
  appendFileSync(ERROR_LOG, msg + "\n");
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

child.stdout.on("data", (d) => {
  const s = d.toString();
  process.stdout.write(`[wrangler] ${s}`);
  appendFileSync(STDOUT_LOG, s);
});
child.stderr.on("data", (d) => {
  const s = d.toString();
  process.stderr.write(`[wrangler!] ${s}`);
  appendFileSync(STDERR_LOG, s);
});

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

    // 1. Worker dispatches at all (no module-init throw bubbling up as 5xx).
    const root = await fetch(`${BASE}/`, { redirect: "manual" });
    const rootBody = await root.text();
    if (root.status >= 500) {
      throw new Error(
        `Worker boot failed: GET / returned ${root.status}\n${rootBody.slice(0, 600)}`,
      );
    }

    // 2. Body is not the h3 swallowed-error envelope from a module-init throw.
    if (rootBody.includes('"unhandled":true') && rootBody.includes('"message":"HTTPError"')) {
      throw new Error(
        `Worker boot failed: h3 swallowed an init error on GET /\n${rootBody.slice(0, 600)}`,
      );
    }

    // 3. Health endpoint (server route) also responds — confirms the
    //    router itself evaluated, not just the static shell.
    const health = await fetch(`${BASE}/api/public/health`);
    if (health.status >= 500) {
      const body = await health.text();
      throw new Error(
        `Worker boot failed: /api/public/health returned ${health.status}\n${body.slice(0, 600)}`,
      );
    }

    console.log("[ssr-boot-test] worker booted cleanly");
  } finally {
    child.kill("SIGTERM");
  }
}

void main().catch((e) => {
  const stack = e instanceof Error ? (e.stack ?? `${e.name}: ${e.message}`) : String(e);
  console.error(e);
  appendFileSync(ERROR_LOG, `[ssr-boot-test] FAILED at ${new Date().toISOString()}\n${stack}\n`);
  child.kill("SIGTERM");
  process.exit(1);
});
