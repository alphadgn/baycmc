import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { queryAuditLogs } from "@/server/audit.functions";

interface Log {
  id: string;
  event_type: string;
  actor_id: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export const Route = createFileRoute("/_authenticated/admin/")({
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", u.user.id);
    const ok = roles?.some((r) => r.role === "admin" || r.role === "super_admin");
    if (!ok) throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [{ title: "Admin · Audit — BAYCMC" }],
  }),
  component: AdminPage,
});

function AdminPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventType, setEventType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const query = useServerFn(queryAuditLogs);

  async function run() {
    setLoading(true);
    const res = await query({
      data: {
        eventType: eventType || undefined,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to).toISOString() : undefined,
        limit: 500,
      },
    });
    setLogs((res.logs as Log[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function exportCsv() {
    const header = "id,event_type,actor_id,target_id,created_at,metadata\n";
    const rows = logs
      .map(
        (l) =>
          `"${l.id}","${l.event_type}","${l.actor_id ?? ""}","${l.target_id ?? ""}","${
            l.created_at
          }","${JSON.stringify(l.metadata).replace(/"/g, '""')}"`,
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="font-display text-3xl text-gradient-gold sm:text-5xl">Admin · Audit Logs</h1>
        <p className="mt-1 text-xs text-muted-foreground font-sans-display sm:text-sm">
          Role changes, verifications, bookings, room joins
        </p>
      </header>

      <div className="glass mb-4 flex flex-wrap items-end gap-3 rounded-2xl p-4 shadow-card">
        <div>
          <label className="block text-[11px] text-muted-foreground">Event type</label>
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="mt-1 rounded-md border border-border bg-input px-3 py-2 text-sm font-sans-display"
          >
            <option value="">All</option>
            <option value="room.join">room.join</option>
            <option value="booking.create">booking.create</option>
            <option value="booking.cancel">booking.cancel</option>
            <option value="role.change">role.change</option>
            <option value="verification.bayc">verification.bayc</option>
            <option value="verification.otherpage">verification.otherpage</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-muted-foreground">From</label>
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 rounded-md border border-border bg-input px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-[11px] text-muted-foreground">To</label>
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 rounded-md border border-border bg-input px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={run}
          className="rounded-md bg-gradient-gold px-4 py-2 text-xs font-semibold text-gold-foreground shadow-gold font-sans-display"
        >
          Apply
        </button>
        <button
          onClick={exportCsv}
          className="rounded-md border border-gold/40 bg-gold/10 px-4 py-2 text-xs font-semibold text-gold hover:bg-gold/20 font-sans-display"
        >
          Export CSV
        </button>
      </div>

      <div className="glass overflow-x-auto rounded-2xl shadow-card">
        <table className="w-full text-left text-xs font-sans-display">
          <thead className="border-b border-border/60 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Event</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Target</th>
              <th className="px-4 py-3">Metadata</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No events match.
                </td>
              </tr>
            ) : (
              logs.map((l) => (
                <tr key={l.id} className="border-b border-border/30">
                  <td className="px-4 py-2 font-mono text-[10px]">
                    {new Date(l.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-gold">{l.event_type}</td>
                  <td className="px-4 py-2 font-mono text-[10px]">
                    {l.actor_id?.slice(0, 8) ?? "—"}
                  </td>
                  <td className="px-4 py-2 font-mono text-[10px]">
                    {l.target_id?.slice(0, 8) ?? "—"}
                  </td>
                  <td className="px-4 py-2 font-mono text-[10px] text-muted-foreground">
                    {JSON.stringify(l.metadata)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
