import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LifeBuoy } from "lucide-react";
import { supabase as typedSupabase } from "@/integrations/supabase/client";
import { SupportThread } from "@/components/SupportThread";

// support_messages isn't in the generated Database type yet — cast through
// an untyped client (same pattern as LobbyChat / SupportThread).
const supabase = typedSupabase as unknown as SupabaseClient;

interface ThreadRow {
  thread_user_id: string;
  body: string;
  created_at: string;
  is_admin: boolean;
}

interface ProfileMini {
  id: string;
  username: string | null;
  avatar_url: string | null;
  wallet_address: string | null;
}

interface ThreadSummary {
  threadUserId: string;
  lastMessageAt: string;
  lastBody: string;
  lastWasAdmin: boolean;
  profile: ProfileMini | null;
}

export const Route = createFileRoute("/_authenticated/admin/support")({
  head: () => ({ meta: [{ title: "Support inbox — BAYCMC admin" }] }),
  component: AdminSupport,
});

function AdminSupport() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      // Pull the most recent messages and roll them up into one row per
      // thread on the client. RLS ensures we only see messages we're
      // allowed to read — admins see every thread.
      const { data, error } = await supabase
        .from("support_messages")
        .select("thread_user_id,body,created_at,is_admin")
        .order("created_at", { ascending: false })
        .limit(500);
      if (cancelled) return;
      if (error) {
        setLoading(false);
        return;
      }
      const rows = (data ?? []) as ThreadRow[];
      const seen = new Map<string, ThreadSummary>();
      for (const r of rows) {
        if (seen.has(r.thread_user_id)) continue;
        seen.set(r.thread_user_id, {
          threadUserId: r.thread_user_id,
          lastMessageAt: r.created_at,
          lastBody: r.body,
          lastWasAdmin: r.is_admin,
          profile: null,
        });
      }

      const ids = Array.from(seen.keys());
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id,username,avatar_url,wallet_address")
          .in("id", ids);
        for (const p of (profs ?? []) as ProfileMini[]) {
          const t = seen.get(p.id);
          if (t) t.profile = p;
        }
      }

      const list = [...seen.values()].sort((a, b) =>
        b.lastMessageAt.localeCompare(a.lastMessageAt),
      );
      setThreads(list);
      setSelected((curr) => curr ?? list[0]?.threadUserId ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeThread = useMemo(
    () => threads.find((t) => t.threadUserId === selected) ?? null,
    [threads, selected],
  );

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6" style={{ height: "calc(100dvh - 4rem - max(env(safe-area-inset-top, 0px), 0.75rem))" }}>
      <header className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-gold text-gold-foreground shadow-gold">
          <LifeBuoy className="h-5 w-5" />
        </span>
        <div>
          <p className="text-[10px] uppercase tracking-[0.4em] text-gold">Admin</p>
          <h1 className="font-display text-2xl font-bold sm:text-3xl">Support inbox</h1>
          <p className="text-xs text-muted-foreground">
            Every member's open thread. Replies are tagged as Admin automatically.
          </p>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[280px,1fr]">
        <aside className="glass min-h-0 overflow-x-hidden overflow-y-auto rounded-2xl border border-border/60 p-2">
          {loading ? (
            <div className="space-y-1.5 p-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-md bg-muted/20" />
              ))}
            </div>
          ) : threads.length === 0 ? (
            <p className="p-4 text-center text-xs italic text-muted-foreground">
              No support threads yet.
            </p>
          ) : (
            <ul className="space-y-1">
              {threads.map((t) => {
                const name =
                  t.profile?.username ??
                  (t.profile?.wallet_address
                    ? `${t.profile.wallet_address.slice(0, 6)}…${t.profile.wallet_address.slice(-4)}`
                    : t.threadUserId.slice(0, 8));
                const active = t.threadUserId === selected;
                return (
                  <li key={t.threadUserId}>
                    <button
                      type="button"
                      onClick={() => setSelected(t.threadUserId)}
                      className={`flex w-full items-start gap-2.5 rounded-md p-2 text-left transition ${
                        active
                          ? "bg-gold/10 ring-1 ring-gold/30"
                          : "hover:bg-secondary/40"
                      }`}
                    >
                      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 overflow-hidden rounded-full border border-border bg-gradient-gold">
                        {t.profile?.avatar_url ? (
                          <img
                            src={t.profile.avatar_url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-gold-foreground">
                            {(name ?? "??").slice(0, 2).toUpperCase()}
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-foreground">
                          {name}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {t.lastWasAdmin ? "You: " : ""}
                          {t.lastBody}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className="min-h-0">
          {activeThread ? (
            <SupportThread
              threadUserId={activeThread.threadUserId}
              viewerIsAdmin
              title="Conversation"
              subtitle={
                activeThread.profile?.username ??
                activeThread.profile?.wallet_address ??
                activeThread.threadUserId
              }
            />
          ) : (
            <div className="glass flex h-full items-center justify-center rounded-2xl border border-border/60 p-8 text-center text-sm text-muted-foreground">
              {loading ? "Loading threads…" : "Select a thread on the left to reply."}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
