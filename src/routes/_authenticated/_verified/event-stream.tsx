import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { EventStreamTheater } from "@/components/EventStreamTheater";
import { TicketGate } from "@/components/eventstream/TicketGate";
import { getStreamAccess } from "@/server/event-stream.functions";

export const Route = createFileRoute("/_authenticated/_verified/event-stream")({
  head: () => ({
    meta: [
      { title: "Event Stream — BAYCmc" },
      { name: "description", content: "Live event broadcast for verified clubhouse holders." },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { golive?: boolean; debug?: boolean } => ({
    ...(search.golive === 1 || search.golive === "1" || search.golive === true
      ? { golive: true }
      : {}),
    // ?debug keeps a small on-screen video diagnostics readout.
    ...(search.debug !== undefined ? { debug: true } : {}),
  }),
  component: EventStreamPage,
});

function EventStreamPage() {
  const { golive } = Route.useSearch();
  const [room, setRoom] = useState<{ id: string; capacity: number } | null | undefined>(undefined);
  const accessFn = useServerFn(getStreamAccess);
  const [access, setAccess] = useState<Awaited<ReturnType<typeof getStreamAccess>> | null>(null);
  // If the check itself fails, fall through to the theatre: the server still
  // refuses the stream token to anyone who needs a ticket.
  const loadAccess = () =>
    void accessFn()
      .then(setAccess)
      .catch(() =>
        setAccess({
          free: true,
          canHost: false,
          currentEventId: null,
          hasTicket: false,
          events: [],
          myTickets: [],
        }),
      );

  useEffect(loadAccess, [accessFn]);
  useEffect(() => {
    void supabase
      .from("rooms")
      .select("id,capacity")
      .eq("livekit_room", "event-stream")
      .eq("active", true)
      .maybeSingle()
      .then(({ data }) => setRoom(data ? { id: data.id, capacity: data.capacity } : null));
  }, []);
  if (room === undefined || access === null) {
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
  // Pay-per-view: members whose collection isn't free need a ticket for the
  // event on now (the server enforces this again when issuing the stream token).
  if (!access.free && !access.hasTicket) {
    return (
      <TicketGate
        events={access.events}
        currentEventId={access.currentEventId}
        myTickets={access.myTickets}
        onTicket={loadAccess}
      />
    );
  }
  return <EventStreamTheater roomId={room.id} capacity={room.capacity} goLive={!!golive} />;
}
