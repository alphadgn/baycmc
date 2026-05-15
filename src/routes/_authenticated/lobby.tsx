import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Tier 1 — Lobby landing.
 *
 * Any signed-in Privy user lands here. They get:
 *   - a welcome card with a "Verify holder access" CTA
 *   - a locked preview of every conference room (gold lock overlay)
 *   - a public profiles directory
 *
 * No feed / messages / room entry / ape rides — those live behind the
 * `_verified` layout and require a confirmed BAYC/MAYC ownership flag.
 */
export const Route = createFileRoute("/_authenticated/lobby")({
  head: () => ({
    meta: [
      { title: "Lobby — BAYCMC" },
      {
        name: "description",
        content:
          "Welcome to the BAYCMC lobby. Verify your BAYC or MAYC to unlock conference rooms and the full clubhouse.",
      },
    ],
  }),
  component: LobbyPage,
});

interface RoomRow {
  id: string;
  name: string;
  description: string | null;
  capacity: number;
  tier: "token_proof" | "lifer";
}
interface ProfileRow {
  id: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
}

function triggerVerify() {
  // Re-runs the SIWE / on-chain ownership flow without forcing logout.
  window.dispatchEvent(new Event("baycmc:privy-bridge-retry"));
  toast.message("Re-checking BAYC/MAYC ownership…", {
    description:
      "Approve the signature in your wallet — we'll unlock the verified areas the moment it confirms.",
    duration: 5000,
  });
}

function LobbyPage() {
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      // Lobby queries: only public columns, no wallet_address.
      const [{ data: r }, { data: p }] = await Promise.all([
        supabase
          .from("rooms")
          .select("id,name,description,capacity,tier")
          .eq("active", true)
          .order("name"),
        supabase
          .from("profiles")
          .select("id,username,avatar_url,bio")
          .order("created_at", { ascending: false })
          .limit(24),
      ]);
      setRooms((r as RoomRow[]) ?? []);
      setProfiles((p as ProfileRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      {/* Welcome */}
      <section className="glass relative overflow-hidden rounded-3xl p-8 shadow-card sm:p-12">
        <div
          className="pointer-events-none absolute inset-0 -z-10 opacity-50"
          style={{ background: "var(--gradient-radial-gold)" }}
        />
        <div className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/5 px-3 py-1 text-xs font-medium uppercase tracking-wider text-gold">
          <span className="h-1.5 w-1.5 rounded-full bg-gold animate-pulse-glow" />
          Lobby · Tier 1
        </div>
        <h1 className="mt-4 font-display text-4xl font-bold tracking-tight text-gradient-gold sm:text-5xl">
          You're inside the clubhouse lobby.
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          Browse the rooms and the member directory. To unlock conference room
          entry, the social feed, messages, and live Ape Rides, verify a BAYC or
          MAYC in your wallet (or a vault delegated to you on delegate.cash).
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={triggerVerify}
            className="rounded-md bg-gradient-gold px-5 py-2.5 text-sm font-semibold text-gold-foreground shadow-gold transition hover:opacity-90"
          >
            Verify holder access
          </button>
          <Link
            to="/profile"
            className="rounded-md border border-border bg-secondary/30 px-5 py-2.5 text-center text-sm font-medium hover:bg-secondary"
          >
            Your profile
          </Link>
        </div>
      </section>

      {/* Rooms preview — locked */}
      <section className="mt-12">
        <header className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="font-display text-3xl text-gradient-gold">Conference rooms</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              20 rooms · verify to book or enter
            </p>
          </div>
        </header>
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-44 animate-pulse rounded-2xl bg-muted/20" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rooms.map((room) => (
              <LockedRoomCard key={room.id} room={room} onVerify={triggerVerify} />
            ))}
          </div>
        )}
      </section>

      {/* Profiles directory */}
      <section className="mt-12">
        <header className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="font-display text-3xl text-gradient-gold">Members</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Newest profiles in the clubhouse
            </p>
          </div>
        </header>
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-muted/20" />
            ))}
          </div>
        ) : profiles.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">
            No profiles yet. Be the first to verify.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {profiles.map((p) => (
              <div
                key={p.id}
                className="glass flex items-center gap-3 rounded-xl p-4 transition hover:border-gold/40"
              >
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full border border-gold/30 bg-muted">
                  {p.avatar_url ? (
                    <img
                      src={p.avatar_url}
                      alt={p.username ?? "Member"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                      {(p.username ?? "?").slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-display text-sm font-semibold">
                    {p.username ?? "Unnamed ape"}
                  </p>
                  {p.bio && (
                    <p className="truncate text-xs text-muted-foreground">{p.bio}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function LockedRoomCard({
  room,
  onVerify,
}: {
  room: RoomRow;
  onVerify: () => void;
}) {
  return (
    <div className="glass relative overflow-hidden rounded-2xl p-5 shadow-card">
      {/* Subtle blur layer behind the content for the locked premium feel */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 backdrop-blur-[2px]"
        style={{
          background:
            "linear-gradient(180deg, color-mix(in oklab, var(--background) 30%, transparent) 0%, color-mix(in oklab, var(--background) 75%, transparent) 100%)",
        }}
      />
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-display text-2xl text-gradient-gold">{room.name}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {room.description ?? "Conference room"} · capacity {room.capacity}
          </p>
        </div>
        {room.tier === "lifer" && (
          <span className="rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold text-gold">
            LIFER
          </span>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-gold">
          <Lock className="h-3 w-3" />
          Verify to unlock
        </div>
        <button
          type="button"
          onClick={onVerify}
          className="rounded-md bg-gradient-gold px-3 py-1.5 text-xs font-semibold text-gold-foreground shadow-gold transition hover:opacity-90"
        >
          Verify holder
        </button>
      </div>
    </div>
  );
}
