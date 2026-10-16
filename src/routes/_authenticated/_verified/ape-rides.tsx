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
import { haversineMeters } from "@/lib/baycmc/wynwood";
import { MapPin, X } from "lucide-react";
import { useAuth } from "@/lib/auth/useAuth";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { ApeArFilter } from "@/components/ApeArFilter";
import { ApeRidesBookings } from "@/components/aperides/ApeRidesBookings";

type Ride = Database["public"]["Tables"]["ape_rides"]["Row"];
type Venue = Pick<
  Database["public"]["Tables"]["ape_ride_venues"]["Row"],
  "slug" | "name" | "lat" | "lng" | "radius_m"
>;
type RideRequest = Database["public"]["Tables"]["ape_ride_requests"]["Row"];

export const Route = createFileRoute("/_authenticated/_verified/ape-rides")({
  head: () => ({
    meta: [
      { title: "Ape Rides — BAYC/MAYC Clubhouse" },
      {
        name: "description",
        content: "Pair with a member at a BAYCmc clubhouse location and stream a live Ape Ride.",
      },
      { property: "og:title", content: "Ape Rides — BAYC/MAYC Clubhouse" },
      {
        property: "og:description",
        content:
          "Remote members can request a live video pairing with hosts physically at a BAYCmc clubhouse location.",
      },
    ],
  }),
  component: ApeRidesPage,
});

type GeoState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "denied"; reason: string }
  | { status: "ok"; lat: number; lng: number; inside: boolean; venue: Venue };

