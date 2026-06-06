/**
 * Inline browser polyfills for the Node globals Privy / Glyph need
 * (Buffer, process, global). Bundled into the main client entry so we
 * never depend on `vite-plugin-node-polyfills`' separate `_shims_*.js`
 * deps chunk — when that chunk 401/502s in the sandbox preview, the
 * client entry stops evaluating and React never hydrates (every onClick,
 * including the VIP button, becomes inert while SSR HTML keeps rendering).
 *
 * SSR-safe: all work is gated on `typeof window !== "undefined"`, and the
 * `buffer` / `process` modules are loaded via dynamic `import()` so they
 * never enter the Cloudflare Worker SSR bundle.
 */
export function installBrowserPolyfills(): void {
  if (typeof window === "undefined") return;
  const g = window as unknown as Record<string, unknown>;
  if (typeof g.global !== "object" || g.global === null) g.global = window;
  if (typeof g.Buffer !== "function") {
    void import("buffer").then((m) => {
      if (typeof (window as unknown as { Buffer?: unknown }).Buffer !== "function") {
        (window as unknown as Record<string, unknown>).Buffer = m.Buffer;
      }
    });
  }
  if (typeof g.process !== "object" || g.process === null) {
    void import("process").then((m) => {
      const p = (m as { default?: unknown }).default ?? m;
      if (
        typeof (window as unknown as { process?: unknown }).process !== "object" ||
        (window as unknown as { process?: unknown }).process === null
      ) {
        (window as unknown as Record<string, unknown>).process = p;
      }
    });
  }
}

if (typeof window !== "undefined") {
  installBrowserPolyfills();
}
