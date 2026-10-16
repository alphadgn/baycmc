import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { formatEther } from "viem";
import { useAccount, useConnect, useSendTransaction, useSwitchChain } from "wagmi";
import { CalendarClock, Loader2, MapPin, Ticket, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import {
  cancelMyReservation,
  confirmRidePayment,
  getReservationPayTo,
  reserveApeRide,
  startGrantedRide,
} from "@/server/ape-rides-booking.functions";
import { GLYPH_CONNECTOR_ID } from "@/components/GlyphAppProvider";
import type { Database } from "@/integrations/supabase/types";

type Ride = Database["public"]["Tables"]["ape_rides"]["Row"];
type Reservation = Database["public"]["Tables"]["ape_ride_reservations"]["Row"];
type Payment = Database["public"]["Tables"]["ape_ride_payments"]["Row"];

function when(r: Pick<Ride, "scheduled_start" | "scheduled_end" | "status">) {
  if (r.status === "live") return "Live now";
  if (!r.scheduled_start) return "Time to be announced";
  const s = new Date(r.scheduled_start);
  const e = r.scheduled_end ? new Date(r.scheduled_end) : null;
  const d = s.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const t = (x: Date) => x.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${d} · ${t(s)}${e ? `–${t(e)}` : ""}`;
}
function apeAmount(wei: number | string) {
  try {
    return formatEther(
      BigInt(
        typeof wei === "number"
          ? Math.round(wei).toLocaleString("fullwide", { useGrouping: false })
          : wei,
      ),
    );
  } catch {
    return (Number(wei) / 1e18).toString();
  }
}
const price = (n: number | string) => (Number(n) > 0 ? `${Number(n)} APE` : "Free");

/** Rides, reservations and payments for the signed-in member. */
export function ApeRidesBookings() {
  const { user } = useAuth();
  const [rides, setRides] = useState<Ride[]>([]);
  const [mine, setMine] = useState<Reservation[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [venues, setVenues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const reserve = useServerFn(reserveApeRide);
  const cancel = useServerFn(cancelMyReservation);
  const payTo = useServerFn(getReservationPayTo);
  const confirm = useServerFn(confirmRidePayment);
  const startRide = useServerFn(startGrantedRide);
  const { isConnected, address, chainId } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();

  const load = useCallback(async () => {
    if (!user) return;
    const [r, m, p, v] = await Promise.all([
      supabase
        .from("ape_rides")
        .select("*")
        .in("status", ["scheduled", "live"])
        .order("scheduled_start", { ascending: true, nullsFirst: false }),
      supabase
        .from("ape_ride_reservations")
        .select("*")
        .eq("viewer_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("ape_ride_payments")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("ape_ride_venues").select("slug,name"),
    ]);
    const rideRows = (r.data ?? []) as Ride[];
    const payRows = (p.data ?? []) as Payment[];
    setRides(rideRows);
    setMine((m.data ?? []) as Reservation[]);
    setPayments(payRows);
    setVenues(Object.fromEntries((v.data ?? []).map((x) => [x.slug, x.name])));
    const ids = [
      ...new Set([
        ...rideRows.map((x) => x.host_id),
        ...payRows.flatMap((x) => [x.host_id, x.payer_id]),
      ]),
    ];
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id,username").in("id", ids);
      setNames(Object.fromEntries((profs ?? []).map((x) => [x.id, x.username ?? "Member"])));
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
    const ch = supabase
      .channel(`ape-ride-bookings-${Math.random().toString(36).slice(2, 10)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ape_rides" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ape_ride_reservations" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [load]);

  const myByRide = useMemo(
    () => new Map(mine.filter((m) => m.status !== "cancelled").map((m) => [m.ride_id, m])),
    [mine],
  );
  const rideById = useMemo(() => new Map(rides.map((r) => [r.id, r])), [rides]);

  async function doReserve(ride: Ride) {
    setBusy(ride.id);
    const res = await reserve({ data: { rideId: ride.id } }).catch((e: Error) => ({
      ok: false as const,
      error: e.message,
    }));
    setBusy(null);
    if (!res.ok) return void toast.error(res.error);
    toast.success(
      Number(ride.price_ape) > 0 ? "Reserved — pay to confirm your seat" : "You're booked",
    );
    void load();
  }

  async function doPay(resv: Reservation) {
    setBusy(resv.id);
    try {
      const info = await payTo({ data: { reservationId: resv.id } });
      if (!info.ok) throw new Error(info.error);
      if (!isConnected || !address) {
        const c = connectors.find((x) => x.id === GLYPH_CONNECTOR_ID) ?? connectors[0];
        if (!c) throw new Error("Connect a wallet to pay.");
        await connectAsync({ connector: c });
      }
      if (chainId !== info.chainId) await switchChainAsync({ chainId: info.chainId });
      const hash = await sendTransactionAsync({
        to: info.payTo as `0x${string}`,
        value: BigInt(info.amountWei),
        chainId: info.chainId,
      });
      toast.message("Payment sent — confirming on ApeChain…");
      const res = await confirm({ data: { reservationId: resv.id, txHash: hash } });
      if (!res.ok) throw new Error(res.error);
      toast.success("Payment confirmed. Your seat is locked in.");
      void load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/rejected|denied|cancel/i.test(msg)) toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  async function doCancel(resv: Reservation) {
    setBusy(resv.id);
    const res = await cancel({ data: { reservationId: resv.id } }).catch((e: Error) => ({
      ok: false as const,
      error: e.message,
    }));
    setBusy(null);
    if (!res.ok) return void toast.error(res.error);
    void load();
  }

  function doStart(ride: Ride) {
    setBusy(ride.id);
    const go = async (lat?: number, lng?: number) => {
      const res = await startRide({ data: { rideId: ride.id, lat, lng } }).catch((e: Error) => ({
        ok: false as const,
        error: e.message,
      }));
      setBusy(null);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Your ride is live");
      void load();
    };
    if (ride.admin_override || !("geolocation" in navigator)) return void go();
    navigator.geolocation.getCurrentPosition(
      (p) => void go(p.coords.latitude, p.coords.longitude),
      () => {
        setBusy(null);
        toast.error("Allow location to start this ride.");
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  if (!user) return null;
  const section = "glass mb-6 rounded-2xl p-5 shadow-card sm:p-6";
  const empty =
    "mt-4 rounded-lg border border-dashed border-border/60 p-4 text-center text-sm text-muted-foreground";
  const row =
    "flex flex-col gap-2 rounded-lg border border-border/60 bg-secondary/20 p-3 sm:flex-row sm:items-center sm:justify-between";
  const goldBtn =
    "rounded-md bg-gradient-gold px-3 py-1.5 text-xs font-semibold text-gold-foreground disabled:opacity-60";

  return (
    <>
      <section className={section}>
        <h2 className="flex items-center gap-2 font-display text-2xl">
          <CalendarClock className="h-5 w-5 text-gold" /> Rides
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Scheduled and live rides you can reserve.
        </p>
        {loading ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : rides.length === 0 ? (
          <p className={empty}>No rides scheduled yet.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {rides.map((r) => {
              const mineR = myByRide.get(r.id);
              const isHost = r.host_id === user.id;
              const canJoin =
                r.status === "live" &&
                !!mineR &&
                (mineR.status === "paid" || Number(mineR.price_ape) === 0);
              return (
                <li key={r.id} className={row}>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{r.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {when(r)} · Host {names[r.host_id] ?? "Member"} ·{" "}
                      <MapPin className="inline h-3 w-3" />{" "}
                      {venues[r.venue_slug ?? ""] ?? "Clubhouse"}
                      {r.admin_override ? " · location waived" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-sm border border-gold/40 px-2 py-0.5 text-xs text-gold">
                      {price(r.price_ape)}
                    </span>
                    {isHost ? (
                      r.status === "scheduled" ? (
                        <button
                          type="button"
                          disabled={busy === r.id}
                          onClick={() => doStart(r)}
                          className={goldBtn}
                        >
                          {busy === r.id ? "Starting…" : "Start ride"}
                        </button>
                      ) : (
                        <Link to="/ape-rides/$rideId" params={{ rideId: r.id }} className={goldBtn}>
                          Open
                        </Link>
                      )
                    ) : canJoin ? (
                      <Link to="/ape-rides/$rideId" params={{ rideId: r.id }} className={goldBtn}>
                        Join
                      </Link>
                    ) : mineR ? (
                      <span className="text-xs text-emerald-300">Reserved</span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy === r.id}
                        onClick={() => void doReserve(r)}
                        className="rounded-md border border-gold/50 bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold disabled:opacity-60"
                      >
                        {busy === r.id ? "Reserving…" : "Reserve"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={section}>
        <h2 className="flex items-center gap-2 font-display text-2xl">
          <Ticket className="h-5 w-5 text-gold" /> My reservations
        </h2>
        {mine.length === 0 ? (
          <p className={empty}>No reservations yet.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {mine.map((m) => {
              const r = rideById.get(m.ride_id);
              const owes = m.status === "reserved" && Number(m.price_ape) > 0;
              const label =
                m.status === "reserved" && Number(m.price_ape) === 0 ? "booked" : m.status;
              return (
                <li key={m.id} className={row}>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{r?.title ?? "Ape Ride"}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {r ? when(r) : "Ride closed"} · {price(m.price_ape)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`rounded-sm px-2 py-0.5 text-[10px] font-bold uppercase ${
                        m.status === "paid" || label === "booked"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : m.status === "cancelled"
                            ? "bg-destructive/15 text-destructive"
                            : "bg-amber-500/15 text-amber-300"
                      }`}
                    >
                      {owes ? "awaiting payment" : label}
                    </span>
                    {owes && (
                      <button
                        type="button"
                        disabled={busy === m.id}
                        onClick={() => void doPay(m)}
                        className={`inline-flex items-center gap-1 ${goldBtn}`}
                      >
                        <Wallet className="h-3.5 w-3.5" />
                        {busy === m.id ? "Paying…" : `Pay ${Number(m.price_ape)} APE`}
                      </button>
                    )}
                    {m.status === "reserved" && (
                      <button
                        type="button"
                        disabled={busy === m.id}
                        onClick={() => void doCancel(m)}
                        className="rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={section}>
        <h2 className="flex items-center gap-2 font-display text-2xl">
          <Wallet className="h-5 w-5 text-gold" /> Payments
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          APE on ApeChain, verified on-chain. Rides you paid for and rides you hosted.
        </p>
        {payments.length === 0 ? (
          <p className={empty}>No payments yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border/50">
            {payments.map((p) => {
              const incoming = p.host_id === user.id;
              return (
                <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-xs">
                  <span className="min-w-0 truncate">
                    {incoming
                      ? `From ${names[p.payer_id] ?? "Member"}`
                      : `To ${names[p.host_id] ?? "host"}`}{" "}
                    · {new Date(p.created_at).toLocaleDateString()}
                  </span>
                  <a
                    href={`https://apescan.io/tx/${p.tx_hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className={`shrink-0 font-mono ${incoming ? "text-emerald-300" : "text-gold"}`}
                  >
                    {incoming ? "+" : "−"}
                    {apeAmount(p.amount_wei)} APE ↗
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
