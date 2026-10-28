import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2, Share2, Trash2 } from "lucide-react";
import { closeChapterMinutes, getChapterMinutes } from "@/server/chapter-minutes.functions";
import { formatMeetingTime } from "@/lib/chapters/chapters";
import { ChapterPage } from "@/components/chapters/ChapterUi";

/**
 * Minutes for an ended chapter meeting — host only. An AI-written summary of
 * the meeting chat plus attendance. Export (share or save) or dismiss; either
 * way the meeting, its chat and every reference to it are then deleted.
 */
export const Route = createFileRoute("/_authenticated/chapters/minutes/$meetingId")({
  head: () => ({ meta: [{ title: "Meeting Minutes — BAYCmc" }] }),
  component: MinutesPage,
});

type Minutes = Extract<Awaited<ReturnType<typeof getChapterMinutes>>, { ok: true }>;

function minutesText(m: Minutes): string {
  const t = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return [
    `BAYCmc · ${m.chapter} — meeting minutes`,
    `${m.room} · ${formatMeetingTime(m.startsAt, m.endsAt)}`,
    "",
    m.summary,
    "",
    `Attendance (${m.attendance.length} joined)`,
    ...(m.attendance.length
      ? m.attendance.map((a) => `- @${a.username} (${t(a.firstJoinedAt)} – ${t(a.lastSeenAt)})`)
      : ["- Nobody joined the room."]),
    "",
    `On the list: ${m.invited.map((n) => `@${n}`).join(", ")}`,
  ].join("\n");
}

function MinutesPage() {
  const { meetingId } = Route.useParams();
  const navigate = useNavigate();
  const load = useServerFn(getChapterMinutes);
  const close = useServerFn(closeChapterMinutes);
  const [res, setRes] = useState<Awaited<ReturnType<typeof getChapterMinutes>> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load({ data: { meetingId } }).then(setRes, (e: unknown) =>
      setRes({ ok: false, error: e instanceof Error ? e.message : "Couldn't load the minutes." }),
    );
  }, [load, meetingId]);

  async function finish(message: string) {
    setBusy(true);
    const r = await close({ data: { meetingId } });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(message);
    void navigate({ to: "/chapters/book" });
  }

  async function exportMinutes(m: Minutes) {
    const text = minutesText(m);
    const fileName = `${m.chapter.replace(/[^\w]+/g, "-")}-minutes-${m.startsAt.slice(0, 10)}.txt`;
    const file = new File([text], fileName, { type: "text/plain" });
    let shared = false;
    try {
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: `${m.chapter} minutes` });
        shared = true;
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // cancelled the sheet
    }
    if (!shared) {
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
    await finish("Minutes exported. The meeting has been deleted from BAYCmc.");
  }

  return (
    <ChapterPage
      eyebrow="Local Chapters · Minutes"
      title={res?.ok ? `${res.chapter} — minutes` : "Meeting minutes"}
      subtitle={
        res?.ok
          ? `${res.room} · ${formatMeetingTime(res.startsAt, res.endsAt)}`
          : "Only the member who booked the meeting sees its minutes."
      }
    >
      {res === null ? (
        <div className="glass flex items-center justify-center gap-2 rounded-2xl p-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Writing the minutes…
        </div>
      ) : !res.ok ? (
        <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">
          {res.error}
        </div>
      ) : (
        <div className="space-y-4">
          <section className="glass rounded-2xl p-4 shadow-card sm:p-5">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">
              Summary (AI-written from {res.messageCount} chat messages)
            </h2>
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{res.summary}</div>
          </section>
          <section className="glass rounded-2xl p-4 shadow-card sm:p-5">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">
              Attendance
            </h2>
            {res.attendance.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nobody joined the room.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {res.attendance.map((a) => (
                  <li key={a.username + a.firstJoinedAt}>
                    @{a.username}{" "}
                    <span className="text-xs text-muted-foreground">
                      {new Date(a.firstJoinedAt).toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}{" "}
                      –{" "}
                      {new Date(a.lastSeenAt).toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              On the list: {res.invited.map((n) => `@${n}`).join(", ")}
            </p>
          </section>
          <p className="text-xs text-muted-foreground">
            After you export or dismiss, the meeting, its chat and these minutes are deleted from
            BAYCmc. If you do neither, they're deleted 7 days after the meeting.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={busy}
              onClick={() => void exportMinutes(res)}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground shadow-gold disabled:opacity-60"
            >
              {"share" in navigator ? (
                <Share2 className="h-4 w-4" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Export (share or save)
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Dismiss and delete the meeting, its chat and the minutes?"))
                  void finish("Meeting deleted.");
              }}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-destructive"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Dismiss
            </button>
          </div>
        </div>
      )}
    </ChapterPage>
  );
}
