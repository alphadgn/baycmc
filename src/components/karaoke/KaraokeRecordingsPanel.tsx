import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Disc3, Eye, EyeOff, Loader2, Music, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteKaraokeRecording,
  listRoomKaraokeRecordings,
  setKaraokeRecordingVisibility,
  type RecordingListItem,
} from "@/lib/karaoke/recordings.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";

function fmtDuration(ms: number | null): string {
  if (!ms || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Replayable performances for a karaoke room. Every song a singer performs
 * while on air is recorded on their device (voice + backing track, exactly
 * what the room heard) and uploaded to the private karaoke-recordings
 * bucket; this list plays them back through short-lived signed URLs.
 */
export function KaraokeRecordingsPanel({
  roomId,
  isAdmin = false,
}: {
  roomId: string;
  isAdmin?: boolean;
}) {
  const { user } = useAuth();
  const listFn = useServerFn(listRoomKaraokeRecordings);
  const deleteFn = useServerFn(deleteKaraokeRecording);
  const visFn = useServerFn(setKaraokeRecordingVisibility);
  const [rows, setRows] = useState<RecordingListItem[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [mineOnly, setMineOnly] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await listFn({ data: { roomId, mine: mineOnly } });
      setRows(res);
      const ids = Array.from(new Set(res.map((r) => r.performer_id)));
      if (ids.length) {
        const { data } = await supabase.from("profiles").select("id,username").in("id", ids);
        const map: Record<string, string> = {};
        for (const id of ids) map[id] = `Member ${id.slice(0, 4)}`;
        for (const p of (data ?? []) as { id: string; username: string | null }[]) {
          if (p.username) map[p.id] = p.username;
        }
        setNames(map);
      }
    } catch (e) {
      setRows([]);
      console.warn("[recordings] load failed", e);
    }
  }, [listFn, roomId, mineOnly]);

  useEffect(() => {
    void load();
    const onChanged = () => void load();
    window.addEventListener("karaoke:recordings-changed", onChanged);
    // Signed URLs live for an hour; refresh well before that.
    const t = window.setInterval(() => void load(), 20 * 60_000);
    return () => {
      window.removeEventListener("karaoke:recordings-changed", onChanged);
      window.clearInterval(t);
    };
  }, [load]);

  async function remove(id: string) {
    const res = await deleteFn({ data: { id } });
    if (!res.ok) toast.error(res.error);
    else void load();
  }
  async function toggleVisibility(r: RecordingListItem) {
    const res = await visFn({
      data: { id: r.id, visibility: r.visibility === "private" ? "room" : "private" },
    });
    if (!res.ok) toast.error(res.error);
    else void load();
  }

  return (
    <section aria-label="Karaoke recordings" className="space-y-3">
      <header className="flex items-center gap-2">
        <Disc3 className="h-4 w-4 text-gold" />
        <h2 className="font-display text-sm uppercase tracking-[0.3em] text-gold">Takes</h2>
        <label className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={mineOnly}
            onChange={(e) => setMineOnly(e.target.checked)}
          />{" "}
          Mine only
        </label>
        {rows === null && <Loader2 className="h-3 w-3 animate-spin text-gold/60" />}
      </header>

      {rows !== null && rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          No recordings yet — every song performed on air is saved here automatically.
        </p>
      ) : (
        <ul className="space-y-2">
          {(rows ?? []).map((r) => {
            const own = r.performer_id === user?.id;
            return (
              <li key={r.id} className="space-y-2 rounded-lg border border-gold/15 bg-black/40 p-3">
                <div className="flex items-center gap-2">
                  <Music className="h-3.5 w-3.5 shrink-0 text-gold/70" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-foreground">
                      {r.song_title ?? "Untitled take"}
                      {r.song_artist ? (
                        <span className="ml-1 text-muted-foreground">· {r.song_artist}</span>
                      ) : null}
                    </p>
                    <p className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
                      {names[r.performer_id] ?? "Member"} · {fmtDuration(r.duration_ms)} ·{" "}
                      {new Date(r.created_at).toLocaleString()}
                      {r.visibility === "private" && " · private"}
                    </p>
                  </div>
                  {own && (
                    <button
                      type="button"
                      onClick={() => void toggleVisibility(r)}
                      title={r.visibility === "private" ? "Show to the room" : "Make private"}
                      className="rounded p-1 text-muted-foreground hover:text-foreground"
                    >
                      {r.visibility === "private" ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                  {(own || isAdmin) && (
                    <button
                      type="button"
                      onClick={() => void remove(r.id)}
                      aria-label="Delete take"
                      className="rounded p-1 text-rose-300/70 hover:text-rose-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {r.url ? (
                  <audio controls preload="none" src={r.url} className="h-8 w-full" />
                ) : (
                  <p className="text-[10px] text-muted-foreground">Audio unavailable</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
