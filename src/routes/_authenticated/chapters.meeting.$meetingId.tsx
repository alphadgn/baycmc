import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ConferenceRoom } from "@/components/ConferenceRoom";
import { LobbyChat } from "@/components/LobbyChat";
import { getRoomThemeAmbience, getRoomThemeImage } from "@/lib/baycmc/roomThemes";
import {
  formatMeetingTime,
  MEETING_COLUMNS,
  meetingOpen,
  useChapterRooms,
  type ChapterMeeting,
} from "@/lib/chapters/chapters";
import { ChapterPage } from "@/components/chapters/ChapterUi";

/**
 * A local chapter meeting in its Club Room. Only the leader, the listed
 * attendees, admins and the super admin get in (the LiveKit token gate and
 * the room/chat row-level security check it). The meeting has its own chat,
 * which feeds the minutes when it ends.
 */
export const Route = createFileRoute("/_authenticated/chapters/meeting/$meetingId")({
  head: () => ({ meta: [{ title: "Chapter Meeting — BAYCmc" }] }),
  component: ChapterMeetingRoom,
});

function ChapterMeetingRoom() {
  const { meetingId } = Route.useParams();
  const rooms = useChapterRooms();
  const [meeting, setMeeting] = useState<ChapterMeeting | null | undefined>(undefined);
  const [chapterName, setChapterName] = useState<string>("");
  const [chatOpen, setChatOpen] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("chapter_meetings")
      .select(MEETING_COLUMNS)
      .eq("id", meetingId)
      .maybeSingle()
      .then(async ({ data }) => {
        if (cancelled) return;
        setMeeting((data as ChapterMeeting | null) ?? null);
        if (data) {
          const { data: c } = await supabase
            .from("local_chapters")
            .select("name")
            .eq("id", data.chapter_id)
            .maybeSingle();
          if (!cancelled) setChapterName(c?.name ?? "");
        }
      });
    // Re-check the clock so the room opens / closes on time.
    const t = window.setInterval(() => tick((x) => x + 1), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [meetingId]);

  const room = rooms?.find((r) => r.id === meeting?.room_id);

  if (meeting === undefined || (meeting && rooms === null)) {
    return (
      <main className="flex min-h-[60dvh] items-center justify-center px-4">
        <div className="h-[50vh] w-full max-w-4xl animate-pulse rounded-2xl bg-muted/20" />
      </main>
    );
  }
  if (!meeting || !room) {
    return (
      <ChapterPage title="Meeting not found">
        <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">
          This meeting isn't available to you, or it has ended and been archived.
          <div className="mt-4">
            <Link to="/chapters/book" className="text-gold underline">
              Your chapter meetings
            </Link>
          </div>
        </div>
      </ChapterPage>
    );
  }
  if (!meetingOpen(meeting)) {
    const before = new Date(meeting.starts_at).getTime() > Date.now();
    return (
      <ChapterPage title={`${chapterName || "Chapter"} · ${room.name}`}>
        <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">
          {meeting.status !== "approved" && meeting.status !== "ended"
            ? "This meeting isn't approved."
            : before
              ? `The room opens 10 minutes before the meeting: ${formatMeetingTime(meeting.starts_at, meeting.ends_at)}.`
              : "This meeting has ended."}
        </div>
      </ChapterPage>
    );
  }

  return (
    <>
      <ConferenceRoom
        roomId={room.id}
        roomName={`${chapterName ? `${chapterName} · ` : ""}${room.name}`}
        ambience={getRoomThemeAmbience(room.theme)}
        backgroundImage={getRoomThemeImage(room.theme)}
        kind="conference"
        hostUserId={meeting.requester_id}
      />
      <button
        type="button"
        onClick={() => setChatOpen((o) => !o)}
        aria-expanded={chatOpen}
        className="fixed bottom-24 right-4 z-40 inline-flex min-h-11 items-center gap-2 rounded-full bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground shadow-gold"
      >
        {chatOpen ? <X className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
        Meeting chat
      </button>
      {chatOpen && (
        <aside
          aria-label="Meeting chat"
          className="fixed inset-x-2 bottom-40 top-24 z-40 flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-background/95 shadow-xl backdrop-blur sm:inset-x-auto sm:right-4 sm:w-[400px]"
        >
          <div className="min-h-0 flex-1">
            <LobbyChat
              channelName={`meeting:${meeting.id}`}
              membersTitle="In this meeting"
              emptyText="Meeting chat. Messages here feed the minutes."
            />
          </div>
        </aside>
      )}
    </>
  );
}
