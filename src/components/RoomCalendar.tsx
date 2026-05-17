import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  format,
} from "date-fns";

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

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * BAYCmc calendar — clean printable 12-month year grid in the style of the
 * uploaded reference. Days with bookings are subtly highlighted; tap any day
 * to see who has it reserved. Conflict prevention is enforced server-side by
 * the `prevent_booking_overlap` trigger.
 */
export function RoomCalendar({
  rooms,
  bookings,
  currentUserId,
  onCancel,
}: RoomCalendarProps) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [selected, setSelected] = useState<Date | null>(null);

  const roomsById = useMemo(() => {
    const m = new Map<string, Room>();
    for (const r of rooms) m.set(r.id, r);
    return m;
  }, [rooms]);

  // Map of yyyy-MM-dd -> bookings on that day (current year only)
  const byDay = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const b of bookings) {
      const d = new Date(b.starts_at);
      if (d.getFullYear() !== year) continue;
      const key = format(d, "yyyy-MM-dd");
      const list = map.get(key) ?? [];
      list.push(b);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
      );
    }
    return map;
  }, [bookings, year]);

  const selectedBookings = selected
    ? byDay.get(format(selected, "yyyy-MM-dd")) ?? []
    : [];

  return (
    <section className="glass rounded-2xl p-4 shadow-card sm:p-6">
      <header className="mb-5 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setYear((y) => y - 1)}
          className="rounded-md border border-border bg-secondary/40 p-1.5 text-muted-foreground hover:bg-secondary"
          aria-label="Previous year"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-center">
          <div className="font-display text-4xl font-bold text-gradient-gold sm:text-6xl">
            {year}
          </div>
          <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            BAYCmc calendar · 12-month overview
          </p>
        </div>
        <button
          type="button"
          onClick={() => setYear((y) => y + 1)}
          className="rounded-md border border-border bg-secondary/40 p-1.5 text-muted-foreground hover:bg-secondary"
          aria-label="Next year"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </header>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {MONTH_LABELS.map((label, mIdx) => {
          const monthStart = startOfMonth(new Date(year, mIdx, 1));
          const monthEnd = endOfMonth(monthStart);
          const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
          const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
          const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

          return (
            <div key={label} className="rounded-lg p-2">
              <h3 className="mb-2 font-display text-lg font-bold tracking-tight">
                {label}
              </h3>
              <div className="grid grid-cols-7 gap-y-1 border-b border-border/60 pb-1 text-[10px] font-semibold text-muted-foreground">
                {DOW.map((d, i) => (
                  <div key={i} className="text-center">{d}</div>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-y-0.5">
                {days.map((day) => {
                  const inMonth = isSameMonth(day, monthStart);
                  const isToday = isSameDay(day, today);
                  const key = format(day, "yyyy-MM-dd");
                  const has = (byDay.get(key)?.length ?? 0) > 0;
                  const isSelected = selected && isSameDay(day, selected);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => inMonth && setSelected(day)}
                      disabled={!inMonth}
                      className={`relative aspect-square text-center text-[10px] leading-none transition ${
                        inMonth ? "text-foreground" : "text-transparent"
                      } ${
                        isSelected
                          ? "rounded-full bg-gold text-gold-foreground"
                          : isToday
                            ? "rounded-full bg-gold/20 font-semibold text-gold"
                            : has
                              ? "rounded-full bg-secondary/60 font-semibold hover:bg-secondary"
                              : "hover:text-gold"
                      }`}
                      aria-label={inMonth ? format(day, "PPP") : undefined}
                    >
                      <span className="absolute inset-0 flex items-center justify-center">
                        {format(day, "d")}
                      </span>
                      {has && !isSelected && (
                        <span className="absolute bottom-0 left-1/2 h-0.5 w-0.5 -translate-x-1/2 rounded-full bg-gold" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {selected && (
        <div
          className="mt-6 rounded-xl border border-border/60 bg-background/40 p-4"
          aria-live="polite"
        >
          <div className="mb-3 flex items-center justify-between">
            <h4 className="font-display text-lg">
              {format(selected, "EEEE, MMMM d")}
            </h4>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          </div>
          {selectedBookings.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">
              No bookings on this day.
            </p>
          ) : (
            <ul className="space-y-2">
              {selectedBookings.map((b) => {
                const room = roomsById.get(b.room_id);
                const mine = b.user_id === currentUserId;
                return (
                  <li
                    key={b.id}
                    className={`flex items-center justify-between rounded-md border px-3 py-2 text-xs ${
                      mine
                        ? "border-gold/40 bg-gold/10"
                        : "border-border bg-secondary/40"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-mono tabular-nums text-muted-foreground">
                        {format(new Date(b.starts_at), "HH:mm")}–
                        {format(new Date(b.ends_at), "HH:mm")}
                      </div>
                      <div className="truncate font-semibold">{b.title}</div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {room?.name ?? "room"}
                      </div>
                    </div>
                    {mine && (
                      <button
                        type="button"
                        onClick={() => onCancel(b.id)}
                        className="ml-3 shrink-0 text-[10px] text-destructive underline"
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
      )}
    </section>
  );
}
