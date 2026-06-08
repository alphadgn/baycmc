/**
 * Inline browser polyfills for the Node globals Privy / Glyph need
 * (Buffer, process, global). Bundled into the main client entry so the
 * client can hydrate before any wallet SDK code evaluates.
 *
 * SSR-safe: all work is gated on `typeof window !== "undefined"`, and the
 * `buffer` / `process` modules are loaded via dynamic `import()` so they
 * never enter the Cloudflare Worker SSR bundle.
 */
export async function installBrowserPolyfills(): Promise<void> {
  if (typeof window === "undefined") return;
  const g = window as unknown as Record<string, unknown>;
  if (typeof g.global !== "object" || g.global === null) g.global = window;
  if (typeof g.Buffer !== "function") {
    const m = await import("buffer");
    if (typeof (window as unknown as { Buffer?: unknown }).Buffer !== "function") {
      (window as unknown as Record<string, unknown>).Buffer = m.Buffer;
    }
  }
  if (typeof g.process !== "object" || g.process === null) {
    const m = await import("process");
    const p = (m as { default?: unknown }).default ?? m;
    if (
      typeof (window as unknown as { process?: unknown }).process !== "object" ||
      (window as unknown as { process?: unknown }).process === null
    ) {
      (window as unknown as Record<string, unknown>).process = p;
    }
  }
  if (typeof g.events !== "object" || g.events === null) {
    const m = await import("events");
    if (typeof (window as unknown as { events?: unknown }).events !== "object") {
      (window as unknown as Record<string, unknown>).events = m;
    }
  }
}

export const browserPolyfillsReady = installBrowserPolyfills();
