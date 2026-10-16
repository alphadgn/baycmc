import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";
import {
  adminCancelRide,
  adminGrantRide,
  adminListRides,
  adminSetReservation,
  adminUpdateRide,
} from "@/server/ape-rides-booking.functions";

type Data = Awaited<ReturnType<typeof adminListRides>>;
type Ride = Data["rides"][number];

interface Form {
  hostUsername: string;
  title: string;
  venue: string;
  priceApe: string;
  start: string;
  end: string;
  capacity: string;
  overrideLocation: boolean;
}

const blank: Form = {
  hostUsername: "",
  title: "Ape Ride",
  venue: "wynwood",
  priceApe: "0",
  start: "",
  end: "",
  capacity: "1",
  overrideLocation: false,
};

const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

/**
 * Super admin override for Ape Rides: grant rides to a host (schedule, price
 * in APE, location / geofence waiver, seats), edit or cancel any ride, and
 * override any reservation's status.
 */
export function ApeRidesAdminTab() {
  const list = useServerFn(adminListRides);
  const grant = useServerFn(adminGrantRide);
  const update = useServerFn(adminUpdateRide);
  const cancelRide = useServerFn(adminCancelRide);
  const setResv = useServerFn(adminSetReservation);
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await list());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load rides");
    }
  }, [list]);
  useEffect(() => {
    void load();
  }, [load]);

  const resvByRide = useMemo(() => {
    const m = new Map<string, Data["reservations"]>();
    for (const r of data?.reservations ?? []) m.set(r.ride_id, [...(m.get(r.ride_id) ?? []), r]);
    return m;
  }, [data]);
  const paidByRide = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of data?.payments ?? [])
      m.set(p.ride_id, (m.get(p.ride_id) ?? 0) + Number(p.amount_wei) / 1e18);
    return m;
  }, [data]);

  function edit(r: Ride) {
    setEditing(r.id);
    setForm({
      hostUsername: data?.names[r.host_id] ?? "",
      title: r.title,
      venue: r.venue_slug ?? "wynwood",
      priceApe: String(r.price_ape ?? 0),
      start: toLocal(r.scheduled_start),
      end: toLocal(r.scheduled_end),
      capacity: String(r.capacity ?? 1),
      overrideLocation: !!r.admin_override,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit() {
    const fields = {
      title: form.title.trim() || "Ape Ride",
      venue: form.venue,
      priceApe: Math.max(0, Number(form.priceApe) || 0),
      scheduledStart: toIso(form.start),
      scheduledEnd: toIso(form.end),
      capacity: Math.min(50, Math.max(1, Math.round(Number(form.capacity) || 1))),
      overrideLocation: form.overrideLocation,
    };
    setBusy(true);
    const res = editing
      ? await update({ data: { ...fields, rideId: editing } })
      : await grant({ data: { ...fields, hostUsername: form.hostUsername.trim() } });
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success(editing ? "Ride updated" : "Ride granted");
    setEditing(null);
    setForm(blank);
    void load();
  }

  async function cancel(r: Ride) {
    if (!window.confirm(`Cancel "${r.title}"? Unpaid reservations are cancelled too.`)) return;
    const res = await cancelRide({ data: { rideId: r.id } });
    if (!res.ok) return void toast.error(res.error);
    toast.success("Ride cancelled");
    void load();
  }

  const input = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
  if (!data) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <section className="glass rounded-2xl p-4 shadow-card sm:p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl">{editing ? "Edit ride" : "Grant a ride"}</h2>
          {editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setForm(blank);
              }}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" /> Stop editing
            </button>
          )}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {!editing && (
            <label className="text-xs">
              Host username
              <input className={input} value={form.hostUsername} onChange={(e) => setForm({ ...form, hostUsername: e.target.value })} />
            </label>
          )}
          <label className="text-xs">
            Title
            <input className={input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <label className="text-xs">
            Location
            <select className={input} value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })}>
              {data.venues.map((v) => (
                <option key={v.slug} value={v.slug}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Price (APE, 0 = free)
            <input className={input} type="number" min={0} step="0.01" value={form.priceApe} onChange={(e) => setForm({ ...form, priceApe: e.target.value })} />
          </label>
          <label className="text-xs">
            Starts
            <input className={input} type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
          </label>
          <label className="text-xs">
            Ends
            <input className={input} type="datetime-local" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
          </label>
          <label className="text-xs">
            Seats (viewers)
            <input className={input} type="number" min={1} max={50} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
          </label>
          <label className="flex items-center gap-2 self-end text-xs">
            <input type="checkbox" checked={form.overrideLocation} onChange={(e) => setForm({ ...form, overrideLocation: e.target.checked })} />
            Waive the GPS location check for this ride
          </label>
        </div>
        <button
          type="button"
          disabled={busy || (!editing && !form.hostUsername.trim())}
          onClick={() => void submit()}
          className="mt-4 inline-flex items-center gap-1 rounded-md bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground disabled:opacity-60"
        >
          <Plus className="h-4 w-4" /> {editing ? "Save changes" : "Grant ride"}
        </button>
      </section>

      <section className="glass rounded-2xl p-4 shadow-card sm:p-6">
        <h2 className="font-display text-2xl">All rides</h2>
        <ul className="mt-4 space-y-3">
          {data.rides.map((r) => {
            const resv = resvByRide.get(r.id) ?? [];
            return (
              <li key={r.id} className="rounded-lg border border-border/60 bg-secondary/20 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {r.title}{" "}
                      <span className="ml-1 rounded-sm bg-gold/10 px-1.5 py-0.5 text-[10px] uppercase text-gold">{r.status}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Host {data.names[r.host_id] ?? "Member"} ·{" "}
                      {data.venues.find((v) => v.slug === r.venue_slug)?.name ?? "—"} ·{" "}
                      {Number(r.price_ape) > 0 ? `${Number(r.price_ape)} APE` : "Free"} · {resv.filter((x) => x.status !== "cancelled").length}/{r.capacity} seats ·{" "}
                      {(paidByRide.get(r.id) ?? 0).toString()} APE collected
                      {r.scheduled_start ? ` · ${new Date(r.scheduled_start).toLocaleString()}` : ""}
                      {r.admin_override ? " · GPS waived" : ""}
                    </p>
                  </div>
                  {(r.status === "scheduled" || r.status === "live") && (
                    <div className="flex gap-2">
                      <button type="button" onClick={() => edit(r)} className="rounded-md border border-gold/40 px-2 py-1 text-xs text-gold">
                        Edit
                      </button>
                      <button type="button" onClick={() => void cancel(r)} className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive">
                        Cancel ride
                      </button>
                    </div>
                  )}
                </div>
                {resv.length > 0 && (
                  <ul className="mt-2 space-y-1 border-t border-border/40 pt-2">
                    {resv.map((x) => (
                      <li key={x.id} className="flex items-center justify-between gap-2 text-xs">
                        <span>
                          {data.names[x.viewer_id] ?? "Member"} · {x.status}
                        </span>
                        <select
                          aria-label="Override reservation"
                          value={x.status}
                          onChange={async (e) => {
                            const res = await setResv({
                              data: { reservationId: x.id, status: e.target.value as "reserved" | "paid" | "cancelled" },
                            });
                            if (!res.ok) toast.error(res.error);
                            void load();
                          }}
                          className="rounded border border-border bg-background px-1 py-0.5"
                        >
                          <option value="reserved">reserved</option>
                          <option value="paid">paid (override)</option>
                          <option value="cancelled">cancelled</option>
                        </select>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
          {data.rides.length === 0 && <li className="text-sm text-muted-foreground">No rides yet.</li>}
        </ul>
      </section>
    </div>
  );
}
