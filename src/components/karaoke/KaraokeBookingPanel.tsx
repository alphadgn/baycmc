/**
 * Karaoke booking: reserve a stage slot (time + singer + optional song)
 * before joining the room.
 *
 * Writes go through karaoke_book_slot / karaoke_cancel_reservation RPCs,
 * which enforce 5-minute alignment, max slot length, the booking window,
 * per-member booking limits, mutes/bans and no-overlap (per room AND per
 * singer). When a slot starts, the server hands the reserved singer the
 * stage as soon as they're in the room (3-minute grace, then no-show →
 * open mic resumes).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import type { KaraokeRoomSettings } from "@/lib/karaoke/stageStore";
import {
  KaraokeTrackLibrary,
  type BackingTrackRow,
} from "@/components/karaoke/KaraokeTrackLibrary";

interface Reservation {
  id: string;
  booked_by: string;
  singer_user_id: string;
  song_title: string | null;
  song_artist: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function localDateStr(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function nextFiveMinute(): Date {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil((d.getMinutes() + 1) / 5) * 5);
  return d;
}

export function KaraokeBookingPanel({
  roomId,
  settings,
  isModerator = false,
}: {
  roomId: string;
  settings: KaraokeRoomSettings;
  isModerator?: boolean;
}) {
  const { user } = useAuth();
  const first = useMemo(nextFiveMinute, []);
  const [date, setDate] = useState(localDateStr(first));
  const [time, setTime] = useState(`${pad(first.getHours())}:${pad(first.getMinutes())}`);
  const [minutes, setMinutes] = useState(Math.min(10, settings.max_slot_minutes));
  const [singerMode, setSingerMode] = useState<"me" | "member">("me");
  const [singerQuery, setSingerQuery] = useState("");
  const [singerHits, setSingerHits] = useState<{ id: string; username: string | null }[]>([]);
  const [singer, setSinger] = useState<{ id: string; username: string | null } | null>(null);
  const [songTitle, setSongTitle] = useState("");
  const [songArtist, setSongArtist] = useState("");
  const [track, setTrack] = useState<BackingTrackRow | null>(null);
  const [pickTrack, setPickTrack] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Reservation[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("karaoke_reservations")
      .select("id,booked_by,singer_user_id,song_title,song_artist,starts_at,ends_at,status")
      .eq("room_id", roomId)
      .eq("status", "booked")
      .gt("ends_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(50);
    const list = (data ?? []) as Reservation[];
    setRows(list);
    const ids = Array.from(new Set(list.flatMap((r) => [r.singer_user_id, r.booked_by])));
    if (ids.length) {
      const { data: profs } = await supabase
        .rpc("member_profiles")
        .select("id,username")
        .in("id", ids);
      const map: Record<string, string> = {};
      for (const id of ids) map[id] = `Member ${id.slice(0, 4)}`;
      for (const p of (profs ?? []) as { id: string; username: string | null }[]) {
        if (p.username) map[p.id] = p.username;
      }
      setNames(map);
    }
  }, [roomId]);

  useEffect(() => {
    void load();
    const ch = supabase
      .channel(`karaoke-res-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "karaoke_reservations",
          filter: `room_id=eq.${roomId}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [roomId, load]);

  // Member search for "book for someone else" (duets, birthday surprises…).
  useEffect(() => {
    if (singerMode !== "member" || singerQuery.trim().length < 2) {
      setSingerHits([]);
      return;
    }
    const t = window.setTimeout(async () => {
      const { data } = await supabase
        .rpc("member_profiles")
        .select("id,username")
        .ilike("username", `%${singerQuery.trim().replace(/[%_]/g, "")}%`)
        .limit(8);
      setSingerHits((data ?? []) as { id: string; username: string | null }[]);
    }, 250);
    return () => window.clearTimeout(t);
  }, [singerQuery, singerMode]);

  const timeOptions = useMemo(() => {
    const out: string[] = [];
    for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m += 5) out.push(`${pad(h)}:${pad(m)}`);
    return out;
  }, []);
  const durationOptions = useMemo(() => {
    const out: number[] = [];
    for (let m = 5; m <= settings.max_slot_minutes; m += 5) out.push(m);
    return out;
  }, [settings.max_slot_minutes]);

  async function book() {
    if (!user) return;
    const startsAt = new Date(`${date}T${time}:00`);
    if (Number.isNaN(startsAt.getTime())) {
      toast.error("Pick a valid date and time.");
      return;
    }
    if (singerMode === "member" && !singer) {
      toast.error("Choose the member who will sing.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("karaoke_book_slot", {
      _room: roomId,
      _starts_at: startsAt.toISOString(),
      _minutes: minutes,
      _singer: singerMode === "member" ? singer?.id : undefined,
      _song_title: (songTitle.trim() || track?.title) ?? undefined,
      _song_artist: (songArtist.trim() || track?.artist) ?? undefined,
      _backing_track_id: track?.id ?? undefined,
      _notes: notes.trim() || undefined,
    });
    setBusy(false);
    if (error) {
      toast.error("Couldn't book that slot", { description: error.message });
      return;
    }
    toast.success("Slot booked", {
      description: `${startsAt.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} · ${minutes} min`,
    });
    setSongTitle("");
    setSongArtist("");
    setTrack(null);
    setNotes("");
    void load();
  }

  async function cancel(id: string) {
    const { error } = await supabase.rpc("karaoke_cancel_reservation", { _id: id });
    if (error) toast.error(error.message);
    else void load();
  }

  const input =
    "w-full rounded-md border border-border bg-secondary/30 px-2 py-1.5 text-sm outline-none focus:border-gold/60";

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-lg border border-gold/20 bg-black/30 p-3">
        <h3 className="flex items-center gap-2 font-display text-sm uppercase tracking-[0.25em] text-gold">
          <CalendarPlus className="h-4 w-4" /> Reserve the stage
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-[11px] text-muted-foreground">
            Date
            <input
              type="date"
              value={date}
              min={localDateStr(new Date())}
              max={localDateStr(new Date(Date.now() + settings.booking_window_days * 86_400_000))}
              onChange={(e) => setDate(e.target.value)}
              className={input}
            />
          </label>
          <label className="space-y-1 text-[11px] text-muted-foreground">
            Start
            <select value={time} onChange={(e) => setTime(e.target.value)} className={input}>
              {timeOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 space-y-1 text-[11px] text-muted-foreground">
            Length
            <select
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className={input}
            >
              {durationOptions.map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="space-y-1 text-[11px] text-muted-foreground">
          Singer
          <div className="flex gap-2">
            {(["me", "member"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setSingerMode(m)}
                className={`flex-1 rounded-md border px-2 py-1 text-xs ${
                  singerMode === m
                    ? "border-gold/60 bg-gold/15 text-gold"
                    : "border-border text-muted-foreground"
                }`}
              >
                {m === "me" ? "Me" : "Another member"}
              </button>
            ))}
          </div>
          {singerMode === "member" && (
            <div className="space-y-1">
              <input
                value={singer ? (singer.username ?? singer.id.slice(0, 8)) : singerQuery}
                onChange={(e) => {
                  setSinger(null);
                  setSingerQuery(e.target.value);
                }}
                placeholder="Search by username"
                className={input}
              />
              {!singer && singerHits.length > 0 && (
                <ul className="rounded-md border border-border bg-popover text-xs">
                  {singerHits.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        onClick={() => setSinger(h)}
                        className="w-full px-2 py-1 text-left hover:bg-secondary"
                      >
                        {h.username ?? h.id.slice(0, 8)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <input
            value={songTitle}
            onChange={(e) => setSongTitle(e.target.value)}
            placeholder="Song (optional)"
            maxLength={200}
            className={input}
          />
          <input
            value={songArtist}
            onChange={(e) => setSongArtist(e.target.value)}
            placeholder="Artist (optional)"
            maxLength={200}
            className={input}
          />
        </div>
        {settings.allow_uploads && (
          <div className="space-y-1 text-[11px] text-muted-foreground">
            {track ? (
              <div className="flex items-center justify-between rounded-md border border-gold/30 px-2 py-1 text-xs text-gold">
                Backing track: {track.title}
                <button
                  type="button"
                  onClick={() => setTrack(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  remove
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPickTrack((v) => !v)}
                className="text-gold underline-offset-2 hover:underline"
              >
                {pickTrack ? "Hide backing tracks" : "Attach an uploaded backing track (optional)"}
              </button>
            )}
            {pickTrack && !track && (
              <div className="rounded-md border border-border p-2">
                <KaraokeTrackLibrary
                  onPick={(t) => {
                    setTrack(t);
                    setPickTrack(false);
                  }}
                />
              </div>
            )}
          </div>
        )}
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes for the host (optional)"
          rows={2}
          maxLength={500}
          className={input}
        />
        <button
          type="button"
          disabled={busy || !user}
          onClick={() => void book()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground shadow-gold disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Book slot
        </button>
        <p className="text-[10px] leading-snug text-muted-foreground">
          Slots are {settings.max_slot_minutes} min max, up to {settings.booking_window_days} days
          ahead, {settings.max_future_bookings} upcoming per member. Be in the room when your slot
          starts — after 3 minutes it's released to the open-mic line.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="font-display text-sm uppercase tracking-[0.25em] text-gold">Upcoming</h3>
        {rows === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-gold/60" />
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No bookings yet — the stage is open mic.</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((r) => {
              const live = new Date(r.starts_at).getTime() <= Date.now();
              const mine = r.booked_by === user?.id || r.singer_user_id === user?.id;
              return (
                <li
                  key={r.id}
                  className="flex items-center gap-2 rounded-md border border-border/60 bg-black/30 px-2 py-1.5 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-foreground">
                      {names[r.singer_user_id] ?? "Member"}
                      {r.song_title && (
                        <span className="font-normal text-muted-foreground"> · {r.song_title}</span>
                      )}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(r.starts_at).toLocaleString([], {
                        weekday: "short",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      {" – "}
                      {new Date(r.ends_at).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      {live && <span className="ml-1 text-emerald-400">● live</span>}
                    </p>
                  </div>
                  {(mine || isModerator) && (
                    <button
                      type="button"
                      onClick={() => void cancel(r.id)}
                      aria-label="Cancel booking"
                      className="rounded p-1 text-rose-300/70 hover:text-rose-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
