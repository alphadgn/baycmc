import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";

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
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * BAYCmc calendar — 12-month yearly view of bookings across every room.
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
  const [year, setYear] = useState(() => new Date().getFullYear());
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const roomsById = useMemo(() => {
    const m = new Map<string, Room>();
    for (const r of rooms) m.set(r.id, r);
    return m;
  }, [rooms]);

  const byMonth = useMemo(() => {
    const map = new Map<number, Booking[]>();
    for (const b of bookings) {
      const d = new Date(b.starts_at);
      if (d.getFullYear() !== year) continue;
      const m = d.getMonth();
      (map.get(m) ?? map.set(m, []).get(m)!).push(b);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
      );
    }
    return map;
  }, [bookings, year]);

  return (
    <section className="glass rounded-2xl p-4 shadow-card sm:p-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold sm:text-2xl">
            BAYCmc calendar
          </h2>
          <p className="text-xs text-muted-foreground">
            {year} · 12-month overview · double bookings blocked at the database
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setYear((y) => y - 1)}
            className="rounded-md border border-border bg-secondary/40 p-1.5 text-muted-foreground hover:bg-secondary"
            aria-label="Previous year"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setYear(currentYear)}
            className="rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-secondary"
          >
            This year
          </button>
          <button
            type="button"
            onClick={() => setYear((y) => y + 1)}
            className="rounded-md border border-border bg-secondary/40 p-1.5 text-muted-foreground hover:bg-secondary"
            aria-label="Next year"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {MONTH_LABELS.map((label, m) => {
          const isCurrent = m === currentMonth && year === currentYear;
          const monthBookings = byMonth.get(m) ?? [];
          const preview = monthBookings.slice(0, 3);
          const more = monthBookings.length - preview.length;
          return (
            <div
              key={label}
              className={`rounded-lg border p-3 transition ${
                isCurrent
                  ? "border-gold/60 bg-gold/5"
                  : "border-border/60 bg-background/30"
              }`}
            >
              <div className="mb-2 flex items-baseline justify-between">
                <span
                  className={`font-display text-base ${
                    isCurrent ? "text-gradient-gold" : "text-foreground"
                  }`}
                >
                  {label}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {monthBookings.length} booking{monthBookings.length === 1 ? "" : "s"}
                </span>
              </div>
              {preview.length === 0 ? (
                <p className="text-[10px] italic text-muted-foreground">Open</p>
              ) : (
                <ul className="space-y-1">
                  {preview.map((b) => {
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
                          "MMM d HH:mm",
                        )}`}
                      >
                        <div className="font-mono tabular-nums">
                          {format(new Date(b.starts_at), "MMM d · HH:mm")}
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
                  {more > 0 && (
                    <li className="text-[10px] text-muted-foreground">
                      +{more} more
                    </li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
