import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Send, Trash2, UserPlus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { useMemberDirectory } from "@/lib/members/memberSearch";
import { MemberAvatar, MemberSearchBox } from "@/components/members/MemberUi";
import {
  durationLabel,
  formatMeetingTime,
  MEETING_COLUMNS,
  useChapterRooms,
  useChapterViewer,
  useLocalChapters,
  type ChapterMeeting,
  type ChapterRoom,
} from "@/lib/chapters/chapters";
import {
  ChapterGateNotice,
  ChapterPage,
  MeetingCard,
  RoomPicture,
} from "@/components/chapters/ChapterUi";

/**
 * Book a local chapter meeting: chapter, one of the 20 numbered Club Rooms,
 * date (MM/DD/YYYY), time, duration and expected capacity. The request goes
 * to the admins; nothing can be changed until it's approved. Once approved,
 * the leader adds attendees by username here.
 */
export const Route = createFileRoute("/_authenticated/chapters/book")({
  validateSearch: (s: Record<string, unknown>): { chapter?: string } =>
    typeof s.chapter === "string" ? { chapter: s.chapter } : {},
  head: () => ({ meta: [{ title: "Book a Local Chapter Meeting — BAYCmc" }] }),
  component: BookChapterMeeting,
});

const DURATIONS = [30, 45, 60, 90, 120, 180, 240];
const MONTHS = [
  "01 · Jan",
  "02 · Feb",
  "03 · Mar",
  "04 · Apr",
  "05 · May",
  "06 · Jun",
  "07 · Jul",
  "08 · Aug",
  "09 · Sep",
  "10 · Oct",
  "11 · Nov",
  "12 · Dec",
];
const inputCls =
  "min-h-11 w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground";

