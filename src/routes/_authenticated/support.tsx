import { createFileRoute } from "@tanstack/react-router";
import { LifeBuoy } from "lucide-react";
import { useAuth } from "@/lib/auth/useAuth";
import { SupportThread } from "@/components/SupportThread";

/**
 * Member-facing support thread. Each user has exactly one DM thread with
 * the admins, keyed by their own auth id; RLS on `support_messages` makes
 * sure they only ever see their own messages plus any admin replies.
 */
export const Route = createFileRoute("/_authenticated/support")({
  head: () => ({ meta: [{ title: "Support — BAYCMC" }] }),
  component: SupportPage,
});

function SupportPage() {
  const { user } = useAuth();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-gold text-gold-foreground shadow-gold">
          <LifeBuoy className="h-5 w-5" />
        </span>
        <div>
          <p className="text-[10px] uppercase tracking-[0.4em] text-gold">Concierge</p>
          <h1 className="font-display text-3xl font-bold">Support</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Direct line to the BAYCMC admins. Send a message and someone will respond as soon as
            they're online.
          </p>
        </div>
      </div>

      {user ? (
        <SupportThread threadUserId={user.id} viewerIsAdmin={false} title="Your thread" />
      ) : (
        <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">
          Sign in to open a support thread.
        </div>
      )}
    </main>
  );
}
