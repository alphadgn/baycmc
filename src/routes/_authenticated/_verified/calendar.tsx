import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { cancelBooking } from "@/server/bookings.functions";
import { RoomCalendar } from "@/components/RoomCalendar";
import { RoomsShell } from "@/components/RoomsShell";
import { useVerificationRevalidation } from "@/hooks/useVerificationRevalidation";

interface Room {
  id: string;
  name: string;
  tier: "token_proof" | "lifer";
  theme: string | null;
  display_order: number | null;
}

interface Booking {
  id: string;
  room_id: string;
  user_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
}

export const Route = createFileRoute("/_authenticated/_verified/calendar")({
  head: () => ({
    meta: [
      { title: "Calendar — BAYCMC" },
      {
        name: "description",
        content: "Upcoming bookings across every conference room — verified holders only.",
      },
    ],
  }),
  component: CalendarPage,
});

function CalendarPage() {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const cancel = useServerFn(cancelBooking);

  async function load() {
    setLoading(true);
    const [{ data: r }, { data: b }] = await Promise.all([
      supabase
        .from("rooms")
        .select("id,name,tier,theme,display_order")
        .eq("active", true)
        .order("display_order", { ascending: true, nullsFirst: false })
        .order("name"),
      supabase
        .from("room_bookings")
        .select("id,room_id,user_id,title,starts_at,ends_at")
        .gte("ends_at", new Date().toISOString())
        .order("starts_at"),
    ]);
    setRooms((r as Room[])?.filter((rm) => rm.theme) ?? []);
    setBookings((b as Booking[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [user?.id]);

  useVerificationRevalidation({
    userId: user?.id ?? null,
    onRevalidate: load,
    watchRooms: true,
  });

  const visibleRooms = useMemo(() => rooms, [rooms]);

  const cancelById = async (id: string) => {
    const res = await cancel({ data: { bookingId: id } });
    if (!res.ok) toast.error(res.error);
    else {
      toast.success("Booking cancelled");
      await load();
    }
  };

  return (
    <RoomsShell title="Calendar" subtitle="Upcoming bookings across every room.">
      {loading ? (
        <div className="h-[60vh] animate-pulse rounded-2xl bg-muted/20" />
      ) : (
        <RoomCalendar
          rooms={visibleRooms}
          bookings={bookings}
          currentUserId={user?.id ?? null}
          onCancel={cancelById}
        />
      )}
    </RoomsShell>
  );
}
