import { createFileRoute } from "@tanstack/react-router";
import { MessageThread } from "@/components/MessageThread";

export const Route = createFileRoute("/_authenticated/messages")({
  head: () => ({
    meta: [{ title: "Messages — BAYCMC" }],
  }),
  component: MessagesPage,
});

function MessagesPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-4">
        <h1 className="font-display text-3xl font-bold">Commons</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Main thread for the clubhouse — open to every member.
        </p>
      </div>
      <MessageThread table="messages" channelName="messages-main" />
    </main>
  );
}
