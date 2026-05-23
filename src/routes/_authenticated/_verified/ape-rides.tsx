import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  startApeRide,
  endApeRide,
  requestApeRide,
  respondApeRideRequest,
} from "@/server/aperides.functions";
import { isInsideWynwood, WYNWOOD_RADIUS_METERS } from "@/lib/baycmc/wynwood";
import { useAuth } from "@/lib/auth/useAuth";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { ApeArFilter } from "@/components/ApeArFilter";

type Ride = Database["public"]["Tables"]["ape_rides"]["Row"];
type RideRequest = Database["public"]["Tables"]["ape_ride_requests"]["Row"];

export const Route = createFileRoute("/_authenticated/_verified/ape-rides")({
  head: () => ({
    meta: [
      { title: "Ape Rides — BAYC/MAYC Clubhouse" },
      {
        name: "description",
        content:
          "Pair with a member inside the Wynwood clubhouse and stream a live Ape Ride.",
      },
      { property: "og:title", content: "Ape Rides — BAYC/MAYC Clubhouse" },
      {
        property: "og:description",
        content:
          "Remote members can request a live video pairing with hosts physically inside the Wynwood, FL clubhouse.",
      },
    ],
  }),
  component: ApeRidesPage,
});

type GeoState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "denied"; reason: string }
  | { status: "ok"; lat: number; lng: number; inside: boolean };

