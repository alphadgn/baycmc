import { Link } from "@tanstack/react-router";
import { CalendarDays, Clock, DoorOpen, Lock, Users } from "lucide-react";
import { getRoomThemeImage } from "@/lib/baycmc/roomThemes";
import {
  durationLabel,
  formatMeetingTime,
  meetingOpen,
  STATUS_LABEL,
  type ChapterMeeting,
  type ChapterRoom,
} from "@/lib/chapters/chapters";

/** Page frame for the Local Chapters pages. */
export function ChapterPage({
  eyebrow = "Local Chapters",
  title,
  subtitle,
  children,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.4em] text-gold">{eyebrow}</p>
          <h1 className="font-display text-2xl font-bold sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{subtitle}</p>}
        </div>
        {actions}
      </header>
      {children}
    </main>
  );
}

export function ChapterGateNotice({ viewer }: { viewer: boolean | null }) {
  if (viewer === null) {
    return <div className="h-40 animate-pulse rounded-2xl bg-muted/20" />;
  }
  return (
    <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">
      <Lock className="mx-auto mb-2 h-5 w-5 text-gold" />
      Local Chapters are for verified BAYC, MAYC and CryptoPunks holders. Sign in with the wallet
      that holds yours to continue.
    </div>
  );
}

export function RoomPicture({
  room,
  className = "",
}: {
  room: Pick<ChapterRoom, "theme" | "number" | "name">;
  className?: string;
}) {
  const img = getRoomThemeImage(room.theme);
  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-border/60 bg-muted/30 ${className}`}
    >
      {img && <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" />}
      <span className="absolute left-1.5 top-1.5 inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-background/85 px-2 text-xs font-bold text-gold shadow">
        {room.number}
      </span>
    </div>
  );
}

const STATUS_TONE: Record<ChapterMeeting["status"], string> = {
  pending: "border-amber-400/40 text-amber-300",
  approved: "border-emerald-400/40 text-emerald-300",
  declined: "border-destructive/40 text-destructive",
  cancelled: "border-border text-muted-foreground",
  ended: "border-border text-muted-foreground",
};

export function StatusPill({ status }: { status: ChapterMeeting["status"] }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_TONE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** One meeting, as a card. `children` adds actions/panels below. */
export function MeetingCard({
  meeting,
  room,
  chapterName,
  leaderName,
  canEnter,
  children,
}: {
  meeting: ChapterMeeting;
  room?: ChapterRoom;
  chapterName?: string;
  leaderName?: string;
  canEnter?: boolean;
  children?: React.ReactNode;
}) {
  const open = meetingOpen(meeting);
  return (
    <article className="glass rounded-2xl p-3 shadow-card sm:p-4">
      <div className="flex gap-3">
        {room && <RoomPicture room={room} className="h-20 w-24 shrink-0 sm:h-24 sm:w-32" />}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold">
              {chapterName ? `${chapterName} · ` : ""}
              {room?.name ?? "Club Room"}
            </h3>
            <StatusPill status={meeting.status} />
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            {formatMeetingTime(meeting.starts_at, meeting.ends_at)}
          </p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> {durationLabel(meeting.starts_at, meeting.ends_at)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5" /> up to {meeting.expected_capacity}
            </span>
            {leaderName && <span>Led by @{leaderName}</span>}
          </p>
          {meeting.notes && (
            <p className="line-clamp-3 text-xs text-foreground/80">{meeting.notes}</p>
          )}
          {meeting.review_note && meeting.status !== "approved" && (
            <p className="text-xs text-muted-foreground">Admin note: {meeting.review_note}</p>
          )}
          {canEnter && open && (
            <Link
              to="/chapters/meeting/$meetingId"
              params={{ meetingId: meeting.id }}
              className="mt-1 inline-flex min-h-10 items-center gap-2 rounded-md bg-gradient-gold px-3 py-2 text-xs font-semibold text-gold-foreground shadow-gold"
            >
              <DoorOpen className="h-4 w-4" /> Enter the room
            </Link>
          )}
        </div>
      </div>
      {children}
    </article>
  );
}
