import { createFileRoute } from "@tanstack/react-router";
import { useLockedPageScroll } from "@/hooks/useLockedPageScroll";
import { LobbyChat } from "@/components/LobbyChat";
import holdersBanner from "@/assets/holders/holders-chat-bg.webp";

/**
 * Holders Chat — a live chat room set up like the Public Lobby, for BAYC and
 * MAYC holders (access: Super Admin → Menu access, "Holders Chat"; the
 * route guard and the chat's row-level security both enforce it). The
 * banner is the lower part of the karaoke lounge image, showing the full
 * BAYCmc logo on the floor.
 */
export const Route = createFileRoute("/_authenticated/_verified/feed")({
  head: () => ({
    meta: [
      { title: "Holders Chat — BAYCmc" },
      { name: "description", content: "Live chat for verified BAYC and MAYC holders." },
    ],
  }),
  component: HoldersChatPage,
});

function HoldersChatPage() {
  useLockedPageScroll();
  return (
    <main className="h-below-header relative flex flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <img src={holdersBanner} alt="" className="h-full w-full object-cover opacity-10" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/70 to-background/95" />
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="relative h-36 shrink-0 overflow-hidden border-b border-gold/20 sm:h-44">
          <img
            src={holdersBanner}
            alt="The BAYCmc logo on the karaoke lounge floor"
            className="absolute inset-0 h-full w-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 px-4 pb-3 sm:px-6">
            <h1 className="font-display text-2xl text-gradient-gold sm:text-3xl">Holders Chat</h1>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              BAYC &amp; MAYC holders
            </p>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <LobbyChat
            channelName="holders"
            membersTitle="Members in Holders Chat"
            emptyText="Welcome, holders. Say hi 👋"
          />
        </div>
      </div>
    </main>
  );
}
