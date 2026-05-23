import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface Post {
  id: string;
  user_id: string;
  body: string;
  image_url: string | null;
  created_at: string;
  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
}

interface Profile {
  id: string;
  username: string | null;
  wallet_address: string;
  avatar_url: string | null;
}

interface SocialFeedProps {
  liferOnly?: boolean;
}

export function SocialFeed({ liferOnly = false }: SocialFeedProps) {
  const { user } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    setLoading(true);
    const { data: postsRaw } = await supabase
      .from("posts")
      .select("id,user_id,body,image_url,created_at")
      .order("created_at", { ascending: false })
      .limit(100);

    if (!postsRaw) {
      setPosts([]);
      setLoading(false);
      return;
    }

    const ids = postsRaw.map((p) => p.id);
    const [{ data: likes }, { data: comments }, { data: myLikes }] = await Promise.all([
      supabase.from("post_likes").select("post_id").in("post_id", ids),
      supabase.from("post_comments").select("post_id").in("post_id", ids),
      user
        ? supabase.from("post_likes").select("post_id").in("post_id", ids).eq("user_id", user.id)
        : Promise.resolve({ data: [] as { post_id: string }[] }),
    ]);

    const likeCounts: Record<string, number> = {};
    likes?.forEach((l) => (likeCounts[l.post_id] = (likeCounts[l.post_id] ?? 0) + 1));
    const commentCounts: Record<string, number> = {};
    comments?.forEach((c) => (commentCounts[c.post_id] = (commentCounts[c.post_id] ?? 0) + 1));
    const mineSet = new Set(myLikes?.map((l) => l.post_id) ?? []);

    const composed: Post[] = postsRaw.map((p) => ({
      ...p,
      like_count: likeCounts[p.id] ?? 0,
      comment_count: commentCounts[p.id] ?? 0,
      liked_by_me: mineSet.has(p.id),
    }));
    setPosts(composed);
    await hydrateProfiles(composed.map((p) => p.user_id));
    setLoading(false);
  }

  async function hydrateProfiles(userIds: string[]) {
    const missing = Array.from(new Set(userIds.filter((id) => !profiles[id])));
    if (!missing.length) return;
    const { data } = await supabase
      .from("profiles")
      .select("id,username,wallet_address,avatar_url")
      .in("id", missing);
    if (data) {
      setProfiles((prev) => {
        const next = { ...prev };
        for (const p of data as Profile[]) next[p.id] = p;
        return next;
      });
    }
  }

  useEffect(() => {
    void loadAll();
    const channel = supabase
      .channel(`feed-${liferOnly ? "lifer" : "main"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, () => {
        void loadAll();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "post_likes" }, () => {
        void loadAll();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "post_comments" }, () => {
        void loadAll();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function submit() {
    if (!user || !body.trim()) return;
    setPosting(true);
    const { error } = await supabase
      .from("posts")
      .insert({ user_id: user.id, body: body.trim().slice(0, 4000) });
    setPosting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setBody("");
  }

  async function toggleLike(post: Post) {
    if (!user) return;
    if (post.liked_by_me) {
      await supabase.from("post_likes").delete().eq("post_id", post.id).eq("user_id", user.id);
    } else {
      await supabase.from("post_likes").insert({ post_id: post.id, user_id: user.id });
    }
  }

  return (
    <div className="space-y-4">
      {user && (
        <div className="glass rounded-2xl p-4 shadow-card">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Share with the club…"
            maxLength={4000}
            rows={3}
            className="w-full resize-none rounded-md border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring font-sans-display"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">{body.length}/4000</span>
            <button
              onClick={submit}
              disabled={posting || !body.trim()}
              className="rounded-md bg-gradient-gold px-4 py-2 text-xs font-semibold text-gold-foreground shadow-gold disabled:opacity-50 font-sans-display"
            >
              {posting ? "Posting…" : "Post"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted/20" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground font-sans-display">
          No posts yet. Be the first.
        </p>
      ) : (
        posts.map((p) => {
          const profile = profiles[p.user_id];
          const name =
            profile?.username ??
            (profile?.wallet_address
              ? `${profile.wallet_address.slice(0, 6)}…${profile.wallet_address.slice(-4)}`
              : "anon");
          return (
            <article key={p.id} className="glass rounded-2xl p-5 shadow-card">
              <header className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-gradient-gold" />
                <div>
                  <div className="text-sm font-semibold font-sans-display">{name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}
                  </div>
                </div>
              </header>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed font-sans-display">
                {p.body}
              </p>
              <footer className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                <button
                  onClick={() => toggleLike(p)}
                  className={`transition hover:text-gold ${p.liked_by_me ? "text-gold" : ""}`}
                >
                  ♥ {p.like_count}
                </button>
                <span>💬 {p.comment_count}</span>
              </footer>
            </article>
          );
        })
      )}
    </div>
  );
}
