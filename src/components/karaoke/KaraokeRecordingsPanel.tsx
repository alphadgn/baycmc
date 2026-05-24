import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Disc3, Loader2, Music } from "lucide-react";
import { listRoomKaraokeRecordings } from "@/lib/karaoke/recordings.functions";
import { supabase } from "@/integrations/supabase/client";

interface RecordingRow {
  id: string;
  song_title: string | null;
  song_artist: string | null;
  public_url: string;
  duration_ms: number | null;
  performer_id: string;
  created_at: string;
}

interface KaraokeRecordingsPanelProps {
  roomId: string;
}

function fmtDuration(ms: number | null): string {
  if (!ms || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/**
 * Recording playback panel for a karaoke room — lists the most recent
 * takes saved to the karaoke-recordings bucket and lets anyone signed in
 * replay them inline.
 */
export function KaraokeRecordingsPanel({ roomId }: KaraokeRecordingsPanelProps) {
  const listFn = useServerFn(listRoomKaraokeRecordings);
  const [rows, setRows] = useState<RecordingRow[] | null>(null);
  const [performers, setPerformers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = (await listFn({ data: { roomId } })) as RecordingRow[];
        if (cancelled) return;
        setRows(res);
        const ids = Array.from(new Set(res.map((r) => r.performer_id)));
        if (ids.length) {
          const { data } = await supabase
            .from("profiles")
            .select("id,username")
            .in("id", ids);
          if (!cancelled && data) {
            const map: Record<string, string> = {};
            for (const p of data as { id: string; username: string | null }[]) {
              map[p.id] = p.username ?? "anon";
            }
            setPerformers(map);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const interval = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [roomId, listFn]);

  return (
    <section
      aria-label="Karaoke recordings"
      className="mx-auto mt-6 w-full max-w-4xl rounded-2xl border border-gold/30 bg-background/80 p-4 shadow-gold backdrop-blur"
    >
      <header className="mb-3 flex items-center gap-2">
        <Disc3 className="h-4 w-4 text-gold" />
        <h2 className="font-display text-sm uppercase tracking-[0.3em] text-gold">
          Recent Takes
        </h2>
        {loading && <Loader2 className="ml-auto h-3 w-3 animate-spin text-gold/60" />}
      </header>

      {!loading && (!rows || rows.length === 0) ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          No recordings yet — the next singer's take will show up here.
        </p>
      ) : (
        <ul className="space-y-2">
          {(rows ?? []).map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-2 rounded-lg border border-gold/15 bg-black/40 p-3 sm:flex-row sm:items-center sm:gap-3"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Music className="h-3.5 w-3.5 shrink-0 text-gold/70" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-foreground">
                    {r.song_title ?? "Untitled take"}
                    {r.song_artist ? (
                      <span className="ml-1 text-muted-foreground">
                        · {r.song_artist}
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
                    {performers[r.performer_id] ?? "anon"} ·{" "}
                    {fmtDuration(r.duration_ms)} ·{" "}
                    {new Date(r.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <audio
                controls
                preload="none"
                src={r.public_url}
                className="h-8 w-full sm:w-64"
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
