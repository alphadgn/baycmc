import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { createBooking, cancelBooking } from "@/server/bookings.functions";
import { format } from "date-fns";
import { toast } from "sonner";
import { Calendar, Lock, Plus, Users, Gamepad2 } from "lucide-react";
import { RoomCalendar } from "@/components/RoomCalendar";
import { RoomsShell } from "@/components/RoomsShell";
import { getRoomThemeImage, getRoomThemeAmbience } from "@/lib/baycmc/roomThemes";
import { useRoomPreferences } from "@/lib/baycmc/useRoomPreferences";
import { useVerificationRevalidation } from "@/hooks/useVerificationRevalidation";

interface Room {
  id: string;
  name: string;
  description: string | null;
  capacity: number;
  tier: "token_proof" | "lifer" | "public";
  livekit_room: string;
  theme: string | null;
  display_order: number | null;
  is_locked: boolean;
  kind: "conference" | "game" | "karaoke";
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
      { title: "Conference Rooms — BAYCMC" },
      {
        name: "description",
        content: "Choose a themed conference room to join and connect with verified members in real time.",
      },
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
  const [showCalendar, setShowCalendar] = useState(false);
  const [baycVerified, setBaycVerified] = useState(false);
  const [, setOtherpageVerified] = useState(false);
  const prevAccessRef = useRef<{ bayc: boolean; op: boolean } | null>(null);

  const create = useServerFn(createBooking);
  const cancel = useServerFn(cancelBooking);

  async function load() {
    setLoading(true);
    const [{ data: r }, { data: b }, { data: roles }, { data: ver }] = await Promise.all([
      supabase
        .from("rooms")
        .select("id,name,description,capacity,tier,livekit_room,theme,display_order,is_locked,kind")
        .eq("active", true)
        .order("display_order", { ascending: true, nullsFirst: false })
        .order("name"),
      supabase
        .from("room_bookings")
        .select("id,room_id,user_id,title,starts_at,ends_at,override_by")
        .gte("ends_at", new Date().toISOString())
        .order("starts_at"),
      user
        ? supabase.from("user_roles").select("role").eq("user_id", user.id)
        : Promise.resolve({ data: [] as { role: string }[] }),
      user
        ? supabase
            .from("user_verifications")
            .select("bayc_verified,otherpage_verified")
            .eq("user_id", user.id)
            .maybeSingle()
        : Promise.resolve({
            data: null as { bayc_verified: boolean; otherpage_verified: boolean } | null,
          }),
    ]);
    const allRooms = (r as Room[]) ?? [];
    const bayc = !!ver?.bayc_verified;
    const op = !!ver?.otherpage_verified;
    const admin = !!roles?.some((x) => x.role === "admin" || x.role === "super_admin");
    // Admins administer the clubhouse — they see every tier including
    // Lifer-only rooms without holding tokens.
    const seesLiferRooms = (bayc && op) || admin;

    // We used to fire a toast here when bayc flipped from true → false, but
    // transient revalidation gaps (e.g. when returning from a room) made it
    // fire on almost every leave. The destructive banner below the calendar
    // already covers the case clearly, so the toast was pure noise.
    prevAccessRef.current = { bayc, op };

    setBaycVerified(bayc);
    setOtherpageVerified(op);
    setRooms(seesLiferRooms ? allRooms : allRooms.filter((rm) => rm.tier !== "lifer"));
    setBookings((b as Booking[]) ?? []);
    setIsAdmin(admin);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Unified realtime + auth + wallet revalidation. Replaces my earlier
  // ad-hoc room_bookings channel. `watchRooms: true` so room CRUD (e.g. an
  // admin locking a room) also triggers a refetch.
  useVerificationRevalidation({
    userId: user?.id ?? null,
    onRevalidate: load,
    watchRooms: true,
  });

  // Show themed rooms only — the new visual model is per-room ambience and
  // older rows (Boardroom, Atrium, Penthouse, etc.) don't have an image yet.
  // All non-lifer conference rooms are listed first, with lifer rooms after;
  // sort() is stable so the existing display_order/name order is preserved
  // within each group.
  const visibleRooms = useMemo(
    () =>
      rooms
        .filter((r) => r.theme)
        .sort((a, b) => (a.tier === "lifer" ? 1 : 0) - (b.tier === "lifer" ? 1 : 0)),
    [rooms],
  );

  // Verified BAYC/MAYC OR an elevated role can create bookings. Lifer rooms
  // are already filtered out above when the user isn't dual-verified.
  const canBook = baycVerified || isAdmin;

  const cancelById = async (id: string) => {
    const res = await cancel({ data: { bookingId: id } });
    if (!res.ok) toast.error(res.error);
    else {
      toast.success("Booking cancelled");
      await load();
    }
  };

  const rightRail = (
    <div className="space-y-3">
      <PreferencesPanel />
      <BookingsSummary
        bookings={bookings}
        rooms={visibleRooms}
        currentUserId={user?.id ?? null}
        onCancel={cancelById}
      />
    </div>
  );

  return (
    <RoomsShell
      title="Conference Rooms"
      subtitle="Choose a room to join and connect with others in real time."
      rightRail={rightRail}
    >
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setShowCalendar((v) => !v)}
          className="inline-flex items-center gap-2 rounded-md border border-gold/30 bg-gold/5 px-3 py-2 text-xs font-semibold text-gold transition hover:bg-gold/10 font-sans-display"
        >
          <Calendar className="h-3.5 w-3.5" />
          {showCalendar ? "Hide booking calendar" : "Booking calendar"}
        </button>
      </div>

      {!loading && !canBook && (
        <div className="glass mb-5 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive font-sans-display">
          You're signed in, but no verified BAYC/MAYC holding was detected in your connected
          wallet. Booking is disabled until verification is restored. Reconnect or refresh your
          wallet to try again.
        </div>
      )}

      {showCalendar && !loading && (
        <div className="mb-5">
          <RoomCalendar
            rooms={visibleRooms}
            bookings={bookings}
            currentUserId={user?.id ?? null}
            onCancel={cancelById}
          />
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-2xl bg-muted/20" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleRooms.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              bookings={bookings.filter((b) => b.room_id === room.id).slice(0, 2)}
              canBook={canBook}
              onBook={() => setSelectedRoom(room)}
            />
          ))}
          {isAdmin && <CreateRoomTile />}
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
    </RoomsShell>
  );
}

