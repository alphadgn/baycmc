#!/usr/bin/env bun
/**
 * SSR / Cloudflare Worker boot test.
 *
 * Boots `vite preview` against the production build and asserts that the
 * Worker entry (`src/server.ts` → `@tanstack/react-start/server-entry`)
 * evaluates without throwing at module init.
 *
 * On failure, captures the worker's full stdout/stderr and the boot-error
 * stack trace as plain files at the repo root so the CI workflow can
 * upload them as artifacts:
 *   - worker-stdout.log
 *   - worker-stderr.log
 *   - boot-error.log   (the error from this script, including stack)
 */
import { spawn } from "node:child_process";
import { writeFileSync, appendFileSync } from "node:fs";

const PORT = Number(process.env.BOOT_PORT ?? 4174);
const BASE = `http://127.0.0.1:${PORT}`;
const TIMEOUT_MS = 60_000;

const STDOUT_LOG = "worker-stdout.log";
const STDERR_LOG = "worker-stderr.log";
const ERROR_LOG = "boot-error.log";

// Truncate the artifact files on each run so we never upload stale logs.
writeFileSync(STDOUT_LOG, "");
writeFileSync(STDERR_LOG, "");
writeFileSync(ERROR_LOG, "");

const child = spawn("bunx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, NODE_ENV: "production" },
});

let serverReady = false;
child.stdout.on("data", (d) => {
  const s = d.toString();
  process.stdout.write(`[preview] ${s}`);
  appendFileSync(STDOUT_LOG, s);
  if (/Local:\s+http/.test(s)) serverReady = true;
});
child.stderr.on("data", (d) => {
  const s = d.toString();
  process.stderr.write(`[preview!] ${s}`);
  appendFileSync(STDERR_LOG, s);
});

async function waitReady() {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (serverReady) {
      try {
        const r = await fetch(`${BASE}/api/public/health`);
        if (r.status < 500) return;
      } catch {
        /* keep polling */
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("preview server did not become ready in time");
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
