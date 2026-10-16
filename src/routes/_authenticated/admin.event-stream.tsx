import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, UserMinus, UserPlus } from "lucide-react";
import {
  addEventStreamHost,
  getEventStreamStats,
  removeEventStreamHost,
  type StreamStats,
} from "@/server/event-stream.functions";
import { getMyAdminContext } from "@/server/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/event-stream")({
  head: () => ({ meta: [{ title: "Event Stream · Admin — BAYCmc" }] }),
  component: EventStreamAdmin,
});

/** Admin + super admin: live statistics for the Event Stream (5s refresh). */
function EventStreamAdmin() {
  const fetchStats = useServerFn(getEventStreamStats);
  const addHost = useServerFn(addEventStreamHost);
  const removeHost = useServerFn(removeEventStreamHost);
  const myCtx = useServerFn(getMyAdminContext);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  useEffect(() => {
    void myCtx()
      .then((c) => setIsSuperAdmin(!!c.isSuperAdmin))
      .catch(() => setIsSuperAdmin(false));
  }, [myCtx]);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);

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

  async function assign() {
    if (!username.trim()) return;
    setBusy(true);
    const res = await addHost({ data: { username: username.trim() } }).catch((e: Error) => ({
      ok: false as const,
      error: e.message,
    }));
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Host assigned");
    setUsername("");
    void load();
  }
  async function unassign(userId: string) {
    setBusy(true);
    await removeHost({ data: { userId } }).catch((e: Error) => toast.error(e.message));
    setBusy(false);
    void load();
  }

  const live = !!stats?.live;
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-gradient-gold sm:text-4xl">Event Stream</h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">Live statistics · refreshes every 5 seconds</p>
        </div>
        <div className="flex gap-2 text-xs">
          <Link to="/event-stream" className="rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-gold">
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
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Live stream</p>
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
            <p className="mt-2 text-xs text-muted-foreground">{live ? "Broadcasting now" : "No live broadcast"}</p>
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
                  <li key={h.userId} className="font-semibold text-gold">{h.name}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Nobody is broadcasting</p>
            )}
          </div>
        </div>
      )}
      {stats && !stats.configured && (
        <p className="mt-3 text-xs text-amber-300">LiveKit isn't configured on the server, so live numbers are unavailable.</p>
      )}

      <section className="glass mt-6 rounded-2xl p-5 shadow-card">
        <h2 className="font-display text-xl">Assigned hosts</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Only these accounts can broadcast (from their phone, in the Event Stream page).
          {isSuperAdmin ? "" : " The super admin manages this list."}
        </p>
        <ul className="mt-3 divide-y divide-border/50">
          {(stats?.assignedHosts ?? []).map((h) => (
            <li key={h.userId} className="flex items-center justify-between py-2 text-sm">
              <span>{h.name}</span>
              {isSuperAdmin && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void unassign(h.userId)}
                  className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive"
                >
                  <UserMinus className="h-3.5 w-3.5" /> Remove
                </button>
              )}
            </li>
          ))}
          {stats && stats.assignedHosts.length === 0 && (
            <li className="py-2 text-sm text-muted-foreground">No hosts assigned yet.</li>
          )}
        </ul>
        {isSuperAdmin && (
          <div className="mt-3 flex gap-2">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void assign()}
              className="inline-flex items-center gap-1 rounded-md bg-gradient-gold px-3 py-2 text-sm font-semibold text-gold-foreground"
            >
              <UserPlus className="h-4 w-4" /> Assign host
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
