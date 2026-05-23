import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ConferenceRoom } from "@/components/ConferenceRoom";
import { KaraokeStage } from "@/components/KaraokeStage";
import { getRoomThemeImage, getRoomThemeAmbience } from "@/lib/baycmc/roomThemes";

interface RoomMeta {
  name: string;
  tier: "token_proof" | "lifer";
  theme: string | null;
  kind: "conference" | "game" | "karaoke";
}

export const Route = createFileRoute("/_authenticated/_verified/rooms_/$roomId")({
  component: RoomDetail,
});

function RoomDetail() {
  const { roomId } = Route.useParams();
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [hostUserId, setHostUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const nowIso = new Date().toISOString();
      const [{ data: m }, { data: b }] = await Promise.all([
        supabase
          .from("rooms")
          .select("name,tier,theme,kind")
          .eq("id", roomId)
          .maybeSingle(),
        // The currently-active booking decides who occupies the host tile.
        // Only the booking owner (not admins) gets the host slot per the
        // grilling decision — admins keep moderation powers but sit in the
        // audience visually.
        supabase
          .from("room_bookings")
          .select("user_id")
          .eq("room_id", roomId)
          .lte("starts_at", nowIso)
          .gte("ends_at", nowIso)
          .order("starts_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      setMeta((m as RoomMeta | null) ?? null);
      setHostUserId((b?.user_id as string | undefined) ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  if (loading) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center px-4">
        <div className="h-[60vh] w-full max-w-4xl animate-pulse rounded-2xl bg-muted/20" />
      </main>
    );
  }
  if (!meta?.name) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="font-display text-3xl text-gradient-gold sm:text-4xl">Room not found</h1>
        <p className="mt-2 text-xs text-muted-foreground sm:text-sm">
          You may not have access to this room.
        </p>
        <Link to="/rooms" className="mt-6 inline-block text-gold underline">
          Back to rooms
        </Link>
      </main>
    );
  }

  const isKaraoke = meta.kind === "karaoke";
  return (
    <>
      <ConferenceRoom
        roomId={roomId}
        roomName={meta.name}
        ambience={getRoomThemeAmbience(meta.theme)}
        backgroundImage={getRoomThemeImage(meta.theme)}
        kind={meta.kind === "game" ? "game" : meta.kind === "karaoke" ? "karaoke" : "conference"}
        hostUserId={hostUserId}
      />
      {isKaraoke && <KaraokeStage roomId={roomId} bookingHostUserId={hostUserId} />}
    </>
  );
}
