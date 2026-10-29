import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { useMemberDirectory } from "@/lib/members/memberSearch";
import {
  MEETING_COLUMNS,
  useChapterRooms,
  useChapterViewer,
  useLocalChapters,
  type ChapterMeeting,
} from "@/lib/chapters/chapters";
import { ChapterGateNotice, ChapterPage, MeetingCard } from "@/components/chapters/ChapterUi";

/**
 * A local chapter: its upcoming approved meetings, the member's own requests
 * for it, and a button to request a meeting (sent to the admins).
 */
export const Route = createFileRoute("/_authenticated/chapters/$chapterId")({
  head: () => ({ meta: [{ title: "Local Chapter — BAYCmc" }] }),
  component: ChapterDetail,
});

function ChapterDetail() {
  const { chapterId } = Route.useParams();
  const { user } = useAuth();
  const viewer = useChapterViewer();
  const chapters = useLocalChapters();
  const rooms = useChapterRooms();
  const members = useMemberDirectory();
  const [meetings, setMeetings] = useState<ChapterMeeting[] | null>(null);
  const [attending, setAttending] = useState<Set<string>>(new Set());

  const chapter = chapters?.find((c) => c.id === chapterId);

  useEffect(() => {
    if (!viewer || !user) return;
    let cancelled = false;
    const load = async () => {
      const [{ data }, { data: mine }] = await Promise.all([
        supabase
          .from("chapter_meetings")
          .select(MEETING_COLUMNS)
          .eq("chapter_id", chapterId)
          .in("status", ["approved", "pending"])
          .gt("ends_at", new Date().toISOString())
          .order("starts_at"),
        supabase.from("chapter_meeting_attendees").select("meeting_id").eq("user_id", user.id),
      ]);
      if (cancelled) return;
      setMeetings((data ?? []) as ChapterMeeting[]);
      setAttending(new Set((mine ?? []).map((r) => r.meeting_id)));
    };
    void load();
    const t = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [viewer, user, chapterId]);

  const nameOf = useMemo(() => {
    const map = new Map(members.map((m) => [m.id, m.username]));
    return (id: string) => map.get(id) ?? undefined;
  }, [members]);

  const upcoming = (meetings ?? []).filter((m) => m.status === "approved");
  const myPending = (meetings ?? []).filter(
    (m) => m.status === "pending" && m.requester_id === user?.id,
  );

  return (
    <ChapterPage
      title={chapter?.name ?? "Local Chapter"}
      subtitle={
        <>
          {chapter?.region && <span className="block text-foreground/80">{chapter.region}</span>}
          {chapter?.x_url && (
            <a
              href={chapter.x_url}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-gold hover:underline"
            >
              Follow {chapter.name} on X ↗
            </a>
          )}
          <span className="block">
            Upcoming meetings for this chapter. Meetings are approved by the admins.
          </span>
        </>
      }
      actions={
        viewer ? (
          <Link
            to="/chapters/book"
            search={{ chapter: chapterId }}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground shadow-gold"
          >
            <CalendarPlus className="h-4 w-4" /> Request a meeting
          </Link>
        ) : undefined
      }
    >
      {!viewer ? (
        <ChapterGateNotice viewer={viewer} />
      ) : chapters && !chapter ? (
        <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">
          This chapter isn't on the list any more.
        </div>
      ) : (
        <div className="space-y-6">
          {myPending.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">
                Your requests
              </h2>
              {myPending.map((m) => (
                <MeetingCard key={m.id} meeting={m} room={rooms?.find((r) => r.id === m.room_id)} />
              ))}
            </section>
          )}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">
              Upcoming meetings
            </h2>
            {meetings === null ? (
              <div className="h-24 animate-pulse rounded-2xl bg-muted/20" />
            ) : upcoming.length === 0 ? (
              <div className="glass rounded-2xl p-6 text-center text-sm text-muted-foreground">
                No meetings scheduled yet. Be the first to request one.
              </div>
            ) : (
              upcoming.map((m) => (
                <MeetingCard
                  key={m.id}
                  meeting={m}
                  room={rooms?.find((r) => r.id === m.room_id)}
                  leaderName={nameOf(m.requester_id)}
                  canEnter={m.requester_id === user?.id || attending.has(m.id)}
                >
                  {m.requester_id !== user?.id && !attending.has(m.id) && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Want to join? Ask @{nameOf(m.requester_id) ?? "the leader"} to add you to the
                      list.
                    </p>
                  )}
                </MeetingCard>
              ))
            )}
          </section>
        </div>
      )}
    </ChapterPage>
  );
}
