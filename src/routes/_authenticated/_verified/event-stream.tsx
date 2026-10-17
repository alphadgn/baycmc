import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { EventStreamTheater } from "@/components/EventStreamTheater";

export const Route = createFileRoute("/_authenticated/_verified/event-stream")({
  head: () => ({
    meta: [
      { title: "Event Stream — BAYCmc" },
      { name: "description", content: "Live event broadcast for verified clubhouse holders." },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { golive?: boolean } =>
    search.golive === 1 || search.golive === "1" || search.golive === true ? { golive: true } : {},
  component: EventStreamPage,
});

function EventStreamPage() {
  const { golive } = Route.useSearch();
  const [room, setRoom] = useState<{ id: string; capacity: number } | null | undefined>(undefined);
  useEffect(() => {
    void supabase
      .from("rooms")
      .select("id,capacity")
      .eq("livekit_room", "event-stream")
      .eq("active", true)
      .maybeSingle()
      .then(({ data }) => setRoom(data ? { id: data.id, capacity: data.capacity } : null));
  }, []);
  if (room === undefined) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
        Opening the theatre…
      </div>
    );
  }
  if (room === null) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
        The Event Stream isn't open right now.
      </div>
    );
  }
  return <EventStreamTheater roomId={room.id} capacity={room.capacity} goLive={!!golive} />;
}
