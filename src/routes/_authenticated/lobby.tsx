import { createFileRoute } from "@tanstack/react-router";
import { useLockedPageScroll } from "@/hooks/useLockedPageScroll";
import { LobbyChat } from "@/components/LobbyChat";
import { LobbyAttendeeHero } from "@/components/LobbyAttendeeHero";

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
      { title: "Lobby — BAYCmc" },
      {
        name: "description",
        content:
          "The BAYCmc lobby — open chat for every member. Verify your BAYC or MAYC to unlock conference rooms and the rest of the clubhouse.",
      },
    ],
  }),
  component: LobbyPage,
});

function LobbyPage() {
  // Lock the page so only the chat thread scrolls, and snap it back to the
  // top after the phone keyboard closes so the top bar is never lost.
  useLockedPageScroll();

  return (
    <main className="h-below-header relative flex flex-col overflow-hidden">
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
        <LobbyAttendeeHero />
        <div className="flex min-h-0 flex-1 flex-col">
          <LobbyChat channelName="lobby" />
        </div>
      </div>
    </main>
  );
}
