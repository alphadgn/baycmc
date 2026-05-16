import { createFileRoute } from "@tanstack/react-router";
import { SocialFeed } from "@/components/SocialFeed";

export const Route = createFileRoute("/_authenticated/_verified/feed")({
  head: () => ({
    meta: [
      { title: "Feed — BAYCMC" },
      { name: "description", content: "Realtime social feed for verified BAYC members." },
    ],
  }),
  component: FeedPage,
});

function FeedPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="font-display text-3xl text-gradient-gold sm:text-5xl">Feed</h1>
        <p className="mt-1 text-xs text-muted-foreground font-sans-display sm:text-sm">
          Realtime · Verified holders only
        </p>
      </header>
      <SocialFeed />
    </main>
  );
}
