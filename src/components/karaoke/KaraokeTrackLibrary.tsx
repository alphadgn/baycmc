/**
 * Backing-track library: upload instrumentals (MP3 / M4A / WAV / OGG / WebM)
 * and pick one to sing over.
 *
 * Why uploads: YouTube audio cannot be captured on phones (no tab-audio
 * capture in mobile browsers), so phone singers previously sang over
 * silence. An uploaded track is decoded on the singer's device and mixed
 * with their voice into one LiveKit stream — the room hears real music in
 * sync, and the take is recorded with the music in it.
 *
 * Files live in the private `karaoke-backing-tracks` bucket under
 * `<user_id>/…`. Tracks are private by default; "Share with the club" makes
 * them usable by other singers.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Globe2, Loader2, Lock, Play, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { unlockKaraokeAudio } from "@/lib/karaoke/audioMixBus";

export interface BackingTrackRow {
  id: string;
  title: string;
  artist: string | null;
  is_public: boolean;
  owner_id: string;
  duration_ms: number | null;
  storage_path: string;
}

const MAX_BYTES = 30 * 1024 * 1024;
const ACCEPT =
  "audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/x-wav,audio/ogg,audio/webm,.mp3,.m4a,.aac,.wav,.ogg,.webm";

function fmt(ms: number | null) {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    a.preload = "metadata";
    const done = (v: number | null) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    a.onloadedmetadata = () =>
      done(Number.isFinite(a.duration) ? Math.round(a.duration * 1000) : null);
    a.onerror = () => done(null);
    a.src = url;
  });
}

export function KaraokeTrackLibrary({
  canPlay,
  onPlay,
  onPick,
  compact = false,
}: {
  /** True when the viewer is on stage (Play buttons enabled). */
  canPlay?: boolean;
  onPlay?: (t: BackingTrackRow) => void;
  /** Picker mode (booking form): select instead of play. */
  onPick?: (t: BackingTrackRow) => void;
  compact?: boolean;
}) {
  const { user } = useAuth();
  const [tracks, setTracks] = useState<BackingTrackRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [share, setShare] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("karaoke_backing_tracks")
      .select("id,title,artist,is_public,owner_id,duration_ms,storage_path")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      setTracks([]);
      return;
    }
    setTracks((data ?? []) as BackingTrackRow[]);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function upload() {
    if (!user || !file) return;
    if (file.size > MAX_BYTES) {
      toast.error("That file is over 30 MB.");
      return;
    }
    if (file.type && !file.type.startsWith("audio/")) {
      toast.error("Please choose an audio file (MP3, M4A, WAV, OGG).");
      return;
    }
    setBusy(true);
    const ext = (file.name.split(".").pop() || "mp3")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 5);
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
    try {
      const durationMs = await readDuration(file);
      const contentType =
        file.type || (ext === "m4a" ? "audio/mp4" : `audio/${ext === "mp3" ? "mpeg" : ext}`);
      const up = await supabase.storage
        .from("karaoke-backing-tracks")
        .upload(path, file, { contentType, upsert: false });
      if (up.error) throw new Error(up.error.message);
      const { error } = await supabase.from("karaoke_backing_tracks").insert({
        owner_id: user.id,
        title: (title.trim() || file.name.replace(/\.[^.]+$/, "")).slice(0, 200),
        artist: artist.trim() || null,
        lyrics: lyrics.trim() || null,
        storage_path: path,
        mime_type: contentType,
        size_bytes: file.size,
        duration_ms: durationMs,
        is_public: share,
      });
      if (error) {
        await supabase.storage.from("karaoke-backing-tracks").remove([path]);
        throw new Error(error.message);
      }
      toast.success("Backing track uploaded");
      setTitle("");
      setArtist("");
      setLyrics("");
      setShare(false);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (e) {
      toast.error("Upload failed", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: BackingTrackRow) {
    const { error } = await supabase.from("karaoke_backing_tracks").delete().eq("id", t.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase.storage.from("karaoke-backing-tracks").remove([t.storage_path]);
    await load();
  }

  async function toggleShare(t: BackingTrackRow) {
    const { error } = await supabase
      .from("karaoke_backing_tracks")
      .update({ is_public: !t.is_public })
      .eq("id", t.id);
    if (error) toast.error(error.message);
    else await load();
  }

  const mine = (tracks ?? []).filter((t) => t.owner_id === user?.id);
  const shared = (tracks ?? []).filter((t) => t.owner_id !== user?.id);
  const textSize = compact ? "text-[9px]" : "text-xs";

  function Row({ t }: { t: BackingTrackRow }) {
    const own = t.owner_id === user?.id;
    return (
      <li
        className={`flex items-center gap-1.5 rounded-sm px-1.5 py-1 ${textSize} hover:bg-gold/5`}
      >
        <div className="min-w-0 flex-1 truncate text-gold/90">
          <span className="font-semibold">{t.title}</span>
          {t.artist && <span className="text-gold/60"> · {t.artist}</span>}
          {t.duration_ms ? <span className="ml-1 text-gold/40">{fmt(t.duration_ms)}</span> : null}
        </div>
        {own && (
          <button
            type="button"
            onClick={() => void toggleShare(t)}
            title={
              t.is_public
                ? "Shared with the club — click to make private"
                : "Private — click to share with the club"
            }
            className="rounded-sm p-0.5 text-gold/60 hover:text-gold"
          >
            {t.is_public ? <Globe2 className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
          </button>
        )}
        {own && !onPick && (
          <button
            type="button"
            onClick={() => void remove(t)}
            aria-label="Delete track"
            className="rounded-sm p-0.5 text-rose-300/70 hover:text-rose-300"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
        {onPick ? (
          <button
            type="button"
            onClick={() => onPick(t)}
            className="rounded-sm border border-gold/40 bg-gold/10 px-1.5 py-0.5 font-semibold text-gold hover:bg-gold/20"
          >
            Choose
          </button>
        ) : (
          <button
            type="button"
            disabled={!canPlay}
            onClick={() => {
              unlockKaraokeAudio(); // must run inside the tap (iOS autoplay rules)
              onPlay?.(t);
            }}
            title={canPlay ? "Sing this now" : "Wait for your turn on stage"}
            className="inline-flex items-center gap-0.5 rounded-sm bg-gradient-gold px-1.5 py-0.5 font-semibold text-gold-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Play className="h-2.5 w-2.5" /> Sing
          </button>
        )}
      </li>
    );
  }

  return (
    <div className="space-y-2">
      {!onPick && (
        <div className={`space-y-1 rounded-sm border border-gold/20 bg-black/40 p-1.5 ${textSize}`}>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-gold/80 file:mr-2 file:rounded-sm file:border-0 file:bg-gold/20 file:px-2 file:py-0.5 file:text-gold"
          />
          {file && (
            <>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Song title"
                maxLength={200}
                className="w-full rounded-sm border border-gold/20 bg-black/60 px-1.5 py-1 text-gold outline-none"
              />
              <input
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="Artist (optional)"
                maxLength={200}
                className="w-full rounded-sm border border-gold/20 bg-black/60 px-1.5 py-1 text-gold outline-none"
              />
              <textarea
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                placeholder="Lyrics (optional — shown on screen while you sing)"
                rows={3}
                maxLength={20000}
                className="w-full rounded-sm border border-gold/20 bg-black/60 px-1.5 py-1 text-gold outline-none"
              />
              <label className="flex items-center gap-1 text-gold/80">
                <input
                  type="checkbox"
                  checked={share}
                  onChange={(e) => setShare(e.target.checked)}
                />
                Share with the club
              </label>
            </>
          )}
          <button
            type="button"
            disabled={!file || busy}
            onClick={() => void upload()}
            className="inline-flex w-full items-center justify-center gap-1 rounded-sm bg-gradient-gold px-2 py-1 font-semibold text-gold-foreground disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            Upload backing track
          </button>
          <p className="text-[8px] leading-snug text-gold/40">
            Instrumental / karaoke versions only, max 30 MB. Upload only music you have the right to
            use.
          </p>
        </div>
      )}

      {tracks === null ? (
        <div className="flex justify-center p-2">
          <Loader2 className="h-3 w-3 animate-spin text-gold/60" />
        </div>
      ) : (
        <>
          <div>
            <div className="px-1 pb-0.5 text-[8px] uppercase tracking-widest text-gold/50">
              My tracks
            </div>
            {mine.length === 0 ? (
              <p className={`px-1 ${textSize} text-gold/40`}>No uploads yet.</p>
            ) : (
              <ul className="max-h-40 overflow-y-auto">
                {mine.map((t) => (
                  <Row key={t.id} t={t} />
                ))}
              </ul>
            )}
          </div>
          {shared.length > 0 && (
            <div>
              <div className="px-1 pb-0.5 text-[8px] uppercase tracking-widest text-gold/50">
                Shared by members
              </div>
              <ul className="max-h-40 overflow-y-auto">
                {shared.map((t) => (
                  <Row key={t.id} t={t} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
