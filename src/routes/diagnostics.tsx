import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  readDiagnostics,
  clearDiagnostics,
  type DiagEntry,
} from "@/lib/diagnostics";

export const Route = createFileRoute("/diagnostics")({
  head: () => ({
    meta: [
      { title: "Diagnostics — BAYCMC" },
      { name: "description", content: "Latest client errors captured by BAYCMC for debugging." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: DiagnosticsPage,
});

function DiagnosticsPage() {
  const [entries, setEntries] = useState<DiagEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setEntries(readDiagnostics());
    setHydrated(true);
  }, []);

  function refresh() {
    setEntries(readDiagnostics());
  }

  function clear() {
    clearDiagnostics();
    setEntries([]);
    toast.success("Diagnostics cleared");
  }

  async function copyAll() {
    const payload = JSON.stringify(entries, null, 2);
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

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Diagnostics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Last {entries.length || 0} client error{entries.length === 1 ? "" : "s"} captured in
            this browser. Useful after a refresh-induced crash.
          </p>
        </div>
        <Link
          to="/"
          className="rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-xs hover:bg-secondary"
        >
          Back home
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          onClick={refresh}
          className="rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-xs hover:bg-secondary"
        >
          Refresh
        </button>
        <button
          onClick={copyAll}
          disabled={!entries.length}
          className="rounded-md bg-gradient-gold px-3 py-1.5 text-xs font-semibold text-gold-foreground shadow-gold disabled:opacity-40"
        >
          Copy all to clipboard
        </button>
        <button
          onClick={clear}
          disabled={!entries.length}
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/20 disabled:opacity-40"
        >
          Clear
        </button>
      </div>

      {!hydrated ? (
        <div className="mt-8 h-24 animate-pulse rounded-md bg-muted/30" />
      ) : entries.length === 0 ? (
        <div className="mt-8 rounded-xl border border-border bg-secondary/20 p-6 text-sm text-muted-foreground">
          No errors recorded. Trigger the bug, then come back to{" "}
          <code className="font-mono">/diagnostics</code>.
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {entries.map((e, i) => (
            <li
              key={i}
              className="rounded-xl border border-border bg-secondary/20 p-4"
            >
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
              <div className="mt-2 break-all text-[11px] text-muted-foreground/70">
                {e.url}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
