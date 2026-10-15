import { useEffect, useMemo, useState } from "react";
import { Loader2, Mic2, Trash2, UploadCloud } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { removePendingTake, usePendingTakes } from "@/lib/karaoke/pendingTakes";

function fmt(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * "Save this performance?" — shown to the singer at the end of every
 * performance. Mounted once at the app root so the question survives the
 * singer leaving the room. Takes are never uploaded without a Save tap.
 */
export function KaraokeSaveTakeDialog() {
  const takes = usePendingTakes();
  const take = takes[0] ?? null;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = useMemo(() => (take ? URL.createObjectURL(take.blob) : null), [take]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  useEffect(() => {
    setSaving(false);
    setError(null);
  }, [take?.id]);

  if (!take) return null;

  async function onSave() {
    if (!take) return;
    setSaving(true);
    setError(null);
    try {
      await take.save();
      removePendingTake(take.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed — try again.");
      setSaving(false);
    }
  }

  function onDiscard() {
    if (take && !saving) removePendingTake(take.id);
  }

  return (
    // Only the Save / Discard buttons decide — no close X, no tap-outside.
    <Dialog open>
      <DialogContent
        className="max-w-sm border-gold/30 [&>button.absolute]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-gold">
            <Mic2 className="h-4 w-4" /> Save this performance?
          </DialogTitle>
          <DialogDescription>
            {take.title ?? "Your take"}
            {take.artist ? ` · ${take.artist}` : ""} · {fmt(take.durationMs)}
            {takes.length > 1 ? ` · ${takes.length - 1} more waiting` : ""}
          </DialogDescription>
        </DialogHeader>

        {url && (
          <audio controls preload="metadata" src={url} className="w-full" aria-label="Preview take">
            <track kind="captions" />
          </audio>
        )}
        <p className="text-[11px] text-muted-foreground">
          Saved takes appear under Takes in the room hub, where you can replay, share or delete
          them. Discarded takes are gone for good.
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter className="flex-row gap-2 sm:justify-between">
          <button
            type="button"
            onClick={onDiscard}
            disabled={saving}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-destructive/50 px-3 py-2 text-sm font-semibold text-destructive transition hover:bg-destructive/10 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" /> Discard
          </button>
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={saving}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-gradient-gold px-3 py-2 text-sm font-semibold text-gold-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UploadCloud className="h-4 w-4" />
            )}
            {saving ? "Saving…" : "Save"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
