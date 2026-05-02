/**
 * Tiny in-app crash recorder. We catch unhandled errors + promise rejections,
 * snapshot route + UA, and persist to localStorage so the user can open
 * /diagnostics after a refresh-induced crash and copy the details back to us.
 *
 * SSR-safe: every browser API access is guarded.
 */
const KEY = "baycmc:lastError";
const MAX = 5;

export type DiagEntry = {
  ts: string;
  url: string;
  route: string;
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
  userAgent: string;
  type: "error" | "unhandledrejection";
};

function safeWindow(): Window | null {
  return typeof window === "undefined" ? null : window;
}

export function readDiagnostics(): DiagEntry[] {
  const w = safeWindow();
  if (!w) return [];
  try {
    const raw = w.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function clearDiagnostics(): void {
  const w = safeWindow();
  if (!w) return;
  try {
    w.localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}

function pushEntry(entry: DiagEntry) {
  const w = safeWindow();
  if (!w) return;
  try {
    const existing = readDiagnostics();
    const next = [entry, ...existing].slice(0, MAX);
    w.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota or serialization failed — drop silently */
  }
}

let installed = false;
export function installDiagnostics(): void {
  const w = safeWindow();
  if (!w || installed) return;
  installed = true;

  w.addEventListener("error", (e: ErrorEvent) => {
    pushEntry({
      ts: new Date().toISOString(),
      url: w.location.href,
      route: w.location.pathname,
      message: e.message || String(e.error ?? "unknown error"),
      stack: e.error instanceof Error ? e.error.stack : undefined,
      source: e.filename,
      line: e.lineno,
      column: e.colno,
      userAgent: w.navigator.userAgent,
      type: "error",
    });
  });

  w.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    pushEntry({
      ts: new Date().toISOString(),
      url: w.location.href,
      route: w.location.pathname,
      message:
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : JSON.stringify(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      userAgent: w.navigator.userAgent,
      type: "unhandledrejection",
    });
  });
}
