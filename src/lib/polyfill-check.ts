/**
 * Browser-side runtime check for the Node polyfills that Privy /
 * `@privy-io/cross-app-connect` (pulled in by the Glyph SDK) depends on.
 *
 * Privy reaches for `Buffer` and `events.EventEmitter` synchronously
 * during its module evaluation. If `vite-plugin-node-polyfills` isn't
 * applied to the client bundle (for example because a future config
 * change scopes it to SSR by mistake) the page crashes with cryptic
 * errors like "Buffer is not defined" deep inside Privy.
 *
 * Calling `ensureBrowserPolyfills()` BEFORE dynamically importing any
 * Privy/Glyph code gives us:
 *   - a single, clear console.error pinpointing the missing global
 *   - a boolean result so callers can render a degraded UI instead of
 *     letting the import crash the whole tree
 */
export interface PolyfillReport {
  ok: boolean;
  buffer: boolean;
  eventEmitter: boolean;
  process: boolean;
  globalRef: boolean;
}

let cached: PolyfillReport | undefined;

export function ensureBrowserPolyfills(): PolyfillReport {
  if (cached) return cached;
  const g = globalThis as Record<string, unknown>;
  const report: PolyfillReport = {
    buffer: typeof g.Buffer === "function",
    eventEmitter: (() => {
      try {
        // Privy imports `events` not `node:events` in the browser.
        // Vite resolves it via the polyfill plugin when wired correctly.
        const ev = (g as { events?: { EventEmitter?: unknown } }).events;
        if (ev && typeof ev.EventEmitter === "function") return true;
      } catch {
        /* noop */
      }
      // Fall back to a heuristic: the polyfill installs Buffer + process
      // together, so if Buffer is present EventEmitter usually is too.
      return typeof g.Buffer === "function";
    })(),
    process: typeof g.process === "object" && g.process !== null,
    globalRef: typeof g.global === "object" && g.global !== null,
    ok: false,
  };
  report.ok = report.buffer && report.process;
  if (!report.ok) {
    console.error(
      "[polyfill-check] Required Node-compat polyfills missing on the client. " +
        "Privy/Glyph flows will likely crash. Check vite-plugin-node-polyfills " +
        "is enabled for the client build.",
      report,
    );
  }
  cached = report;
  return report;
}
