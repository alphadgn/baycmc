import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { createBooking, cancelBooking } from "@/server/bookings.functions";
import { format } from "date-fns";
import { toast } from "sonner";

interface Room {
  id: string;
  name: string;
  description: string | null;
  capacity: number;
  tier: "token_proof" | "lifer";
  livekit_room: string;
}
interface Booking {
  id: string;
  room_id: string;
  user_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  override_by: string | null;
}

export const Route = createFileRoute("/_authenticated/_verified/rooms")({
  head: () => ({
    meta: [
      { title: "Rooms — BAYCMC" },
      { name: "description", content: "20 conference rooms with calendar booking." },
    ],
  }),
  component: RoomsPage,
});

function RoomsPage() {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const create = useServerFn(createBooking);
  const cancel = useServerFn(cancelBooking);

  async function load() {
    setLoading(true);
    const [{ data: r }, { data: b }, { data: roles }] = await Promise.all([
      supabase.from("rooms").select("*").eq("active", true).order("name"),
      supabase
        .from("room_bookings")
        .select("id,room_id,user_id,title,starts_at,ends_at,override_by")
        .gte("ends_at", new Date().toISOString())
        .order("starts_at"),
      user
        ? supabase.from("user_roles").select("role").eq("user_id", user.id)
        : Promise.resolve({ data: [] as { role: string }[] }),
    ]);
    setRooms((r as Room[]) ?? []);
    setBookings((b as Booking[]) ?? []);
    setIsAdmin(!!roles?.some((x) => x.role === "admin" || x.role === "super_admin"));
    setLoading(false);
  }

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("bookings")
      .on("postgres_changes", { event: "*", schema: "public", table: "room_bookings" }, () =>
        load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-5xl text-gradient-gold">Conference Rooms</h1>
          <p className="mt-1 text-sm text-muted-foreground font-sans-display">
            20 rooms · click any room to book or join the live conference
          </p>
        </div>
      </header>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl bg-muted/20" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rooms.map((room) => {
            const upcoming = bookings.filter((b) => b.room_id === room.id).slice(0, 2);
            return (
              <div key={room.id} className="glass rounded-2xl p-5 shadow-card">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-display text-2xl text-gradient-gold">{room.name}</h2>
                    <p className="mt-1 text-xs text-muted-foreground font-sans-display">
                      {room.description} · capacity {room.capacity}
                    </p>
                  </div>
                  {room.tier === "lifer" && (
                    <span className="rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold text-gold">
                      LIFER
                    </span>
                  )}
                </div>
                <ul className="mt-3 space-y-1 text-[11px] text-muted-foreground font-sans-display">
                  {upcoming.length === 0 ? (
                    <li className="italic">No upcoming bookings</li>
                  ) : (
                    upcoming.map((b) => (
                      <li key={b.id} className="flex items-center justify-between">
                        <span className="truncate">
                          {format(new Date(b.starts_at), "MMM d HH:mm")} · {b.title}
                        </span>
                        {(b.user_id === user?.id || isAdmin) && (
                          <button
                            onClick={() => cancel({ data: { bookingId: b.id } }).then(load)}
                            className="ml-2 text-destructive hover:underline"
                          >
                            cancel
                          </button>
                        )}
                      </li>
                    ))
                  )}
                </ul>
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => setSelectedRoom(room)}
                    className="flex-1 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-xs font-semibold text-gold hover:bg-gold/20 font-sans-display"
                  >
                    Book
                  </button>
                  <Link
                    to="/rooms/$roomId"
                    params={{ roomId: room.id }}
                    className="flex-1 rounded-md bg-gradient-gold px-3 py-2 text-center text-xs font-semibold text-gold-foreground shadow-gold font-sans-display"
                  >
                    Enter
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedRoom && (
        <BookingModal
          room={selectedRoom}
          isAdmin={isAdmin}
          onClose={() => setSelectedRoom(null)}
          onCreate={async (input) => {
            const res = await create({
              data: {
                roomId: selectedRoom.id,
                title: input.title,
                startsAt: input.startsAt,
                endsAt: input.endsAt,
                notes: input.notes,
                override: input.override,
              },
            });
            if (!res.ok) {
              toast.error(res.error);
              return false;
            }
            toast.success("Booked");
            setSelectedRoom(null);
            await load();
            return true;
          }}
        />
      )}
    </main>
  );
}

function BookingModal({
  room,
  isAdmin,
  onClose,
  onCreate,
}: {
  room: Room;
  isAdmin: boolean;
  onClose: () => void;
  onCreate: (i: {
    title: string;
    startsAt: string;
    endsAt: string;
    notes?: string;
    override?: boolean;
  }) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("11:00");
  const [notes, setNotes] = useState("");
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const startsAt = new Date(`${date}T${start}:00`).toISOString();
    const endsAt = new Date(`${date}T${end}:00`).toISOString();
    const ok = await onCreate({ title, startsAt, endsAt, notes, override });
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="glass w-full max-w-md rounded-2xl p-6 shadow-card"
      >
        <h3 className="font-display text-3xl text-gradient-gold">Book {room.name}</h3>
        <div className="mt-4 space-y-3 text-sm font-sans-display">
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Meeting title"
            className="w-full rounded-md border border-border bg-input px-3 py-2"
          />
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-md border border-border bg-input px-3 py-2"
          />
          <div className="flex gap-2">
            <input
              type="time"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="flex-1 rounded-md border border-border bg-input px-3 py-2"
            />
            <input
              type="time"
              required
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="flex-1 rounded-md border border-border bg-input px-3 py-2"
            />
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            rows={2}
            className="w-full rounded-md border border-border bg-input px-3 py-2"
          />
          {isAdmin && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={override}
                onChange={(e) => setOverride(e.target.checked)}
              />
              Admin override (bypass conflict check)
            </label>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-gradient-gold px-4 py-2 text-xs font-semibold text-gold-foreground shadow-gold disabled:opacity-50"
          >
            {busy ? "Booking…" : "Confirm"}
          </button>
        </div>
      </form>
    </div>
  );
}
