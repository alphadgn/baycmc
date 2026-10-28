import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ConferenceRoom } from "@/components/ConferenceRoom";
import { KaraokeStage } from "@/components/KaraokeStage";
import { SingerLiveIndicator } from "@/components/karaoke/SingerLiveIndicator";
import { KaraokeHub } from "@/components/karaoke/KaraokeHub";
import { KaraokeErrorBoundary } from "@/components/karaoke/KaraokeErrorBoundary";
import { KaraokeTipJar, KaraokeTipNotifier } from "@/components/karaoke/KaraokeTipJar";
import { useKaraokeStage } from "@/lib/karaoke/stageStore";
import { getRoomThemeImage, getRoomThemeAmbience } from "@/lib/baycmc/roomThemes";

interface RoomMeta {
  name: string;
  kind: "conference" | "game" | "karaoke";
  theme: string | null;
}

export const Route = createFileRoute("/_authenticated/karaoke/$roomId")({
  beforeLoad: async () => {
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) throw redirect({ to: "/" });
  },
  component: KaraokeRoomPage,
});

function KaraokeRoomPage() {
  const { roomId } = Route.useParams();
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [hostUserId, setHostUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Who is on stage / on air comes from the shared karaoke store, written by
  // <KaraokeStage> (DB session) and <KaraokePerformerEngine> (LiveKit tracks).
  // The old banner used the VIEWER's own mic state, so it said "Singer Live"
  // whenever an audience member unmuted.
  const stage = useKaraokeStage();
  const performerId = stage.session?.performer_user_id ?? null;
  const [performerName, setPerformerName] = useState<string>("—");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const nowIso = new Date().toISOString();
      const [{ data: m }, { data: b }] = await Promise.all([
        supabase.from("rooms").select("name,kind,theme").eq("id", roomId).maybeSingle(),
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

  useEffect(() => {
    let cancelled = false;
    if (!performerId) {
      setPerformerName("—");
      return;
    }
    void supabase
      .rpc("member_profiles")
      .select("username")
      .eq("id", performerId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setPerformerName(
          ((data?.username as string | null) ?? null) || `Member ${performerId.slice(0, 4)}`,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [performerId]);

  if (loading) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center px-4">
        <div className="h-[60vh] w-full max-w-4xl animate-pulse rounded-2xl bg-muted/20" />
      </main>
    );
  }
  if (!meta || meta.kind !== "karaoke") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="font-display text-3xl text-gradient-gold sm:text-4xl">
          Karaoke room not found
        </h1>
        <Link to="/karaoke" className="mt-6 inline-block text-gold underline">
          Back to lounges
        </Link>
      </main>
    );
  }

  return (
    <>
      <ConferenceRoom
        roomId={roomId}
        roomName={meta.name}
        ambience={getRoomThemeAmbience(meta.theme)}
        backgroundImage={getRoomThemeImage(meta.theme)}
        kind="karaoke"
        hostUserId={hostUserId}
      />
      <KaraokeErrorBoundary name="stage">
        <KaraokeStage roomId={roomId} bookingHostUserId={hostUserId} />
      </KaraokeErrorBoundary>
      {performerId && (
        <SingerLiveIndicator
          singerName={performerName}
          live={stage.performerLive}
          recording={stage.isMyTurn && stage.recording}
        />
      )}
      <KaraokeErrorBoundary name="tip jar" silent>
        <KaraokeTipJar roomId={roomId} />
        <KaraokeTipNotifier />
      </KaraokeErrorBoundary>
      <KaraokeErrorBoundary name="hub">
        <KaraokeHub roomId={roomId} roomName={meta.name} bookingHostUserId={hostUserId} />
      </KaraokeErrorBoundary>
    </>
  );
}
