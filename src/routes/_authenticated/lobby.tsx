import { createFileRoute } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { useVerificationStatus } from "@/lib/baycmc/useVerificationStatus";
import { LobbyChat } from "@/components/LobbyChat";

/**
 * Tier 1 — Lobby landing.
 *
 * Every signed-in user lands here regardless of verification status. The
 * lobby is a Discord-style continuous message thread; the members list now
 * lives inside the chat's own header (drawer), not as a sidebar — so the
 * composer stays pinned to the bottom on mobile.
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

  return (
    <main className="flex h-[calc(100dvh-4rem)] flex-col">
      {!verifLoading && !isVerifiedHolder && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gold/20 bg-gold/5 px-3 py-2 text-xs sm:px-4">
          <span className="flex items-center gap-2 text-gold">
            <Lock className="h-3.5 w-3.5" />
            Conference rooms & feed are locked until you verify.
          </span>
          <button
            type="button"
            onClick={triggerVerify}
            className="inline-flex items-center gap-1.5 rounded-md bg-gradient-gold px-3 py-1.5 text-[11px] font-semibold text-gold-foreground shadow-gold transition hover:opacity-90"
          >
            Verify holder
          </button>
        </div>
      )}

      <LobbyChat channelName="lobby" />
    </main>
  );
}
