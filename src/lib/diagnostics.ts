/**
 * Tiny in-app crash recorder + structured event log. We catch unhandled errors
 * and promise rejections, snapshot route + UA, and persist to localStorage so
 * the user can open /diagnostics after a refresh-induced crash and copy the
 * details back to us.
 *
 * The event log is an in-memory + localStorage ring buffer used by the wallet
 * hook, transaction queue, and other observability points to surface structured
 * events on the /diagnostics page without leaking secrets.
 *
 * SSR-safe: every browser API access is guarded.
 */
const KEY = "baycmc:lastError";
const EVT_KEY = "baycmc:events";
const MAX = 5;
const EVT_MAX = 200;

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

export type DiagEventCategory = "auth" | "wallet" | "tx" | "rpc" | "env" | "ui";
export type DiagEventLevel = "debug" | "info" | "warn" | "error";

export type DiagEvent = {
  ts: string;
  category: DiagEventCategory;
  level: DiagEventLevel;
  message: string;
  data?: Record<string, unknown>;
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

// ===== Structured event log =====

let memEvents: DiagEvent[] = [];
const subscribers = new Set<(events: DiagEvent[]) => void>();

function persistEvents() {
  const w = safeWindow();
  if (!w) return;
  try {
    w.localStorage.setItem(EVT_KEY, JSON.stringify(memEvents.slice(0, EVT_MAX)));
  } catch {
    /* noop */
  }
}

function loadEventsOnce() {
  const w = safeWindow();
  if (!w || memEvents.length > 0) return;
  try {
    const raw = w.localStorage.getItem(EVT_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) memEvents = parsed.slice(0, EVT_MAX);
  } catch {
    /* noop */
  }
}

export function logEvent(
  category: DiagEventCategory,
  level: DiagEventLevel,
  message: string,
  data?: Record<string, unknown>,
): void {
  loadEventsOnce();
  const evt: DiagEvent = {
    ts: new Date().toISOString(),
    category,
    level,
    message,
    data,
  };
  memEvents = [evt, ...memEvents].slice(0, EVT_MAX);
  persistEvents();
  // Mirror to console so devs see structured logs without opening /diagnostics.
  const tag = `[${category}:${level}]`;
  if (level === "error") console.error(tag, message, data ?? "");
  else if (level === "warn") console.warn(tag, message, data ?? "");
  else console.log(tag, message, data ?? "");
  for (const s of subscribers) {
    try {
      s(memEvents);
    } catch {
      /* noop */
    }
  }
}

export function readEvents(): DiagEvent[] {
  loadEventsOnce();
  return memEvents.slice();
}

export function clearEvents(): void {
  memEvents = [];
  const w = safeWindow();
  if (w) {
    try {
      w.localStorage.removeItem(EVT_KEY);
    } catch {
      /* noop */
    }
  }
  for (const s of subscribers) {
    try {
      s(memEvents);
    } catch {
      /* noop */
    }
  }
}

export function subscribeEvents(cb: (events: DiagEvent[]) => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}
