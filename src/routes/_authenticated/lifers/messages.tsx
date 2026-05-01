import { createFileRoute } from "@tanstack/react-router";
import { MessageThread } from "@/components/MessageThread";
import { BrandLogo } from "@/components/BrandLogo";

export const Route = createFileRoute("/_authenticated/lifers/messages")({
  head: () => ({
    meta: [{ title: "Lifer Chat — BAYCMC" }],
  }),
  component: LiferMessages,
});

function LiferMessages() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-center gap-4">
        <BrandLogo className="h-16 w-16 sm:h-20 sm:w-20" />
        <div>
          <p className="text-[10px] uppercase tracking-[0.4em] text-gold">Lifers only</p>
          <h1 className="font-display text-3xl font-bold">Lifer Chat</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            A second thread visible only to dual-verified members.
          </p>
        </div>
      </div>
      <MessageThread
        table="lifer_messages"
        channelName="messages-lifer"
        emptyText="The Lifer thread is quiet. Be the first to break it."
        placeholder="Speak, Lifer…"
        accentClassName="bg-gradient-gold text-gold-foreground"
      />
    </main>
  );
}
