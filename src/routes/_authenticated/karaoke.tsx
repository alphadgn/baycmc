/**
 * Karaoke rooms — open to all signed-in users.
 *
 * Conference rooms remain gated by the `_verified` layout. Karaoke rooms
 * live here, OUTSIDE that gate, so anyone with an account can browse and
 * join. The booking RLS (see migration `karaoke recordings`) likewise
 * allows any authenticated user to reserve a karaoke-kind room.
 *
 * Holders (BAYC / MAYC) still get visible VIP treatment via the badge
 * pill below — this is presentation-only, NOT access control.
 */
import { createFileRoute, Link, Outlet, redirect, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Mic, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useVerificationStatus } from "@/lib/baycmc/useVerificationStatus";
import { RoomsShell } from "@/components/RoomsShell";
import { getRoomThemeImage } from "@/lib/baycmc/roomThemes";

interface KaraokeRoom {
  id: string;
  name: string;
  description: string | null;
  theme: string | null;
  capacity: number;
  is_locked: boolean;
}

export const Route = createFileRoute("/_authenticated/karaoke")({
  beforeLoad: async ({ location }) => {
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) throw redirect({ to: "/" });

    const isKaraokeIndex = (location.pathname.replace(/\/+$/, "") || "/") === "/karaoke";
    if (!isKaraokeIndex) return;

    // Single public karaoke room — skip listing, jump straight in.
    const { data: room } = await supabase
      .from("rooms")
      .select("id")
      .eq("kind", "karaoke")
      .eq("active", true)
      .order("display_order", { ascending: true, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (room?.id) {
      throw redirect({ to: "/karaoke/$roomId", params: { roomId: room.id } });
    }
  },
  component: KaraokeRoute,
});

function KaraokeRoute() {
  const location = useLocation();
  const isKaraokeIndex = (location.pathname.replace(/\/+$/, "") || "/") === "/karaoke";
  return isKaraokeIndex ? <KaraokePage /> : <Outlet />;
}

function KaraokePage() {
  const [rooms, setRooms] = useState<KaraokeRoom[] | null>(null);
  const { isVerifiedHolder } = useVerificationStatus();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("rooms")
        .select("id,name,description,theme,capacity,is_locked")
        .eq("kind", "karaoke")
        .eq("active", true)
        .order("display_order", { ascending: true, nullsFirst: false });
      if (cancelled) return;
      setRooms((data as KaraokeRoom[] | null) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <RoomsShell title="Karaoke Lounges" subtitle="Open to all members — grab the mic.">
      {!isVerifiedHolder && (
        <div className="mb-4 rounded-lg border border-gold/30 bg-gold/5 p-3 text-[12px] text-foreground">
          <p className="flex items-center gap-1.5 font-display text-[11px] uppercase tracking-wider text-gold">
            <Sparkles className="h-3.5 w-3.5" /> Lobby access
          </p>
          <p className="mt-1 text-muted-foreground">
            Any signed-in member can sing, queue, and spectate. Verified BAYC/MAYC holders get a VIP
            badge and priority in the queue.
          </p>
        </div>
      )}

      {rooms === null ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-2xl bg-muted/20" />
          ))}
        </div>
      ) : rooms.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-card/40 p-6 text-center text-sm text-muted-foreground">
          No karaoke lounges open right now. Check back soon.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rooms.map((r) => (
            <KaraokeCard key={r.id} room={r} isHolder={isVerifiedHolder} />
          ))}
        </div>
      )}
    </RoomsShell>
  );
}

function KaraokeCard({ room, isHolder }: { room: KaraokeRoom; isHolder: boolean }) {
  const bg = getRoomThemeImage(room.theme);
  return (
    <Link
      to="/karaoke/$roomId"
      params={{ roomId: room.id }}
      className="group relative block overflow-hidden rounded-2xl border border-border/60 bg-card/40 shadow-card transition hover:border-gold/40 hover:shadow-gold"
    >
      <div
        className="aspect-[16/10] w-full bg-cover bg-center"
        style={
          bg
            ? {
                backgroundImage: `linear-gradient(rgba(8,8,12,0.45), rgba(8,8,12,0.75)), url(${bg})`,
              }
            : { background: "linear-gradient(135deg, hsl(var(--card)), hsl(var(--background)))" }
        }
      />
      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate font-display text-base text-gradient-gold">{room.name}</h3>
          {isHolder && (
            <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-gold">
              VIP
            </span>
          )}
        </div>
        {room.description && (
          <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{room.description}</p>
        )}
        <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
          <span className="inline-flex items-center gap-1 text-gold/80">
            <Mic className="h-3 w-3" /> Karaoke
          </span>
          <span>Capacity {room.capacity}</span>
        </div>
      </div>
    </Link>
  );
}
