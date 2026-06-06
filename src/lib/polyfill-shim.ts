/**
 * Inline browser polyfills for the Node globals that Privy / Glyph need.
 *
 * Replaces `vite-plugin-node-polyfills`' `globals` option, which injected a
 * separate `vite-plugin-node-polyfills_shims_process.js` chunk fetched from
 * `node_modules/.vite/deps/` at runtime. When the sandbox preview returned
 * 401/502/504 for that chunk, the entire client entry failed to evaluate
 * and React never hydrated — every onClick (VIP, hamburger, etc.) became
 * a no-op while the SSR HTML kept rendering. Bundling the polyfills inline
 * removes that single point of failure.
 *
 * Imported at the top of `src/start.ts` so it runs before any module that
 * touches `Buffer`/`process`/`global`. SSR-safe: the assignments are gated
 * on `typeof window !== "undefined"`.
 */
import { Buffer as NodeBuffer } from "buffer";
import nodeProcess from "process";

if (typeof window !== "undefined") {
  const g = window as unknown as Record<string, unknown>;
  if (typeof g.Buffer !== "function") g.Buffer = NodeBuffer;
  if (typeof g.process !== "object" || g.process === null) g.process = nodeProcess;
  if (typeof g.global !== "object" || g.global === null) g.global = window;
}

export {};
