import { useState } from "react";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import { acceptKaraokeWaiver, KARAOKE_WAIVER_VERSION } from "@/lib/karaoke/waiverStatus";

export { KARAOKE_WAIVER_VERSION };

/**
 * Performance waiver. Accepted once per account sign-in: the app only shows
 * it when the server says this account has no valid acceptance (first time
 * after signing in, after any sign-out, or when the wording changes).
 * Declining closes the machine; the member can stay in the room and listen.
 *
 * DRAFT wording — to be reviewed by the owner's legal adviser before it is
 * relied on. Whenever the wording changes, bump KARAOKE_WAIVER_VERSION
 * (src/lib/karaoke/waiverStatus.ts) AND add the same version to
 * public.karaoke_waiver_versions in a migration; members then accept again.
 */
export function KaraokeWaiverTerms() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-foreground/90">
      <p>Before you perform on the BAYCmc karaoke stage, please read and accept the following.</p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          <strong>Live performances.</strong> Your performance, including your voice, any video of
          you, your username and profile picture, is streamed live to everyone in the room.
        </li>
        <li>
          <strong>Saved performances: you choose.</strong> Your performance is only saved if you tap
          Save at the end. When you save, you choose <strong>Private</strong> (only you can play it;
          club admins can see it for moderation) or <strong>Public</strong> (anyone, including
          people without a BAYCmc account, can watch or listen through a share link and on your
          public performer page). You can change this later under Takes.
        </li>
        <li>
          <strong>Promotional use of public performances.</strong> For performances you save as
          Public, you grant BAYCmc, LLC a non-exclusive, worldwide, royalty-free, perpetual licence
          to use, reproduce, edit, publish and share them, in whole or in part, to promote BAYCmc,
          on any platform, without further notice or payment to you. Private performances are not
          used for promotion.
        </li>
        <li>
          <strong>Your content.</strong> You confirm you have the right to perform what you perform,
          and that your performance will not break the law or infringe anyone else&apos;s rights.
          You are responsible for what you say and do on stage.
        </li>
        <li>
          <strong>Removing performances.</strong> You can delete your own saved performances, or
          make them private, at any time from your profile or the room&apos;s Takes tab. Copies
          already used in promotion while a performance was public may remain in use.
        </li>
      </ol>
      <p className="text-xs text-muted-foreground">
        You accept this once per sign-in. Signing out (on any device) means you&apos;ll be asked
        again next time.
      </p>
    </div>
  );
}

export function KaraokeWaiverDialog({
  open,
  onAccept,
  onDecline,
}: {
  open: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  async function accept() {
    setBusy(true);
    const err = await acceptKaraokeWaiver();
    setBusy(false);
    if (err) {
      toast.error(err);
      return;
    }
    onAccept();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="karaoke-waiver-title"
      className="fixed inset-0 z-[80] flex items-end justify-center bg-background/80 p-3 backdrop-blur sm:items-center"
    >
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gold/40 bg-popover p-5 shadow-xl">
        <h2
          id="karaoke-waiver-title"
          className="flex items-center gap-2 font-display text-lg text-gradient-gold"
        >
          <ShieldCheck className="h-5 w-5 text-gold" /> Performance waiver
        </h2>
        <div className="mt-3 space-y-3">
          <KaraokeWaiverTerms />
          <p className="text-xs text-muted-foreground">
            If you decline, you can stay in the room and enjoy the show, but you can&apos;t get in
            line or take the stage.
          </p>
          <p className="text-sm font-bold text-foreground">
            Join the waitlist to use the Karaoke Machine
          </p>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onDecline}
            disabled={busy}
            className="min-h-11 rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => void accept()}
            disabled={busy}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-gold px-4 py-2 text-sm font-semibold text-gold-foreground disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} I accept
          </button>
        </div>
      </div>
    </div>
  );
}