function ApeRidesPage() {
  const { user } = useAuth();
  const [geo, setGeo] = useState<GeoState>({ status: "idle" });
  const [rides, setRides] = useState<Ride[]>([]);
  const [requests, setRequests] = useState<RideRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [arOpen, setArOpen] = useState(false);
  const [pfpUrl, setPfpUrl] = useState<string | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Host locations live in the database (ape_ride_venues).
  useEffect(() => {
    void supabase
      .from("ape_ride_venues")
      .select("slug,name,lat,lng,radius_m")
      .eq("active", true)
      .order("display_order", { ascending: true })
      .then(({ data }) => setVenues((data as Venue[] | null) ?? []));
  }, []);

  // Load the verified BAYC PFP URL from user_verifications.
  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { data } = await supabase
        .from("user_verifications")
        .select("bayc_token_ids,bayc_collection")
        .eq("user_id", user.id)
        .maybeSingle();
      const tokenId = data?.bayc_token_ids?.[0];
      if (tokenId == null) return;
      const contract =
        data?.bayc_collection === "MAYC"
          ? "0x60E4d786628Fea6478F785A6d7e704777c86a7c6"
          : "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D";
      setPfpUrl(`https://img.seadn.io/files/${contract.toLowerCase()}/${tokenId}.png?w=512`);
    })();
  }, [user]);

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
      .channel(`ape-rides-${Math.random().toString(36).slice(2, 10)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ape_rides" }, () =>
        loadRides(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "ape_ride_requests" }, () =>
        loadRequests(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [loadRides, loadRequests]);

  const checkLocation = useCallback((venue: Venue) => {
    setPickerOpen(false);
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
          inside: haversineMeters({ lat, lng }, { lat: venue.lat, lng: venue.lng }) <= venue.radius_m,
          venue,
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
    const res = await startRide({ data: { lat: geo.lat, lng: geo.lng, venue: geo.venue.slug } });
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
  const venueNames = venues.map((v) => v.name).join(" or ");
  const canHost = geo.status === "ok" && geo.inside && !myActiveRide;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 sm:mb-8 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-3xl text-gradient-gold sm:text-4xl">Ape Rides</h1>
          <p className="mt-2 text-xs text-muted-foreground sm:text-sm">
            Pair with a member physically at a BAYCmc clubhouse location —{" "}
            {venueNames || "Wynwood, FL"} — and watch their live POV. Hosting is unlocked only when
            your GPS places you inside the chosen location's geofence.
          </p>
        </div>
        {pfpUrl && (
          <button
            type="button"
            onClick={() => setArOpen(true)}
            className="self-start rounded-md border border-gold/40 bg-gold/10 px-4 py-2 text-sm font-semibold text-gold shadow-gold hover:bg-gold/20"
          >
            🦍 Try Ape AR
          </button>
        )}
      </header>
      {arOpen && pfpUrl && <ApeArFilter pfpUrl={pfpUrl} onClose={() => setArOpen(false)} />}
      {pickerOpen && (
        <VenuePicker venues={venues} onPick={checkLocation} onClose={() => setPickerOpen(false)} />
      )}

      {/* Host panel */}
      <section className="glass mb-8 rounded-2xl p-6 shadow-card">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-2xl">Host an Ape Ride</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Available only inside {venueNames || "Wynwood, FL"}
              {venues[0] ? ` (~${venues[0].radius_m}m radius)` : ""}.
            </p>
          </div>
          {geo.status === "idle" && (
            <button
              onClick={() => setPickerOpen(true)}
              className="rounded-md border border-border bg-secondary/50 px-4 py-2 text-sm hover:bg-secondary"
            >
              Check my location
            </button>
          )}
          {geo.status === "loading" && (
            <span className="text-xs text-muted-foreground">Locating…</span>
          )}
          {geo.status === "denied" && <div className="text-xs text-destructive">{geo.reason}</div>}
          {geo.status === "ok" && !geo.inside && (
            <div className="text-xs text-muted-foreground">
              You're outside {geo.venue.name} — request a ride from a host below.{" "}
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="font-semibold text-gold hover:underline"
              >
                Check again
              </button>
            </div>
          )}
          {geo.status === "ok" && geo.inside && !myActiveRide && (
            <button
              title={`Inside ${geo.venue.name}`}
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
            Your location was verified outside the {geo.venue.name} area. Hosting requires you to be
            physically present there.
          </p>
        )}
      </section>

      <ApeRidesBookings />

      {/* ApeRides Checkpoint — unified chronological feed of ride signups
          (hosts going live) and pairing requests. */}
      <ApeRidesCheckpoint
        rides={rides}
        requests={requests}
        currentUserId={user?.id}
        loading={loading}
        onRequest={handleRequest}
        onEnd={handleEnd}
      />

      {/* Host request inbox */}
      {myActiveRide && <HostRequestInbox rideId={myActiveRide.id} onRespond={handleRespond} />}
    </div>
  );
}

interface CheckpointProps {
  rides: Ride[];
  requests: RideRequest[];
  currentUserId: string | undefined;
  loading: boolean;
  onRequest: (rideId: string) => void;
  onEnd: (rideId: string) => void;
}

function ApeRidesCheckpoint({
  rides,
  requests,
  currentUserId,
  loading,
  onRequest,
  onEnd,
}: CheckpointProps) {
  type Entry =
    | { kind: "ride"; at: string; ride: Ride }
    | { kind: "request"; at: string; request: RideRequest };

  const entries: Entry[] = [
    ...rides.map((r) => ({ kind: "ride" as const, at: r.started_at, ride: r })),
    ...requests.map((r) => ({ kind: "request" as const, at: r.created_at, request: r })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const liveRideForViewer = rides.find((r) => r.host_id !== currentUserId);
  const myPendingOrAccepted = requests.find(
    (q) => q.status === "pending" || q.status === "accepted",
  );

  return (
    <section className="glass mt-2 mb-8 rounded-2xl p-6 shadow-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl">ApeRides Checkpoint</h2>
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Signups · chronological
          </span>
        </div>
        {myPendingOrAccepted ? (
          <span className="rounded-md border border-gold/30 bg-gold/10 px-3 py-1.5 text-xs text-gold">
            {myPendingOrAccepted.status === "accepted"
              ? "You're paired — open the ride below"
              : "Request sent — waiting for a host"}
          </span>
        ) : liveRideForViewer ? (
          <button
            onClick={() => onRequest(liveRideForViewer.id)}
            className="rounded-md bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground shadow-gold"
          >
            Request an ApeRide
          </button>
        ) : (
          <button
            disabled
            title="No hosts are live right now"
            className="cursor-not-allowed rounded-md border border-border bg-secondary/40 px-4 py-2 text-sm text-muted-foreground"
          >
            Request an ApeRide
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : entries.length === 0 ? (
        <div className="space-y-3 rounded-md border border-dashed border-border bg-secondary/30 p-6 text-center">
          <p className="text-sm text-muted-foreground">No ride signups or pairing requests yet.</p>
          {liveRideForViewer && !myPendingOrAccepted && (
            <button
              onClick={() => onRequest(liveRideForViewer.id)}
              className="mx-auto rounded-md bg-gradient-gold px-4 py-2 text-xs font-semibold text-gold-foreground shadow-gold"
            >
              Register for the next ApeRide
            </button>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => {
            if (e.kind === "ride") {
              const r = e.ride;
              const isMine = r.host_id === currentUserId;
              const myReq = requests.find((q) => q.ride_id === r.id);
              return (
                <li
                  key={`ride-${r.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold/20 bg-background/40 p-3"
                >
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gold">
                      Ride host · {isMine ? "you" : "live"}
                    </p>
                    <p className="font-display text-base">{r.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      Started {new Date(r.started_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isMine ? (
                      <>
                        <Link
                          to="/ape-rides/$rideId"
                          params={{ rideId: r.id }}
                          className="rounded-md bg-gradient-gold px-3 py-1.5 text-xs font-semibold text-gold-foreground shadow-gold"
                        >
                          Open
                        </Link>
                        <button
                          onClick={() => onEnd(r.id)}
                          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/20"
                        >
                          End
                        </button>
                      </>
                    ) : myReq?.status === "accepted" ? (
                      <Link
                        to="/ape-rides/$rideId"
                        params={{ rideId: r.id }}
                        className="rounded-md bg-gradient-gold px-3 py-1.5 text-xs font-semibold text-gold-foreground shadow-gold"
                      >
                        Watch
                      </Link>
                    ) : myReq?.status === "pending" ? (
                      <span className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground">
                        Waiting…
                      </span>
                    ) : (
                      <button
                        onClick={() => onRequest(r.id)}
                        className="rounded-md border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold hover:bg-gold/20"
                      >
                        Request pairing
                      </button>
                    )}
                  </div>
                </li>
              );
            }
            const q = e.request;
            const ride = rides.find((r) => r.id === q.ride_id);
            return (
              <li
                key={`req-${q.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background/40 p-3"
              >
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Pairing request
                  </p>
                  <p className="text-sm">
                    {ride?.title ?? "Ride"}{" "}
                    <span className="text-muted-foreground">· {q.status}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(q.created_at).toLocaleString()}
                  </p>
                </div>
                {q.status === "accepted" && ride && (
                  <Link
                    to="/ape-rides/$rideId"
                    params={{ rideId: ride.id }}
                    className="shrink-0 rounded-md bg-gradient-gold px-3 py-1.5 text-xs font-semibold text-gold-foreground shadow-gold"
                  >
                    Watch
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
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

/** Pick which clubhouse location to check your GPS against. */
function VenuePicker({
  venues,
  onPick,
  onClose,
}: {
  venues: Venue[];
  onPick: (v: Venue) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4 animate-in fade-in-0 duration-200"
      role="dialog"
      aria-modal="true"
      aria-label="Choose your location"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/90 backdrop-blur-md"
      />
      <div className="relative w-full max-w-sm rounded-2xl border-2 border-gold bg-card p-6 shadow-[0_0_45px_-4px_oklch(0.82_0.15_80/0.65),0_25px_60px_-10px_rgb(0_0_0/0.9)] animate-in zoom-in-95 fade-in-0 duration-200">
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        <h2 className="font-display text-xl text-gradient-gold">Where are you hosting?</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick your clubhouse location. We'll check your GPS against it.
        </p>
        <div className="mt-4 space-y-2">
          {venues.length === 0 ? (
            <p className="text-xs text-muted-foreground">Loading locations…</p>
          ) : (
            venues.map((v) => (
              <button
                key={v.slug}
                type="button"
                onClick={() => onPick(v)}
                className="flex w-full items-center gap-3 rounded-lg border border-gold/30 bg-secondary/30 px-4 py-3 text-left transition hover:border-gold/60 hover:bg-gold/10"
              >
                <MapPin className="h-5 w-5 text-gold" />
                <span className="flex-1">
                  <span className="block text-sm font-semibold">{v.name}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    Within ~{v.radius_m}m of the clubhouse
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
