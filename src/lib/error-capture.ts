/**
 * Captures otherwise-swallowed SSR errors via globalThis listeners so the
 * server wrapper can correlate them with h3's stringified 500 response.
 */
let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

function record(error: unknown) {
  lastCapturedError = { error, at: Date.now() };
}

if (typeof globalThis.addEventListener === "function") {
  try {
    globalThis.addEventListener("error", (event) =>
      record((event as ErrorEvent).error ?? event),
    );
    globalThis.addEventListener("unhandledrejection", (event) =>
      record((event as PromiseRejectionEvent).reason),
    );
  } catch {
    /* listener registration not supported in this runtime — noop */
  }
}

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}
