import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ConferenceRoom } from "@/components/ConferenceRoom";
import { getRoomThemeImage, getRoomThemeAmbience } from "@/lib/baycmc/roomThemes";

interface RoomMeta {
  name: string;
  tier: "token_proof" | "lifer";
  theme: string | null;
  kind: "conference" | "game";
}

export const Route = createFileRoute("/_authenticated/_verified/rooms/$roomId")({
  component: RoomDetail,
});

function RoomDetail() {
  const { roomId } = Route.useParams();
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("rooms")
        .select("name,tier,theme,kind")
        .eq("id", roomId)
        .maybeSingle();
      setMeta((data as RoomMeta | null) ?? null);
      setLoading(false);
    })();
  }, [roomId]);

  if (loading) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="h-[70vh] animate-pulse rounded-2xl bg-muted/20" />
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

  const bg = getRoomThemeImage(meta.theme);
  const ambience = getRoomThemeAmbience(meta.theme);

  return (
    <main className="relative mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
      <Link
        to="/rooms"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-gold"
      >
        <ChevronLeft className="h-3 w-3" /> All rooms
      </Link>
      <header className="my-3 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h1 className="truncate font-display text-3xl text-gradient-gold sm:text-5xl">
            {meta.name}
          </h1>
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
            {meta.tier === "lifer" ? "Lifer-only" : "Verified"}
            {ambience ? ` · ${ambience}` : null}
          </p>
        </div>
      </header>

      <ConferenceRoom
        roomId={roomId}
        roomName={meta.name}
        backgroundImage={bg}
        kind={meta.kind}
      />
    </main>
  );
}
