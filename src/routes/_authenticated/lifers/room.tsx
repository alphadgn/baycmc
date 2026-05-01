import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BrandLogo } from "@/components/BrandLogo";
import { ConferenceRoom } from "@/components/ConferenceRoom";

export const Route = createFileRoute("/_authenticated/lifers/room")({
  head: () => ({
    meta: [{ title: "Lifer Conference Room — BAYCMC" }],
  }),
  component: LiferRoom,
});

function LiferRoom() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [name, setName] = useState<string>("Lifers Suite 1");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("rooms")
        .select("id,name")
        .eq("tier", "lifer")
        .order("name")
        .limit(1)
        .maybeSingle();
      if (data) {
        setRoomId(data.id);
        setName(data.name);
      }
      setLoading(false);
    })();
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="mb-6 flex flex-col items-center text-center">
        <BrandLogo className="h-32 w-32" />
        <p className="mt-2 text-xs uppercase tracking-[0.4em] text-gold">Lifers conference</p>
      </div>
      {loading ? (
        <div className="h-96 animate-pulse rounded-2xl bg-muted/20" />
      ) : roomId ? (
        <ConferenceRoom roomId={roomId} roomName={name} />
      ) : (
        <p className="text-center text-sm text-muted-foreground">No lifer room configured.</p>
      )}
    </main>
  );
}
