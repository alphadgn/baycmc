import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ConferenceRoom } from "@/components/ConferenceRoom";

export const Route = createFileRoute("/_authenticated/_verified/rooms/$roomId")({
  component: RoomDetail,
});

function RoomDetail() {
  const { roomId } = Route.useParams();
  const [name, setName] = useState<string>("");
  const [tier, setTier] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("rooms")
        .select("name,tier")
        .eq("id", roomId)
        .maybeSingle();
      setName(data?.name ?? "");
      setTier(data?.tier ?? "");
      setLoading(false);
    })();
  }, [roomId]);

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="h-96 animate-pulse rounded-2xl bg-muted/20" />
      </main>
    );
  }
  if (!name) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="font-display text-4xl text-gradient-gold">Room not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You may not have access to this room.
        </p>
        <Link to="/rooms" className="mt-6 inline-block text-gold underline">
          Back to rooms
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <Link to="/rooms" className="text-xs text-muted-foreground hover:text-gold">
        ← All rooms
      </Link>
      <header className="my-4">
        <h1 className="font-display text-5xl text-gradient-gold">{name}</h1>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          {tier === "lifer" ? "Lifer-only" : "Verified"}
        </p>
      </header>
      <ConferenceRoom roomId={roomId} roomName={name} />
    </main>
  );
}
