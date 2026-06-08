#!/usr/bin/env bun
/**
 * Smoke test: boot `vite preview` against the production build and hit
 * a handful of routes to verify the Cloudflare Worker SSR returns 200
 * (not the `{"status":500,"unhandled":true}` we saw when polyfills
 * leaked into the worker bundle).
 *
 * Routes are intentionally broad — a public page, the auth gate, and
 * the /api/public/health endpoint — so a runtime regression in any
 * layer (router init, SSR rendering, server-route handler) fails CI.
 */
import { spawn } from "node:child_process";

const PORT = Number(process.env.SMOKE_PORT ?? 4173);
const BASE = `http://127.0.0.1:${PORT}`;
const ROUTES = ["/", "/login", "/api/public/health"];
const TIMEOUT_MS = 120_000;

const child = spawn("bunx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, NODE_ENV: "production" },
});

let serverReady = false;
child.stdout.on("data", (d) => {
  const s = d.toString();
  process.stdout.write(`[preview] ${s}`);
  if (/Local:\s+http/.test(s)) serverReady = true;
});
child.stderr.on("data", (d) => process.stderr.write(`[preview!] ${d}`));

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
    const failures: string[] = [];
    for (const path of ROUTES) {
      const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
      // 2xx and 3xx are both healthy — /login may redirect; root may
      // redirect to /lobby for fresh sessions. Only 5xx is a failure.
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
