import { useEffect, useMemo, useState } from "react";
import { Globe2, Loader2, Lock, Mic2, ShieldCheck, Trash2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { KaraokeWaiverTerms } from "@/components/karaoke/KaraokeWaiverDialog";
import { useAuth } from "@/lib/auth/useAuth";
import {
  removePendingTake,
  restorePendingTakes,
  usePendingTakes,
} from "@/lib/karaoke/pendingTakes";
import {
  DEFAULT_TAKE_VISIBILITY,
  savePendingTake,
  WaiverRequiredError,
  type TakeVisibility,
} from "@/lib/karaoke/saveTake";
import { takeEndBanner, takeNoteText } from "@/lib/karaoke/takeLifecycle";
import { acceptKaraokeWaiver, useKaraokeWaiver } from "@/lib/karaoke/waiverStatus";

function fmt(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * "Save this performance?" — shown to the SINGER (only) at the end of every
 * performance, however it ended: Stop, End song, the track finishing, an
 * admin / host skip, a dropped connection or the time running out. Mounted
 * once at the app root so the question survives leaving the room, and the
 * take is kept on the device until answered (also across reloads).
 * Only the Save / Discard buttons close it. Takes are never uploaded without
 * a Save tap; the singer picks Private (default) or Public.
 */
export function KaraokeSaveTakeDialog() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const takes = usePendingTakes(userId);
  const take = takes[0] ?? null;
  useKaraokeWaiver(userId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<TakeVisibility>(DEFAULT_TAKE_VISIBILITY);
  const [step, setStep] = useState<"decide" | "waiver">("decide");

  useEffect(() => {
    if (!userId) return;
    void restorePendingTakes(userId);
    // A take cut off by a reload is only "abandoned" once its recorder has
    // been silent for a while — look again shortly after load.
    const t = window.setTimeout(() => void restorePendingTakes(userId), 20_000);
    return () => window.clearTimeout(t);
  }, [userId]);

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
    setStep("decide");
    setVisibility(DEFAULT_TAKE_VISIBILITY);
  }, [take?.id]);

  if (!take) return null;
  const banner = take.restored
    ? {
        tone: "info" as const,
        text: `You have an unsaved performance from ${new Date(take.createdAt).toLocaleString()}.`,
      }
    : takeEndBanner(take.reason);
  const note = takeNoteText(take.note);

  async function onSave() {
    if (!take) return;
    setSaving(true);
    setError(null);
    try {
      await savePendingTake(take, visibility);
      removePendingTake(take.id);
      toast.success("Performance saved", {
        description:
          visibility === "public"
            ? "It's public. Replay or share it any time under Takes."
            : "It's private. Replay it any time under Takes.",
      });
    } catch (e) {
      if (e instanceof WaiverRequiredError) {
        setStep("waiver");
        setSaving(false);
        return;
      }
      setError(e instanceof Error ? e.message : "Upload failed. Try again.");
      setSaving(false);
    }
  }

  async function onAcceptWaiver() {
    setSaving(true);
    setError(null);
    const err = await acceptKaraokeWaiver();
    if (err) {
      setError(err);
      setSaving(false);
      return;
    }
    setStep("decide");
    await onSave();
  }

  function onDiscard() {
    if (take && !saving) removePendingTake(take.id);
  }

  return (
    // Only the Save / Discard buttons decide — no close X, no tap-outside.
    // Phones: a bottom sheet; larger screens: a centred card.
    <Dialog open>
      <DialogContent
        className="bottom-3 top-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-sm translate-y-0 overflow-y-auto rounded-2xl border-gold/30 sm:bottom-auto sm:top-[50%] sm:translate-y-[-50%] [&>button.absolute]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {banner && (
          <p
            role="status"
            className={`rounded-md border px-3 py-2 text-xs font-semibold ${
              banner.tone === "warn"
                ? "border-rose-400/60 bg-rose-500/10 text-rose-200"
                : "border-sky-400/50 bg-sky-500/10 text-sky-100"
            }`}
          >
            {banner.text}
            {banner.tone === "warn" && (
              <span className="block font-normal">You can still keep what you sang so far.</span>
            )}
          </p>
        )}
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-gold">
            {step === "waiver" ? (
              <>
                <ShieldCheck className="h-4 w-4" /> Accept the waiver to save
              </>
            ) : (
              <>
                <Mic2 className="h-4 w-4" /> Save this performance?
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {take.title ?? "Your take"}
            {take.artist ? ` · ${take.artist}` : ""} · {fmt(take.durationMs)}
            {takes.length > 1 ? ` · ${takes.length - 1} more waiting` : ""}
          </DialogDescription>
        </DialogHeader>

        {step === "waiver" ? (
          <div className="max-h-[45dvh] overflow-y-auto rounded-md border border-gold/20 p-3">
            <KaraokeWaiverTerms />
          </div>
        ) : (
          <>
            {note && <p className="text-xs font-semibold text-amber-300">⚠ {note}</p>}
            {url && (
              <audio
                controls
                preload="metadata"
                src={url}
                className="w-full"
                aria-label="Preview take"
              >
                <track kind="captions" />
              </audio>
            )}
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-xs font-semibold text-foreground">
                Who can play it?
              </legend>
              <div className="grid grid-cols-2 gap-2" role="radiogroup">
                {(
                  [
                    ["private", "Private", "Only you", Lock],
                    ["public", "Public", "Anyone with the link", Globe2],
                  ] as const
                ).map(([v, label, hint, Icon]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={visibility === v}
                    disabled={saving}
                    onClick={() => setVisibility(v)}
                    className={`flex min-h-12 flex-col items-start rounded-md border px-3 py-2 text-left text-sm transition ${
                      visibility === v
                        ? "border-gold bg-gold/10 text-gold"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span className="flex items-center gap-1.5 font-semibold">
                      <Icon className="h-3.5 w-3.5" /> {label}
                    </span>
                    <span className="text-[11px]">{hint}</span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {visibility === "public"
                  ? "Public takes appear on your performer page and may be used to promote BAYCmc."
                  : "Private takes are only playable by you (club admins can see them for moderation)."}{" "}
                You can change this later under Takes. Discarded takes are gone for good.
              </p>
            </fieldset>
          </>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter className="flex-row gap-2 sm:justify-between">
          {step === "waiver" ? (
            <>
              <button
                type="button"
                onClick={() => setStep("decide")}
                disabled={saving}
                className="inline-flex min-h-12 flex-1 items-center justify-center rounded-md border border-border px-3 py-2 text-sm text-muted-foreground disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void onAcceptWaiver()}
                disabled={saving}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-md bg-gradient-gold px-3 py-2 text-sm font-semibold text-gold-foreground disabled:opacity-60"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} I accept &amp; save
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onDiscard}
                disabled={saving}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-md border border-destructive/50 px-3 py-2 text-sm font-semibold text-destructive transition hover:bg-destructive/10 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" /> Discard
              </button>
              <button
                type="button"
                onClick={() => void onSave()}
                disabled={saving}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-md bg-gradient-gold px-3 py-2 text-sm font-semibold text-gold-foreground transition hover:opacity-90 disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UploadCloud className="h-4 w-4" />
                )}
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
