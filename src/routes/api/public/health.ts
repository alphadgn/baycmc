import { createFileRoute } from "@tanstack/react-router";

/**
 * Lightweight SSR health endpoint for production monitoring.
 *
 * Returns 200 with a small JSON payload describing the Worker runtime,
 * which Node-compat polyfills are reachable, and which critical env
 * vars are present. Specifically catches the failure mode where
 * `vite-plugin-node-polyfills` accidentally leaks into the Cloudflare
 * Worker bundle (Buffer/process/global getting redefined or stripped).
 *
 * Path is under `/api/public/*` so it bypasses published-site auth and
 * can be polled by uptime checks. No PII, no secrets — just booleans.
 */
export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async () => {
        const t0 = Date.now();
        const polyfills = {
          buffer: typeof (globalThis as { Buffer?: unknown }).Buffer === "function",
          process: typeof (globalThis as { process?: unknown }).process === "object",
          eventEmitter: await (async () => {
            try {
              const m = (await import("node:events")) as { EventEmitter?: unknown };
              return typeof m.EventEmitter === "function";
            } catch {
              return false;
            }
          })(),
          crypto: typeof (globalThis as { crypto?: { subtle?: unknown } }).crypto?.subtle === "object",
        };
        const env = {
          SUPABASE_URL: !!process.env.SUPABASE_URL,
          SUPABASE_PUBLISHABLE_KEY: !!process.env.SUPABASE_PUBLISHABLE_KEY,
          LIVEKIT_URL: !!process.env.LIVEKIT_URL,
        };
        const ok = polyfills.buffer && polyfills.eventEmitter && env.SUPABASE_URL;
        return new Response(
          JSON.stringify({
            ok,
            runtime: "cloudflare-worker",
            nodeCompat: typeof (globalThis as { process?: { versions?: unknown } }).process?.versions === "object",
            polyfills,
            env,
            ms: Date.now() - t0,
            at: new Date().toISOString(),
          }),
          {
            status: ok ? 200 : 503,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            },
          },
        );
      },
    },
  },
});
