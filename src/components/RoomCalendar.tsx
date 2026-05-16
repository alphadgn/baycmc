import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, format, isSameDay, startOfDay } from "date-fns";

interface Booking {
  id: string;
  room_id: string;
  user_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
}
interface Room {
  id: string;
  name: string;
  tier: "token_proof" | "lifer";
}

interface RoomCalendarProps {
  rooms: Room[];
  bookings: Booking[];
  currentUserId: string | null;
  onCancel: (bookingId: string) => void;
}

const DAYS_VISIBLE = 7;

/**
 * BAYCmc calendar — 7-day rolling view of bookings across every room.
 * Conflict prevention is enforced server-side by the
 * `prevent_booking_overlap` trigger; this UI just visualizes the schedule
 * so members can see free slots before they book.
 */
export function RoomCalendar({
  rooms,
  bookings,
  currentUserId,
  onCancel,
}: RoomCalendarProps) {
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));

  const days = useMemo(
    () => Array.from({ length: DAYS_VISIBLE }, (_, i) => addDays(anchor, i)),
    [anchor],
  );

  const roomsById = useMemo(() => {
    const m = new Map<string, Room>();
    for (const r of rooms) m.set(r.id, r);
    return m;
  }, [rooms]);

  const byDay = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const b of bookings) {
      const day = format(new Date(b.starts_at), "yyyy-MM-dd");
      (map.get(day) ?? map.set(day, []).get(day)!).push(b);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
      );
    }
    return map;
  }, [bookings]);

  return (
    <section className="glass rounded-2xl p-4 shadow-card sm:p-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold sm:text-2xl">
            BAYCmc calendar
          </h2>
          <p className="text-xs text-muted-foreground">
            All scheduled meetups · double bookings blocked at the database
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAnchor((a) => addDays(a, -DAYS_VISIBLE))}
            className="rounded-md border border-border bg-secondary/40 p-1.5 text-muted-foreground hover:bg-secondary"
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setAnchor(startOfDay(new Date()))}
            className="rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-secondary"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setAnchor((a) => addDays(a, DAYS_VISIBLE))}
            className="rounded-md border border-border bg-secondary/40 p-1.5 text-muted-foreground hover:bg-secondary"
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="grid gap-2 sm:grid-cols-7">
        {days.map((d) => {
          const isToday = isSameDay(d, new Date());
          const key = format(d, "yyyy-MM-dd");
          const dayBookings = byDay.get(key) ?? [];
          return (
            <div
              key={key}
              className={`rounded-lg border p-2 transition ${
                isToday
                  ? "border-gold/60 bg-gold/5"
                  : "border-border/60 bg-background/30"
              }`}
            >
              <div className="mb-2 flex items-baseline justify-between">
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wider ${
                    isToday ? "text-gold" : "text-muted-foreground"
                  }`}
                >
                  {format(d, "EEE")}
                </span>
                <span
                  className={`font-display text-lg ${
                    isToday ? "text-gradient-gold" : "text-foreground"
                  }`}
                >
                  {format(d, "d")}
                </span>
              </div>
              {dayBookings.length === 0 ? (
                <p className="text-[10px] italic text-muted-foreground">Open</p>
              ) : (
                <ul className="space-y-1">
                  {dayBookings.map((b) => {
                    const room = roomsById.get(b.room_id);
                    const mine = b.user_id === currentUserId;
                    return (
                      <li
                        key={b.id}
                        className={`group rounded-md border px-2 py-1 text-[10px] leading-tight transition ${
                          mine
                            ? "border-gold/40 bg-gold/10 text-foreground"
                            : "border-border bg-secondary/40 text-muted-foreground"
                        }`}
                        title={`${b.title} · ${room?.name ?? "room"} · ${format(
                          new Date(b.starts_at),
                          "HH:mm",
                        )}–${format(new Date(b.ends_at), "HH:mm")}`}
                      >
                        <div className="font-mono tabular-nums">
                          {format(new Date(b.starts_at), "HH:mm")}
                        </div>
                        <div className="truncate font-semibold text-foreground">
                          {b.title}
                        </div>
                        <div className="truncate">{room?.name ?? "room"}</div>
                        {mine && (
                          <button
                            type="button"
                            onClick={() => onCancel(b.id)}
                            className="mt-0.5 hidden text-[9px] text-destructive underline group-hover:inline"
                          >
                            cancel
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