function BookChapterMeeting() {
  const search = Route.useSearch();
  const { user } = useAuth();
  const viewer = useChapterViewer();
  const chapters = useLocalChapters();
  const rooms = useChapterRooms();
  const members = useMemberDirectory();

  const today = new Date();
  const [chapterId, setChapterId] = useState(search.chapter ?? "");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [day, setDay] = useState(today.getDate());
  const [year, setYear] = useState(today.getFullYear());
  const [time, setTime] = useState("19:00");
  const [minutes, setMinutes] = useState(60);
  const [capacity, setCapacity] = useState(10);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const [mine, setMine] = useState<ChapterMeeting[] | null>(null);
  const [onList, setOnList] = useState<ChapterMeeting[]>([]);
  const [booked, setBooked] = useState<ChapterMeeting[]>([]);

  useEffect(() => {
    if (!chapterId && chapters?.length) setChapterId(chapters[0].id);
  }, [chapters, chapterId]);

  const load = useCallback(async () => {
    if (!user) return;
    const nowIso = new Date().toISOString();
    const [{ data: own }, { data: att }, { data: approved }] = await Promise.all([
      supabase
        .from("chapter_meetings")
        .select(MEETING_COLUMNS)
        .eq("requester_id", user.id)
        .order("starts_at", { ascending: false })
        .limit(30),
      supabase.from("chapter_meeting_attendees").select("meeting_id").eq("user_id", user.id),
      supabase
        .from("chapter_meetings")
        .select(MEETING_COLUMNS)
        .eq("status", "approved")
        .gt("ends_at", nowIso)
        .order("starts_at"),
    ]);
    setMine((own ?? []) as ChapterMeeting[]);
    setBooked((approved ?? []) as ChapterMeeting[]);
    const ids = new Set((att ?? []).map((a) => a.meeting_id));
    setOnList(((approved ?? []) as ChapterMeeting[]).filter((m) => ids.has(m.id)));
  }, [user]);

  useEffect(() => {
    if (viewer) void load();
  }, [viewer, load]);

  const room = rooms?.find((r) => r.id === roomId) ?? null;
  const daysInMonth = new Date(year, month, 0).getDate();
  const start = useMemo(() => {
    const [h, m] = time.split(":").map(Number);
    return new Date(year, month - 1, Math.min(day, daysInMonth), h || 0, m || 0);
  }, [year, month, day, daysInMonth, time]);
  const end = new Date(start.getTime() + minutes * 60_000);

  // Approved meetings in the chosen room on the chosen day (to avoid overlaps).
  const sameDay = booked.filter((b) => {
    if (b.room_id !== roomId) return false;
    const s = new Date(b.starts_at);
    return s.toDateString() === start.toDateString();
  });
  const clash = sameDay.find((b) => new Date(b.starts_at) < end && new Date(b.ends_at) > start);

  async function submit() {
    if (!chapterId) return toast.error("Pick a chapter.");
    if (!room) return toast.error("Pick a room.");
    if (start.getTime() < Date.now() + 10 * 60_000)
      return toast.error("Choose a start time at least 10 minutes from now.");
    if (clash) return toast.error("That room is already booked at that time.");
    setBusy(true);
    const { error } = await supabase.rpc("chapter_request_meeting", {
      _chapter: chapterId,
      _room: room.id,
      _starts: start.toISOString(),
      _minutes: minutes,
      _capacity: capacity,
      _notes: notes.trim() || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Request sent. The admins will approve or decline it.");
    setNotes("");
    void load();
  }

  const years = [today.getFullYear(), today.getFullYear() + 1];
  const chapterName = (id: string) => chapters?.find((c) => c.id === id)?.name;

  return (
    <ChapterPage
      title="Book a local chapter meeting"
      subtitle="Requests go to the admins for approval. After approval you add attendees by username."
    >
      {!viewer ? (
        <ChapterGateNotice viewer={viewer} />
      ) : (
        <div className="space-y-8">
          <section className="glass space-y-5 rounded-2xl p-4 shadow-card sm:p-5">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Chapter
              </span>
              <select
                className={inputCls}
                value={chapterId}
                onChange={(e) => setChapterId(e.target.value)}
              >
                {(chapters ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Room {room ? `· ${room.name} (up to ${room.capacity})` : ""}
              </span>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {(rooms ?? []).map((r: ChapterRoom) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setRoomId(r.id);
                      setCapacity((c) => Math.min(c, r.capacity));
                    }}
                    aria-pressed={roomId === r.id}
                    aria-label={r.name}
                    className={`rounded-xl p-0.5 transition ${
                      roomId === r.id ? "ring-2 ring-gold" : "hover:ring-1 hover:ring-border"
                    }`}
                  >
                    <RoomPicture room={r} className="aspect-[4/3] w-full" />
                  </button>
                ))}
                {rooms === null &&
                  Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} className="aspect-[4/3] animate-pulse rounded-xl bg-muted/20" />
                  ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Date (MM / DD / YYYY)
                </span>
                <div className="grid grid-cols-[1.4fr_1fr_1.2fr] gap-2">
                  <select
                    aria-label="Month"
                    className={inputCls}
                    value={month}
                    onChange={(e) => setMonth(Number(e.target.value))}
                  >
                    {MONTHS.map((m, i) => (
                      <option key={m} value={i + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Day"
                    className={inputCls}
                    value={Math.min(day, daysInMonth)}
                    onChange={(e) => setDay(Number(e.target.value))}
                  >
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>
                        {String(d).padStart(2, "0")}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Year"
                    className={inputCls}
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Start time
                  </span>
                  <input
                    type="time"
                    className={inputCls}
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Duration
                  </span>
                  <select
                    className={inputCls}
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                  >
                    {DURATIONS.map((d) => (
                      <option key={d} value={d}>
                        {d < 60 ? `${d} min` : `${d / 60} h`.replace(".5 h", " h 30 min")}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <label className="block max-w-xs space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Expected capacity (including you)
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={2}
                max={room?.capacity ?? 24}
                className={inputCls}
                value={capacity}
                onChange={(e) =>
                  setCapacity(
                    Math.max(2, Math.min(room?.capacity ?? 24, Number(e.target.value) || 2)),
                  )
                }
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Notes for the admins (optional)
              </span>
              <textarea
                className={`${inputCls} min-h-20`}
                maxLength={1000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What's the meeting about?"
              />
            </label>

            {room && (
              <div className="rounded-xl border border-border/60 bg-background/40 p-3 text-xs">
                <p className="font-semibold">
                  {room.name} on {start.toLocaleDateString()}
                </p>
                {sameDay.length === 0 ? (
                  <p className="mt-1 text-muted-foreground">No approved meetings that day.</p>
                ) : (
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {sameDay.map((b) => (
                      <li key={b.id}>Booked {formatMeetingTime(b.starts_at, b.ends_at)}</li>
                    ))}
                  </ul>
                )}
                {clash && (
                  <p className="mt-1 font-semibold text-destructive">
                    Your time overlaps a booked meeting. Pick another time or room.
                  </p>
                )}
              </div>
            )}

            <button
              type="button"
              disabled={busy || !room || !!clash}
              onClick={() => void submit()}
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground shadow-gold disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send request ({formatMeetingTime(start.toISOString(), end.toISOString())},{" "}
              {durationLabel(start.toISOString(), end.toISOString())})
            </button>
          </section>

          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">
              Meetings you booked
            </h2>
            {mine === null ? (
              <div className="h-24 animate-pulse rounded-2xl bg-muted/20" />
            ) : mine.length === 0 ? (
              <div className="glass rounded-2xl p-6 text-center text-sm text-muted-foreground">
                You haven't requested any meetings yet.
              </div>
            ) : (
              mine.map((m) => (
                <MeetingCard
                  key={m.id}
                  meeting={m}
                  room={rooms?.find((r) => r.id === m.room_id)}
                  chapterName={chapterName(m.chapter_id)}
                  canEnter
                >
                  <MyMeetingActions meeting={m} members={members} onChange={load} />
                </MeetingCard>
              ))
            )}
          </section>

          {onList.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">
                You're on the list
              </h2>
              {onList.map((m) => (
                <MeetingCard
                  key={m.id}
                  meeting={m}
                  room={rooms?.find((r) => r.id === m.room_id)}
                  chapterName={chapterName(m.chapter_id)}
                  leaderName={members.find((x) => x.id === m.requester_id)?.username}
                  canEnter
                />
              ))}
            </section>
          )}
        </div>
      )}
    </ChapterPage>
  );
}

function MyMeetingActions({
  meeting,
  members,
  onChange,
}: {
  meeting: ChapterMeeting;
  members: { id: string; username: string; avatar_url: string | null }[];
  onChange: () => void;
}) {
  const [attendees, setAttendees] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const upcoming = new Date(meeting.ends_at).getTime() > Date.now();
  const canManage = meeting.status === "approved" && upcoming;
  const canCancel =
    (meeting.status === "pending" || meeting.status === "approved") &&
    new Date(meeting.starts_at).getTime() > Date.now();

  const loadAttendees = useCallback(async () => {
    const { data } = await supabase
      .from("chapter_meeting_attendees")
      .select("user_id")
      .eq("meeting_id", meeting.id)
      .order("created_at");
    setAttendees((data ?? []).map((a) => a.user_id));
  }, [meeting.id]);
  useEffect(() => {
    if (canManage) void loadAttendees();
  }, [canManage, loadAttendees]);

  async function setAttendee(userId: string, add: boolean) {
    setBusy(userId);
    const { error } = await supabase.rpc("chapter_set_attendee", {
      _meeting: meeting.id,
      _user: userId,
      _add: add,
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    void loadAttendees();
  }

  async function cancel() {
    if (!window.confirm("Cancel this meeting?")) return;
    setBusy("cancel");
    const { error } = await supabase.rpc("chapter_cancel_meeting", { _meeting: meeting.id });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("Meeting cancelled.");
    onChange();
  }

  const who = (id: string) => members.find((m) => m.id === id);
  const leaderLabels = meeting.leader_labels.includes("PUNKS")
    ? meeting.leader_labels.some((l) => l === "BAYC" || l === "MAYC")
      ? "verified BAYC, MAYC or CryptoPunks"
      : "verified CryptoPunks"
    : "verified BAYC or MAYC";

  return (
    <div className="mt-3 space-y-3 border-t border-border/50 pt-3">
      {meeting.status === "pending" && (
        <p className="text-xs text-muted-foreground">
          Waiting for an admin to approve. You can't change it until then.
        </p>
      )}
      {meeting.status === "ended" && (
        <Link
          to="/chapters/minutes/$meetingId"
          params={{ meetingId: meeting.id }}
          className="inline-flex min-h-10 items-center rounded-md border border-gold/50 px-3 py-2 text-xs font-semibold text-gold"
        >
          Archive / export the minutes
        </Link>
      )}
      {canManage && (
        <div className="space-y-2">
          <p className="text-xs font-semibold">
            Attendees ({(attendees?.length ?? 0) + 1} of {meeting.expected_capacity}, including you)
          </p>
          <p className="text-[11px] text-muted-foreground">
            Add {leaderLabels} holders by username. Only people on this list (plus admins) can enter
            during the meeting.
          </p>
          <MemberSearchBox
            placeholder="Add an attendee by username"
            onSelect={(m) => void setAttendee(m.id, true)}
          />
          <ul className="flex flex-wrap gap-2">
            {(attendees ?? []).map((id) => {
              const m = who(id);
              return (
                <li
                  key={id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/50 py-1 pl-1 pr-2 text-xs"
                >
                  <MemberAvatar
                    m={{ username: m?.username ?? "?", avatar_url: m?.avatar_url ?? null }}
                    size={22}
                  />
                  @{m?.username ?? "member"}
                  <button
                    type="button"
                    aria-label={`Remove ${m?.username ?? "member"}`}
                    disabled={busy === id}
                    onClick={() => void setAttendee(id, false)}
                    className="ml-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
            {attendees?.length === 0 && (
              <li className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <UserPlus className="h-3.5 w-3.5" /> No attendees yet.
              </li>
            )}
          </ul>
        </div>
      )}
      {canCancel && (
        <button
          type="button"
          onClick={() => void cancel()}
          disabled={busy === "cancel"}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" /> Cancel meeting
        </button>
      )}
    </div>
  );
}
