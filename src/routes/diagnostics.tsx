import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  readDiagnostics,
  clearDiagnostics,
  readEvents,
  clearEvents,
  subscribeEvents,
  type DiagEntry,
  type DiagEvent,
} from "@/lib/diagnostics";
import { getQueueState } from "@/lib/wallet/txQueue";

export const Route = createFileRoute("/diagnostics")({
  head: () => ({
    meta: [
      { title: "Diagnostics — BAYCMC" },
      { name: "description", content: "Latest client errors and structured wallet/auth events." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: DiagnosticsPage,
});

function DiagnosticsPage() {
  const [entries, setEntries] = useState<DiagEntry[]>([]);
  const [events, setEvents] = useState<DiagEvent[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [tab, setTab] = useState<"events" | "errors">("events");
  const [filter, setFilter] = useState<"all" | "auth" | "wallet" | "tx" | "rpc" | "env" | "ui">(
    "all",
  );
  const [queueState, setQueueState] = useState(() => getQueueState());

  useEffect(() => {
    setEntries(readDiagnostics());
    setEvents(readEvents());
    setHydrated(true);
    const unsub = subscribeEvents(setEvents);
    const id = window.setInterval(() => setQueueState(getQueueState()), 1000);
    return () => {
      unsub();
      window.clearInterval(id);
    };
  }, []);

  function refresh() {
    setEntries(readDiagnostics());
    setEvents(readEvents());
  }

  function clearAll() {
    clearDiagnostics();
    clearEvents();
    setEntries([]);
    setEvents([]);
    toast.success("Diagnostics cleared");
  }

  async function copyAll() {
    const payload = JSON.stringify({ events, errors: entries, queue: queueState }, null, 2);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(payload);
        toast.success("Copied to clipboard");
      } else {
        throw new Error("Clipboard unavailable");
      }
    } catch {
      toast.error("Copy failed — select the text manually");
    }
  }

  const filteredEvents =
    filter === "all" ? events : events.filter((e) => e.category === filter);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Diagnostics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Structured auth / wallet / transaction events plus uncaught errors.
          </p>
        </div>
        <Link
          to="/"
          className="rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-xs hover:bg-secondary"
        >
          Back home
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 rounded-md border border-border bg-secondary/20 px-3 py-2 text-xs">
        <div>
          <div className="text-[10px] uppercase text-muted-foreground">Queue depth</div>
          <div className="font-mono text-foreground">{queueState.depth}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-muted-foreground">Running</div>
          <div className="font-mono text-foreground">{queueState.running ? "yes" : "no"}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-muted-foreground">High-water</div>
          <div className="font-mono text-foreground">{queueState.highWater}</div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          onClick={() => setTab("events")}
          className={`rounded-md border px-3 py-1.5 text-xs ${
            tab === "events"
              ? "border-gold bg-gold/10 text-gold"
              : "border-border bg-secondary/40 hover:bg-secondary"
          }`}
        >
          Events ({events.length})
        </button>
        <button
          onClick={() => setTab("errors")}
          className={`rounded-md border px-3 py-1.5 text-xs ${
            tab === "errors"
              ? "border-gold bg-gold/10 text-gold"
              : "border-border bg-secondary/40 hover:bg-secondary"
          }`}
        >
          Errors ({entries.length})
        </button>
        <button
          onClick={refresh}
          className="rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-xs hover:bg-secondary"
        >
          Refresh
        </button>
        <button
          onClick={copyAll}
          className="rounded-md bg-gradient-gold px-3 py-1.5 text-xs font-semibold text-gold-foreground shadow-gold"
        >
          Copy all
        </button>
        <button
          onClick={clearAll}
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/20"
        >
          Clear
        </button>
      </div>

      {tab === "events" && (
        <>
          <div className="mt-4 flex flex-wrap gap-1 text-[11px]">
            {(["all", "auth", "wallet", "tx", "rpc", "env", "ui"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setFilter(c)}
                className={`rounded px-2 py-0.5 ${
                  filter === c
                    ? "bg-gold/20 text-gold"
                    : "bg-secondary/30 text-muted-foreground hover:bg-secondary/60"
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          {!hydrated ? (
            <div className="mt-4 h-24 animate-pulse rounded-md bg-muted/30" />
          ) : filteredEvents.length === 0 ? (
            <div className="mt-4 rounded-xl border border-border bg-secondary/20 p-6 text-sm text-muted-foreground">
              No events yet. Sign in or send a transaction to populate.
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {filteredEvents.map((e, i) => (
                <li
                  key={i}
                  className="rounded-md border border-border bg-secondary/20 px-3 py-2 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                        e.level === "error"
                          ? "bg-destructive/20 text-destructive"
                          : e.level === "warn"
                            ? "bg-gold/20 text-gold"
                            : "bg-muted/30 text-muted-foreground"
                      }`}
                    >
                      {e.category}:{e.level}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">{e.ts}</span>
                  </div>
                  <div className="mt-1 text-sm text-foreground">{e.message}</div>
                  {e.data && (
                    <pre className="mt-1 overflow-auto rounded bg-background/40 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                      {JSON.stringify(e.data, null, 2)}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {tab === "errors" && (
        <>
          {!hydrated ? (
            <div className="mt-8 h-24 animate-pulse rounded-md bg-muted/30" />
          ) : entries.length === 0 ? (
            <div className="mt-8 rounded-xl border border-border bg-secondary/20 p-6 text-sm text-muted-foreground">
              No errors recorded.
            </div>
          ) : (
            <ul className="mt-6 space-y-4">
              {entries.map((e, i) => (
                <li key={i} className="rounded-xl border border-border bg-secondary/20 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="rounded bg-destructive/15 px-2 py-0.5 font-mono text-destructive">
                      {e.type}
                    </span>
                    <span className="font-mono">{e.ts}</span>
                    <span>•</span>
                    <span className="font-mono">{e.route}</span>
                  </div>
                  <div className="mt-2 text-sm font-semibold">{e.message}</div>
                  {e.source && (
                    <div className="mt-2 break-all rounded-md bg-background/40 px-3 py-2 font-mono text-[11px] text-muted-foreground">
                      {e.source}
                      {e.line ? `:${e.line}` : ""}
                      {e.column ? `:${e.column}` : ""}
                    </div>
                  )}
                  {e.stack && (
                    <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-background/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                      {e.stack}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