function ApeRidesPage() {
  const { user } = useAuth();
  const [geo, setGeo] = useState<GeoState>({ status: "idle" });
  const [rides, setRides] = useState<Ride[]>([]);
  const [requests, setRequests] = useState<RideRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const startRide = useServerFn(startApeRide);
  const endRide = useServerFn(endApeRide);
  const requestRide = useServerFn(requestApeRide);
  const respondRequest = useServerFn(respondApeRideRequest);

  const loadRides = useCallback(async () => {
    const { data } = await supabase
      .from("ape_rides")
      .select("*")
      .eq("status", "live")
      .order("started_at", { ascending: false });
    setRides(data ?? []);
    setLoading(false);
  }, []);

  const loadRequests = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("ape_ride_requests")
      .select("*")
      .or(`viewer_id.eq.${user.id}`)
      .order("created_at", { ascending: false });
    setRequests(data ?? []);
  }, [user]);

  useEffect(() => {
    loadRides();
    loadRequests();
    const ch = supabase
      .channel("ape-rides")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ape_rides" },
        () => loadRides(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ape_ride_requests" },
        () => loadRequests(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [loadRides, loadRequests]);

  const checkLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setGeo({ status: "denied", reason: "Geolocation is not supported on this device." });
      return;
    }
    setGeo({ status: "loading" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setGeo({
          status: "ok",
          lat,
          lng,
          inside: isInsideWynwood({ lat, lng }),
        });
      },
      (err) => {
        setGeo({
          status: "denied",
          reason:
            err.code === err.PERMISSION_DENIED
              ? "Location permission denied. Enable it in your browser to host."
              : "Could not read your location.",
        });
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 },
    );
  }, []);

  async function handleStart() {
    if (geo.status !== "ok" || !geo.inside) return;
    const res = await startRide({ data: { lat: geo.lat, lng: geo.lng } });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Ape Ride is live");
    loadRides();
  }

  async function handleEnd(rideId: string) {
    const res = await endRide({ data: { rideId } });
    if (!res.ok) toast.error(res.error);
    else toast.success("Ride ended");
    loadRides();
  }

  async function handleRequest(rideId: string) {
    const res = await requestRide({ data: { rideId } });
    if (!res.ok) toast.error(res.error);
    else toast.success("Pairing request sent — waiting for the host");
    loadRequests();
  }

  async function handleRespond(requestId: string, accept: boolean) {
    const res = await respondRequest({ data: { requestId, accept } });
    if (!res.ok) toast.error(res.error);
    else toast.success(accept ? "Viewer accepted" : "Request declined");
    loadRequests();
  }

  const myActiveRide = rides.find((r) => r.host_id === user?.id);
  const canHost = geo.status === "ok" && geo.inside && !myActiveRide;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 sm:mb-8">
        <h1 className="font-display text-3xl text-gradient-gold sm:text-4xl">Ape Rides</h1>
        <p className="mt-2 text-xs text-muted-foreground sm:text-sm">
          Pair with a member physically inside the Wynwood, FL clubhouse and
          watch their live POV. Hosting is unlocked only when your GPS places
          you inside the clubhouse geofence.
        </p>
      </header>

      {/* Host panel */}
      <section className="glass mb-8 rounded-2xl p-6 shadow-card">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-2xl">Host an Ape Ride</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Available only inside Wynwood (~{WYNWOOD_RADIUS_METERS}m radius).
            </p>
          </div>
          {geo.status === "idle" && (
            <button
              onClick={checkLocation}
              className="rounded-md border border-border bg-secondary/50 px-4 py-2 text-sm hover:bg-secondary"
            >
              Check my location
            </button>
          )}
          {geo.status === "loading" && (
            <span className="text-xs text-muted-foreground">Locating…</span>
          )}
          {geo.status === "denied" && (
            <div className="text-xs text-destructive">{geo.reason}</div>
          )}
          {geo.status === "ok" && !geo.inside && (
            <div className="text-xs text-muted-foreground">
              You're outside Wynwood — request a ride from a host below.
            </div>
          )}
          {geo.status === "ok" && geo.inside && !myActiveRide && (
            <button
              onClick={handleStart}
              className="rounded-md bg-gradient-gold px-5 py-2 text-sm font-semibold text-gold-foreground shadow-gold"
            >
              Go live
            </button>
          )}
          {myActiveRide && (
            <div className="flex items-center gap-2">
              <Link
                to="/ape-rides/$rideId"
                params={{ rideId: myActiveRide.id }}
                className="rounded-md bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground shadow-gold"
              >
                Open my stream
              </Link>
              <button
                onClick={() => handleEnd(myActiveRide.id)}
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive hover:bg-destructive/20"
              >
                End
              </button>
            </div>
          )}
        </div>
        {!canHost && geo.status === "ok" && !geo.inside && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Your location was verified outside the clubhouse. Hosting requires
            you to be physically present in Wynwood.
          </p>
        )}
      </section>

      {/* Live rides */}
      <section className="mb-8">
        <h2 className="mb-3 font-display text-2xl">Live now</h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rides.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-secondary/30 p-6 text-center text-sm text-muted-foreground">
            No Ape Rides are live right now. Check back soon.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {rides.map((r) => {
              const isMine = r.host_id === user?.id;
              const myReq = requests.find((q) => q.ride_id === r.id);
              return (
                <li
                  key={r.id}
                  className="glass flex items-center justify-between rounded-xl p-4 shadow-card"
                >
                  <div>
                    <p className="font-display text-lg">{r.title}</p>
                    <p className="text-xs text-muted-foreground">
                      Started {new Date(r.started_at).toLocaleTimeString()}
                    </p>
                    {myReq && (
                      <p className="mt-1 text-[11px] text-gold">
                        Your request: {myReq.status}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {isMine ? (
                      <Link
                        to="/ape-rides/$rideId"
                        params={{ rideId: r.id }}
                        className="rounded-md bg-gradient-gold px-3 py-2 text-xs font-semibold text-gold-foreground shadow-gold"
                      >
                        Open
                      </Link>
                    ) : myReq?.status === "accepted" ? (
                      <Link
                        to="/ape-rides/$rideId"
                        params={{ rideId: r.id }}
                        className="rounded-md bg-gradient-gold px-3 py-2 text-xs font-semibold text-gold-foreground shadow-gold"
                      >
                        Watch
                      </Link>
                    ) : myReq?.status === "pending" ? (
                      <span className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
                        Waiting…
                      </span>
                    ) : (
                      <button
                        onClick={() => handleRequest(r.id)}
                        className="rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-xs font-semibold text-gold hover:bg-gold/20"
                      >
                        Request pairing
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Host request inbox */}
      {myActiveRide && (
        <HostRequestInbox
          rideId={myActiveRide.id}
          onRespond={handleRespond}
        />
      )}
    </div>
  );
}

function HostRequestInbox({
  rideId,
  onRespond,
}: {
  rideId: string;
  onRespond: (id: string, accept: boolean) => void;
}) {
  const [reqs, setReqs] = useState<RideRequest[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("ape_ride_requests")
      .select("*")
      .eq("ride_id", rideId)
      .order("created_at", { ascending: false });
    setReqs(data ?? []);
  }, [rideId]);

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`ride-${rideId}-reqs`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ape_ride_requests",
          filter: `ride_id=eq.${rideId}`,
        },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [rideId, load]);

  return (
    <section>
      <h2 className="mb-3 font-display text-2xl">Pairing requests</h2>
      {reqs.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-secondary/30 p-6 text-center text-sm text-muted-foreground">
          No pairing requests yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {reqs.map((r) => (
            <li
              key={r.id}
              className="glass flex items-center justify-between rounded-xl p-3 text-sm"
            >
              <div>
                <p className="font-mono text-xs text-muted-foreground">
                  {r.viewer_id.slice(0, 8)}…
                </p>
                <p className="text-xs">Status: {r.status}</p>
              </div>
              {r.status === "pending" && (
                <div className="flex gap-2">
                  <button
                    onClick={() => onRespond(r.id, true)}
                    className="rounded-md bg-gradient-gold px-3 py-1.5 text-xs font-semibold text-gold-foreground"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => onRespond(r.id, false)}
                    className="rounded-md border border-border px-3 py-1.5 text-xs"
                  >
                    Decline
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
