import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { useVerificationStatus } from "@/lib/baycmc/useVerificationStatus";
import { LobbyChat } from "@/components/LobbyChat";
import { LobbyOnlineAvatars } from "@/components/LobbyOnlineAvatars";

// Lazy, optional asset import — Vite resolves the file at build time only if
// it exists, so the lobby falls back to a gold gradient until the operator
// drops a real image at src/assets/lobby/lobby.{jpg,png,webp}.
const LOBBY_IMAGE_MODULES = import.meta.glob<{ default: string }>(
  "@/assets/lobby/lobby.{jpg,png,webp,jpeg}",
  { eager: true },
);
const LOBBY_IMAGE: string | null = Object.values(LOBBY_IMAGE_MODULES)[0]?.default ?? null;

/**
 * Tier 1 — Lobby landing.
 *
 * Every signed-in user lands here regardless of verification status. The
 * page renders a hero strip (room-style ambience image + welcome copy) on
 * top, with the continuous lobby chat thread below. Unverified users get a
 * verify CTA overlaid on the hero so the gating remains obvious.
 */
export const Route = createFileRoute("/_authenticated/lobby")({
  head: () => ({
    meta: [
      { title: "Lobby — BAYCMC" },
      {
        name: "description",
        content:
          "The BAYCMC lobby — open chat for every member. Verify your BAYC or MAYC to unlock conference rooms and the rest of the clubhouse.",
      },
    ],
  }),
  component: LobbyPage,
});

function triggerVerify() {
  window.dispatchEvent(new Event("baycmc:privy-bridge-retry"));
  toast.message("Re-checking BAYC/MAYC ownership…", {
    description:
      "Approve the signature in your wallet — we'll unlock the verified areas the moment it confirms.",
    duration: 5000,
  });
}

function LobbyPage() {
  const { isVerifiedHolder, loading: verifLoading } = useVerificationStatus();
  const showVerifyCta = !verifLoading && !isVerifiedHolder;

  // Lock body scroll while the lobby is mounted so the page can't scroll
  // behind the hero — only the chat thread's own scroll container moves.
  useEffect(() => {
    const prevHtml = document.documentElement.style.overflow;
    const prevBody = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
    };
  }, []);

  return (
    <main className="relative flex h-[calc(100dvh-4rem)] flex-col overflow-hidden">
      {/* Faded full-page backdrop using the same lobby image. Matches the
          treatment conference rooms get via RoomsShell. */}
      {LOBBY_IMAGE && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <img
            src={LOBBY_IMAGE}
            alt=""
            aria-hidden
            className="h-full w-full object-cover opacity-10"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/70 to-background/95" />
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Slim presence strip directly under the nav bar — the old hero
            (image + "Lobby" title + blurb) is gone so the chat sits flush
            against the top. We keep just the live online-members row and,
            for unverified users, the verify CTA. */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6">
          <LobbyOnlineAvatars />
          {showVerifyCta && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-gold/30 bg-background/70 px-3 py-1.5 text-xs backdrop-blur">
              <span className="flex items-center gap-2 text-gold">
                <Lock className="h-3.5 w-3.5" />
                Verify your BAYC/MAYC to unlock the clubhouse.
              </span>
              <button
                type="button"
                onClick={triggerVerify}
                className="inline-flex items-center gap-1.5 rounded-md bg-gradient-gold px-3 py-1 text-[11px] font-semibold text-gold-foreground shadow-gold transition hover:opacity-90"
              >
                Verify holder
              </button>
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <LobbyChat channelName="lobby" />
        </div>
      </div>
    </main>
  );
}
