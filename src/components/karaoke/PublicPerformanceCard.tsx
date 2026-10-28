import { Link } from "@tanstack/react-router";
import { Music, Share2 } from "lucide-react";
import { toast } from "sonner";
import type { PublicPerformance } from "@/server/public-performances.functions";

function fmt(ms: number | null) {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export async function sharePerformance(id: string, title?: string | null) {
  const url = `${window.location.origin}/performance/${id}`;
  try {
    if (navigator.share) await navigator.share({ title: title ?? "BAYCmc karaoke", url });
    else {
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied.");
    }
  } catch {
    /* dismissed */
  }
}

/** One public karaoke performance with a player and a share button. */
export function PublicPerformanceCard({
  p,
  showPerformer = true,
  actions,
}: {
  p: PublicPerformance;
  showPerformer?: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <article className="space-y-2 rounded-xl border border-gold/20 bg-card/50 p-3">
      <div className="flex items-start gap-2">
        <Music className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {p.songTitle ?? "Karaoke performance"}
            {p.songArtist && <span className="ml-1 text-muted-foreground">· {p.songArtist}</span>}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {showPerformer && (
              <>
                <Link
                  to="/performer/$userId"
                  params={{ userId: p.performerId }}
                  className="text-gold hover:underline"
                >
                  {p.performerName}
                </Link>{" "}
                ·{" "}
              </>
            )}
            {new Date(p.createdAt).toLocaleDateString()}{" "}
            {fmt(p.durationMs) && `· ${fmt(p.durationMs)}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void sharePerformance(p.id, p.songTitle)}
          aria-label="Share this performance"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"
        >
          <Share2 className="h-4 w-4" />
        </button>
        {actions}
      </div>
      {p.url ? (
        <audio controls preload="none" src={p.url} className="h-9 w-full" />
      ) : (
        <p className="text-xs text-muted-foreground">Audio unavailable right now.</p>
      )}
    </article>
  );
}
