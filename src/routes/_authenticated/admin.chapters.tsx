import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMemberDirectory } from "@/lib/members/memberSearch";
import {
  MEETING_COLUMNS,
  useChapterRooms,
  useLocalChapters,
  type ChapterMeeting,
} from "@/lib/chapters/chapters";
import { ChapterPage, MeetingCard } from "@/components/chapters/ChapterUi";

/**
 * Admin → Local chapter meetings. Approve or decline requests (approval is
 * refused if another approved meeting overlaps in that room), and see what's
 * scheduled.
 */
export const Route = createFileRoute("/_authenticated/admin/chapters")({
  head: () => ({ meta: [{ title: "Admin · Chapter Meetings — BAYCmc" }] }),
  component: AdminChapters,
});

type Filter = "pending" | "approved" | "past";

function AdminChapters() {
  const rooms = useChapterRooms();
  const chapters = useLocalChapters(true);
  const members = useMemberDirectory();
  const [filter, setFilter] = useState<Filter>("pending");
  const [rows, setRows] = useState<ChapterMeeting[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    const nowIso = new Date().toISOString();
    let q = supabase.from("chapter_meetings").select(MEETING_COLUMNS);
    if (filter === "pending") q = q.eq("status", "pending").order("starts_at");
    else if (filter === "approved")
      q = q.eq("status", "approved").gt("ends_at", nowIso).order("starts_at");
    else
      q = q
        .in("status", ["declined", "cancelled", "ended"])
        .order("starts_at", { ascending: false })
        .limit(50);
    const { data } = await q;
    setRows((data ?? []) as ChapterMeeting[]);
  }, [filter]);
  useEffect(() => {
    void load();
  }, [load]);

  async function review(m: ChapterMeeting, approve: boolean) {
    setBusy(m.id);
    const { error } = await supabase.rpc("chapter_review_meeting", {
      _meeting: m.id,
      _approve: approve,
      _note: notes[m.id]?.trim() || null,
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success(approve ? "Approved. The leader has been notified." : "Declined.");
    void load();
  }

  async function cancel(m: ChapterMeeting) {
    if (!window.confirm("Cancel this approved meeting?")) return;
    setBusy(m.id);
    const { error } = await supabase.rpc("chapter_cancel_meeting", { _meeting: m.id });
    setBusy(null);
    if (error) return toast.error(error.message);
    void load();
  }

  const name = (id: string) => members.find((x) => x.id === id)?.username;

  return (
    <ChapterPage
      eyebrow="Administrator"
      title="Local chapter meetings"
      subtitle="Approve or decline meeting requests. Approval is refused if it overlaps another approved meeting in the same room."
    >
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {(
          [
            ["pending", "Requests"],
            ["approved", "Scheduled"],
            ["past", "Past & declined"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`min-h-10 rounded-md px-3 py-2 ${
              filter === k
                ? "bg-gradient-gold text-gold-foreground shadow-gold"
                : "border border-border hover:bg-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {rows === null ? (
          <div className="h-24 animate-pulse rounded-2xl bg-muted/20" />
        ) : rows.length === 0 ? (
          <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">
            Nothing here.
          </div>
        ) : (
          rows.map((m) => (
            <MeetingCard
              key={m.id}
              meeting={m}
              room={rooms?.find((r) => r.id === m.room_id)}
              chapterName={chapters?.find((c) => c.id === m.chapter_id)?.name}
              leaderName={name(m.requester_id)}
              canEnter
            >
              <p className="mt-2 text-[11px] text-muted-foreground">
                Leader holds: {m.leader_labels.join(", ") || "—"}
              </p>
              {m.status === "pending" && (
                <div className="mt-3 flex flex-col gap-2 border-t border-border/50 pt-3 sm:flex-row sm:items-center">
                  <input
                    className="min-h-10 flex-1 rounded-md border border-border bg-input px-3 py-2 text-sm"
                    placeholder="Note to the leader (optional)"
                    maxLength={500}
                    value={notes[m.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [m.id]: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy === m.id}
                      onClick={() => void review(m, true)}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-md bg-gradient-gold px-3 py-2 text-xs font-semibold text-gold-foreground"
                    >
                      {busy === m.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy === m.id}
                      onClick={() => void review(m, false)}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" /> Decline
                    </button>
                  </div>
                </div>
              )}
              {m.status === "approved" && new Date(m.starts_at).getTime() > Date.now() && (
                <button
                  type="button"
                  disabled={busy === m.id}
                  onClick={() => void cancel(m)}
                  className="mt-3 inline-flex min-h-10 items-center rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-destructive"
                >
                  Cancel meeting
                </button>
              )}
            </MeetingCard>
          ))
        )}
      </div>
    </ChapterPage>
  );
}
