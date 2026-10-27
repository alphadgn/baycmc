import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useLockedPageScroll } from "@/hooks/useLockedPageScroll";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Lock, Video } from "lucide-react";
import { LobbyChat } from "@/components/LobbyChat";
import { useVerificationStatus } from "@/lib/baycmc/useVerificationStatus";
import { useMenuItems } from "@/lib/baycmc/useMenuItems";
import punksBackdrop from "@/assets/punks/punks-brunch.jpg";

/**
 * Punks Brunch — a CryptoPunks-holders-only room with a continuous,
 * Discord-style message thread (same chat as the public lobby, on its own
 * "punks-brunch" channel). Access is enforced in the database: only
 * accounts with a verified CryptoPunks holding (or admins) can read or post
 * in this channel. This page just shows the right screen.
 */
export const Route = createFileRoute("/_authenticated/punks-brunch")({
  head: () => ({
    meta: [
      { title: "Punks Brunch — BAYCmc" },
      { name: "description", content: "The CryptoPunks holders' lounge on BAYCmc." },
    ],
  }),
  component: PunksBrunchPage,
});

function PunksBrunchPage() {
  const { loading, isAdmin } = useVerificationStatus();
  const menuItems = useMenuItems();
  const allowed = isAdmin || menuItems.has("punks_brunch");
  const [videoRoomId, setVideoRoomId] = useState<string | null>(null);
  useEffect(() => {
    if (!allowed) return;
    void supabase
      .from("rooms")
      .select("id")
      // By its own LiveKit room — MWroom4 is also a CryptoPunks room.
      .eq("livekit_room", "punks-brunch")
      .eq("active", true)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setVideoRoomId((data?.id as string | undefined) ?? null));
  }, [allowed]);

  // Like the lobby: only the chat thread scrolls, never the page.
  useLockedPageScroll();

  return (
    <main className="h-below-header relative flex flex-col overflow-hidden bg-background">
      {/* Upper half: the punks artwork, fading into the page. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 overflow-hidden">
        <img
          src={punksBackdrop}
          alt=""
          aria-hidden
          className="h-full w-full object-cover object-center [image-rendering:pixelated]"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/10 via-background/35 to-background" />
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <header className="px-4 pb-3 pt-6 sm:px-6">
          <p className="inline-flex items-center rounded-full border border-gold/50 bg-background/70 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-gold backdrop-blur">
            CryptoPunks holders
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <h1 className="font-display text-3xl text-gradient-gold drop-shadow sm:text-5xl">
              Punks Brunch
            </h1>
            {allowed && videoRoomId && (
              <Link
                to="/rooms/$roomId"
                params={{ roomId: videoRoomId }}
                className="inline-flex items-center gap-2 rounded-full bg-gradient-gold px-4 py-2 text-xs font-semibold text-gold-foreground shadow-gold"
              >
                <Video className="h-4 w-4" /> Join video room
              </Link>
            )}
          </div>
        </header>

        {loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking your punks…
          </div>
        ) : allowed ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <LobbyChat channelName="punks-brunch" />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center px-4">
            <div className="max-w-sm rounded-2xl border border-gold/30 bg-background/85 p-6 text-center shadow-card backdrop-blur">
              <Lock className="mx-auto h-6 w-6 text-gold" />
              <h2 className="mt-3 font-display text-xl text-gold">Punks only</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Punks Brunch is open to verified CryptoPunks holders. Link the wallet that holds
                your punk on your profile to get in.
              </p>
              <Link
                to="/profile"
                className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground"
              >
                Link a wallet
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
