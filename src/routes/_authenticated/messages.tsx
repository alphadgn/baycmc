import { createFileRoute, Link } from "@tanstack/react-router";
import { MessageThread } from "@/components/MessageThread";
import { useVerificationStatus } from "@/lib/baycmc/useVerificationStatus";

export const Route = createFileRoute("/_authenticated/messages")({
  head: () => ({
    meta: [{ title: "Messages — BAYCMC" }],
  }),
  component: MessagesPage,
});

function MessagesPage() {
  const { tokenProof, loading } = useVerificationStatus();

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="h-[70vh] animate-pulse rounded-2xl bg-muted/10" />
      </main>
    );
  }

  if (!tokenProof) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="glass rounded-2xl p-8 text-center shadow-card">
          <h1 className="font-display text-2xl font-semibold">Token Proof required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Verify BAYC ownership to join the main thread.
          </p>
          <Link
            to="/profile"
            className="mt-6 inline-block rounded-md bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground shadow-gold"
          >
            Go to verification
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-4">
        <h1 className="font-display text-3xl font-bold">Commons</h1>
        <p className="mt-1 text-sm text-muted-foreground">Main thread for verified members.</p>
      </div>
      <MessageThread table="messages" channelName="messages-main" />
    </main>
  );
}
