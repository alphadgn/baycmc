import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { getEventStreamStats, type StreamStats } from "@/server/event-stream.functions";
import {
  StreamGrantsPanel,
  StreamPayPerViewPanel,
} from "@/components/eventstream/StreamAdminPanels";

export const Route = createFileRoute("/_authenticated/admin/event-stream")({
  head: () => ({ meta: [{ title: "Event Stream · Admin — BAYCmc" }] }),
  component: EventStreamAdmin,
});

/** Admin + super admin: live statistics for the Event Stream (5s refresh). */
function EventStreamAdmin() {
  const fetchStats = useServerFn(getEventStreamStats);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStats(await fetchStats());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load stats");
    }
  }, [fetchStats]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(t);
  }, [load]);

  const live = !!stats?.live;
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-gradient-gold sm:text-4xl">Event Stream</h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Live statistics · refreshes every 5 seconds
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <Link
            to="/event-stream"
            className="rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-gold"
          >
            Open stream →
          </Link>
          <Link to="/admin" className="rounded-md border border-border px-3 py-2">
            Admin
          </Link>
        </div>
      </header>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {!stats ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="glass rounded-2xl p-5 shadow-card">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Live stream
            </p>
            <div className="mt-3 flex items-center gap-3">
              <span className="font-display text-2xl">Live</span>
              <span
                aria-label={live ? "Live" : "Not live"}
                className={`h-5 w-5 rounded-full ${
                  live
                    ? "bg-emerald-400 shadow-[0_0_16px_4px_rgba(52,211,153,0.7)]"
                    : "bg-red-500 shadow-[0_0_16px_4px_rgba(239,68,68,0.6)]"
                }`}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {live ? "Broadcasting now" : "No live broadcast"}
            </p>
          </div>
          <div className="glass rounded-2xl p-5 shadow-card">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Capacity</p>
            <p className="mt-3 font-mono text-3xl text-gold">
              {stats.viewers}
              <span className="text-lg text-muted-foreground">/{stats.capacity}</span>
            </p>
            <p className="mt-2 text-xs text-muted-foreground">Viewers watching right now</p>
          </div>
          <div className="glass rounded-2xl p-5 shadow-card">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Hosted by</p>
            {stats.hostedBy.length ? (
              <ul className="mt-3 space-y-1">
                {stats.hostedBy.map((h) => (
                  <li key={h.userId} className="font-semibold text-gold">
                    {h.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Nobody is broadcasting</p>
            )}
          </div>
        </div>
      )}
      {stats && !stats.configured && (
        <p className="mt-3 text-xs text-amber-300">
          LiveKit isn't configured on the server, so live numbers are unavailable.
        </p>
      )}

      <StreamGrantsPanel stats={stats} onChange={() => void load()} />
      <StreamPayPerViewPanel />
    </main>
  );
}
