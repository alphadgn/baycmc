/**
 * Module-init smoke test for the Cloudflare Worker entry (src/server.ts).
 *
 * Asserts that simply importing the worker entry — and its always-on
 * dependencies (error-capture side-effect listeners, error-page renderer,
 * polyfill-shim if loaded server-side) — does not throw at module init.
 *
 * This catches the class of regression where a top-level `import` pulls in
 * a CJS package (e.g. `process`, `buffer`) whose initializer crashes the
 * Cloudflare Worker with `TypeError: Cannot set properties of undefined
 * (setting 'exports')` before `fetch` is ever called.
 *
 * The deep SSR/worker boot test (scripts/ssr-boot-test.ts) catches the
 * runtime variant; this catches the build/import variant in <1s without
 * needing a production build.
 */
import { describe, it, expect } from "vitest";

describe("Cloudflare Worker entry module init", () => {
  it("imports src/server.ts without throwing", async () => {
    const mod = await import("../../src/server");
    expect(mod).toBeDefined();
    expect(mod.default).toBeDefined();
    expect(typeof (mod.default as { fetch: unknown }).fetch).toBe("function");
  });

  it("imports error-capture side-effect listeners without throwing", async () => {
    const mod = await import("../../src/lib/error-capture");
    expect(typeof mod.consumeLastCapturedError).toBe("function");
  });

  it("imports error-page renderer without throwing", async () => {
    const mod = await import("../../src/lib/error-page");
    expect(typeof mod.renderErrorPage).toBe("function");
    const html = mod.renderErrorPage();
    expect(html).toContain("<html");
  });

  it("imports src/start.ts without throwing (no polyfill leak)", async () => {
    const mod = await import("../../src/start");
    expect(mod.startInstance).toBeDefined();
  });
});
