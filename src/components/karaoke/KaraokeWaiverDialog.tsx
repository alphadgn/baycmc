import { useState } from "react";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Performance waiver, shown every time the Karaoke Machine is opened.
 * Accepting records the acceptance (the server requires one in the last
 * 12 hours to get in line or take the stage). Declining closes the machine;
 * the member can stay in the room and listen.
 *
 * DRAFT wording — to be reviewed by the owner's legal adviser before it is
 * relied on. Bump KARAOKE_WAIVER_VERSION whenever the wording changes.
 */
export const KARAOKE_WAIVER_VERSION = "2026-10-28-draft-1";

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
    const { error } = await supabase.rpc("accept_karaoke_waiver", {
      _version: KARAOKE_WAIVER_VERSION,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
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
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-foreground/90">
          <p>
            Before you perform on the BAYCmc karaoke stage, please read and accept the following.
          </p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              <strong>Public performances.</strong> Your performance, including your voice, any
              video of you, your username and profile picture, may be streamed live to the room and
              saved. Saved performances are public: anyone, including people without a BAYCmc
              account, can watch or listen through a share link and on your public performer page.
            </li>
            <li>
              <strong>Promotional use.</strong> You grant BAYCmc, LLC a non-exclusive, worldwide,
              royalty-free, perpetual licence to use, reproduce, edit, publish and share your saved
              performances, in whole or in part, to promote BAYCmc, on any platform, without further
              notice or payment to you.
            </li>
            <li>
              <strong>Your content.</strong> You confirm you have the right to perform what you
              perform, and that your performance will not break the law or infringe anyone else's
              rights. You are responsible for what you say and do on stage.
            </li>
            <li>
              <strong>Removing performances.</strong> You can delete your own saved performances at
              any time from your profile or the room's Takes tab. Copies already used in promotion
              before you deleted them may remain in use.
            </li>
          </ol>
          <p className="text-xs text-muted-foreground">
            If you decline, you can stay in the room and enjoy the show, but you can't get in line
            or take the stage.
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
