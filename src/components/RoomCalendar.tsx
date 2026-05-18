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
 * BAYCmc calendar — minimal printed-poster style year overview.
 * Click a month to expand it into a full day grid for booking selection.
 */
export function RoomCalendar({
  rooms,
  bookings,
  currentUserId,
  onCancel,
}: RoomCalendarProps) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null);
  const [selected, setSelected] = useState<Date | null>(null);

  const roomsById = useMemo(() => {
    const m = new Map<string, Room>();
    for (const r of rooms) m.set(r.id, r);
    return m;
  }, [rooms]);

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

  function renderMonthGrid(mIdx: number, opts: { large: boolean }) {
    const monthStart = startOfMonth(new Date(year, mIdx, 1));
    const monthEnd = endOfMonth(monthStart);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
    const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
    const { large } = opts;
    const weekdayClass = large
      ? "grid grid-cols-7 text-sm font-bold tracking-wider text-calendar-muted-ink"
      : "grid grid-cols-7 text-[6px] font-extrabold tracking-wider text-calendar-ink sm:text-[10px]";
    const dayGridClass = large
      ? "mt-4 grid grid-cols-7 gap-y-3"
      : "mt-1 grid grid-cols-7 gap-y-1.5";

    return (
      <>
        <div className={weekdayClass}>
          {DOW.map((d, i) => (
            <div key={i} className={`${large ? "py-2" : "py-0.5"} text-center`}>{d}</div>
          ))}
        </div>
        <div className="h-px w-full bg-calendar-rule" />
        <div className={dayGridClass}>
          {days.map((day) => {
            const inMonth = isSameMonth(day, monthStart);
            const isToday = isSameDay(day, today);
            const key = format(day, "yyyy-MM-dd");
            const has = (byDay.get(key)?.length ?? 0) > 0;
            const isSelected = selected && isSameDay(day, selected);
            if (!large) {
              return (
                <div
                  key={key}
                  className={`relative h-3 text-center font-display text-[6px] font-extrabold leading-none sm:h-5 sm:text-[10px] ${
                    inMonth ? "text-calendar-ink" : "text-transparent"
                  }`}
                >
                  <span className="absolute inset-0 flex items-center justify-center">
                    {format(day, "d")}
                  </span>
                </div>
              );
            }
            return (
              <button
                key={key}
                type="button"
                onClick={() => inMonth && setSelected(day)}
                disabled={!inMonth}
                className={`relative h-10 rounded-md text-center font-display text-sm font-bold transition ${
                  inMonth ? "text-calendar-ink" : "text-transparent"
                } ${
                  isSelected
                    ? "bg-gold text-gold-foreground"
                    : isToday
                      ? "bg-gold/20 text-calendar-ink"
                      : has
                        ? "bg-gold/10 hover:bg-gold/20"
                        : "hover:bg-calendar-rule/40"
                }`}
                aria-label={inMonth ? format(day, "PPP") : undefined}
              >
                <span className="absolute inset-0 flex items-center justify-center">
                  {format(day, "d")}
                </span>
                {has && !isSelected && (
                  <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-gold" />
                )}
              </button>
            );
          })}
        </div>
      </>
    );
  }

  if (expandedMonth !== null) {
    return (
      <section className="mx-auto w-full max-w-4xl bg-calendar-paper px-6 py-8 text-calendar-ink shadow-card sm:px-10 sm:py-12">
        <header className="mb-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setExpandedMonth(null);
              setSelected(null);
            }}
            className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.25em] text-calendar-muted-ink hover:text-calendar-ink"
            aria-label="Back to year"
          >
            <ChevronLeft className="h-4 w-4" />
            {year}
          </button>
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
            {MONTH_LABELS[expandedMonth]}
          </h2>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() =>
                setExpandedMonth((m) => (m === null ? null : (m + 11) % 12))
              }
              className="rounded-md p-1.5 text-calendar-muted-ink hover:bg-calendar-rule/40"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() =>
                setExpandedMonth((m) => (m === null ? null : (m + 1) % 12))
              }
              className="rounded-md p-1.5 text-calendar-muted-ink hover:bg-calendar-rule/40"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </header>

        {renderMonthGrid(expandedMonth, { large: true })}

        {selected && (
          <div
            className="mt-8 border border-calendar-rule bg-calendar-paper p-4"
            aria-live="polite"
          >
            <div className="mb-3 flex items-center justify-between">
              <h4 className="font-display text-lg">
                {format(selected, "EEEE, MMMM d")}
              </h4>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-xs font-bold text-calendar-muted-ink hover:text-calendar-ink"
              >
                Close
              </button>
            </div>
            {selectedBookings.length === 0 ? (
              <p className="text-xs italic text-calendar-muted-ink">
                No bookings on this day. Choose a room below to reserve a time.
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
                          : "border-calendar-rule bg-calendar-rule/20"
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

  return (
    <section className="mx-auto aspect-[3/4] w-full min-w-[760px] max-w-5xl bg-calendar-paper px-14 py-12 text-calendar-ink shadow-card sm:px-16 sm:py-14">
      <header className="mb-10 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setYear((y) => y - 1)}
          className="rounded-md p-2 text-calendar-muted-ink hover:bg-calendar-rule/40"
          aria-label="Previous year"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h2 className="font-display text-7xl font-extrabold tracking-tight text-calendar-ink sm:text-8xl">
          {year}
        </h2>
        <button
          type="button"
          onClick={() => setYear((y) => y + 1)}
          className="rounded-md p-2 text-calendar-muted-ink hover:bg-calendar-rule/40"
          aria-label="Next year"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </header>

      <div className="grid grid-cols-3 gap-x-16 gap-y-10">
        {MONTH_LABELS.map((label, mIdx) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              setExpandedMonth(mIdx);
              setSelected(null);
            }}
            className="group text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            aria-label={`Open ${label}`}
          >
            <h3 className="mb-3 text-center font-display text-3xl font-extrabold tracking-tight text-calendar-ink group-hover:text-gold">
              {label}
            </h3>
            {renderMonthGrid(mIdx, { large: false })}
          </button>
        ))}
      </div>
    </section>
  );
}