function RoomCard({
  room,
  bookings,
  canBook,
  onBook,
}: {
  room: Room;
  bookings: Booking[];
  canBook: boolean;
  onBook: () => void;
}) {
  const bg = getRoomThemeImage(room.theme);
  const ambience = getRoomThemeAmbience(room.theme);
  const isGame = room.kind === "game";

  // The whole card is a link — click anywhere on it to enter the room. The
  // Book button inside stops propagation so it opens the modal instead.
  return (
    <Link
      to="/rooms/$roomId"
      params={{ roomId: room.id }}
      aria-label={`Enter ${room.name}`}
      className="group glass relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-border/60 shadow-card transition hover:border-gold/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden">
        {bg ? (
          <img
            src={bg}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-secondary/40 to-background" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/30 to-transparent" />
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          {room.tier === "lifer" && (
            <span className="rounded-full border border-gold/50 bg-background/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold backdrop-blur">
              Lifer
            </span>
          )}
          {isGame && (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-background/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300 backdrop-blur">
              <Gamepad2 className="h-3 w-3" />
              PvP
            </span>
          )}
          {room.is_locked && (
            <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-background/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-destructive backdrop-blur">
              <Lock className="h-3 w-3" />
              Locked
            </span>
          )}
        </div>
        <div className="absolute bottom-0 left-0 right-0 p-3">
          <h2 className="font-display text-xl text-foreground sm:text-2xl">{room.name}</h2>
          {ambience && (
            <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground font-sans-display">
              {ambience}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3 text-xs font-sans-display">
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" /> capacity {room.capacity}
          </span>
          <span className="text-[10px] uppercase tracking-wider">
            {bookings.length} upcoming
          </span>
        </div>
        {bookings[0] && (
          <p className="truncate text-[11px] text-muted-foreground">
            Next: {format(new Date(bookings[0].starts_at), "MMM d HH:mm")} · {bookings[0].title}
          </p>
        )}
        <div className="mt-1 flex gap-2">
          {!isGame && (
            <button
              type="button"
              onClick={(e) => {
                // Don't navigate when the user wants to open the booking modal.
                e.preventDefault();
                e.stopPropagation();
                onBook();
              }}
              disabled={!canBook}
              title={!canBook ? "Verified BAYC/MAYC required to book" : undefined}
              className="flex-1 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-[11px] font-semibold text-gold transition hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Book
            </button>
          )}
          <span className="flex-1 rounded-md bg-gradient-gold px-3 py-2 text-center text-[11px] font-semibold text-gold-foreground shadow-gold">
            {isGame ? "Enter game" : "Enter"}
          </span>
        </div>
      </div>
    </Link>
  );
}

function CreateRoomTile() {
  return (
    <Link
      to="/admin"
      className="group flex min-h-48 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gold/30 bg-gold/[0.03] p-6 text-center transition hover:border-gold/60 hover:bg-gold/10"
    >
      <Plus className="h-8 w-8 text-gold/70 transition group-hover:text-gold" />
      <span className="font-display text-lg text-gold">Create new room</span>
      <span className="text-[11px] text-muted-foreground font-sans-display">
        Super-admins only
      </span>
    </Link>
  );
}

function PreferencesPanel() {
  const { prefs, setPrefs } = useRoomPreferences();
  return (
    <div className="glass rounded-2xl border border-border/60 p-4 shadow-card">
      <h3 className="font-display text-sm text-gold uppercase tracking-wider">
        Your Preferences
      </h3>
      <p className="mt-1 text-[11px] text-muted-foreground font-sans-display">
        Defaults applied every time you join a room.
      </p>
      <div className="mt-3 space-y-2.5 text-xs font-sans-display">
        <ToggleRow
          label="Camera"
          checked={prefs.cameraEnabled}
          onChange={(v) => setPrefs({ cameraEnabled: v })}
        />
        <ToggleRow
          label="Microphone"
          checked={prefs.micEnabled}
          onChange={(v) => setPrefs({ micEnabled: v })}
        />
        <label className="flex cursor-pointer items-start gap-2 pt-1 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={prefs.applyToAll}
            onChange={(e) => setPrefs({ applyToAll: e.target.checked })}
            className="mt-0.5"
          />
          Keep settings for all rooms
        </label>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-foreground">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition ${checked ? "bg-gradient-gold" : "bg-secondary"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition ${checked ? "left-4" : "left-0.5"}`}
        />
      </button>
    </div>
  );
}

function BookingsSummary({
  bookings,
  rooms,
  currentUserId,
  onCancel,
}: {
  bookings: Booking[];
  rooms: Room[];
  currentUserId: string | null;
  onCancel: (id: string) => Promise<void> | void;
}) {
  const mine = bookings.filter((b) => b.user_id === currentUserId).slice(0, 4);
  if (mine.length === 0) return null;
  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? "Room";
  return (
    <div className="glass rounded-2xl border border-border/60 p-4 shadow-card">
      <h3 className="font-display text-sm text-gold uppercase tracking-wider">Your bookings</h3>
      <ul className="mt-3 space-y-2 text-[11px] font-sans-display">
        {mine.map((b) => (
          <li key={b.id} className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{b.title}</p>
              <p className="truncate text-muted-foreground">
                {roomName(b.room_id)} · {format(new Date(b.starts_at), "MMM d HH:mm")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void onCancel(b.id)}
              className="shrink-0 text-[10px] uppercase tracking-wider text-destructive hover:underline"
            >
              cancel
            </button>
          </li>
        ))}
      </ul>
    </div>
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
