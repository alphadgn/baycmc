/**
 * Retry helper for dynamic `import()` calls. Vite emits each `import("…")`
 * as a JS chunk fetched on demand. CDN cold starts, brief network blips,
 * and stale cached HTML pointing at a hash that just rolled all surface
 * as "Loading chunk N failed" / "Failed to fetch dynamically imported
 * module" errors. A single retry after a short backoff resolves the vast
 * majority of these without bothering the user.
 */
export async function importWithRetry<T>(
  load: () => Promise<T>,
  opts: { attempts?: number; delayMs?: number; label?: string } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const delayMs = opts.delayMs ?? 400;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await load();
    } catch (e) {
      lastError = e;
      if (!isChunkLoadError(e) || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastError;
}

function isChunkLoadError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  return (
    msg.includes("loading chunk") ||
    msg.includes("loading css chunk") ||
    msg.includes("failed to fetch dynamically imported module") ||
    msg.includes("importing a module script failed")
  );
}
