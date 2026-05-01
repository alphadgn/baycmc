import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { toast } from "sonner";

interface Message {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
}

interface Profile {
  id: string;
  username: string | null;
  wallet_address: string;
}

interface MessageThreadProps {
  table: "messages" | "lifer_messages";
  channelName: string;
  emptyText?: string;
  placeholder?: string;
  accentClassName?: string;
}

/**
 * Realtime message thread bound to a single Supabase table. RLS on the
 * table enforces who can read or post — this component does no client
 * gating beyond hiding the input when the user isn't signed in.
 */
export function MessageThread({
  table,
  channelName,
  emptyText = "No messages yet.",
  placeholder = "Say something…",
  accentClassName = "bg-gradient-gold text-gold-foreground",
}: MessageThreadProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [input, setInput] = useState("");
  const [posting, setPosting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from(table)
        .select("id,user_id,body,created_at")
        .order("created_at", { ascending: true })
        .limit(200);
      if (cancelled) return;
      if (error) {
        // Most common reason: RLS denies the user. Treat as access denied.
        setDenied(true);
        setLoading(false);
        return;
      }
      setMessages((data ?? []) as Message[]);
      setLoading(false);
      await hydrateProfiles((data ?? []) as Message[]);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table },
        async (payload) => {
          const m = payload.new as Message;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
          await hydrateProfiles([m]);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, table]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  async function hydrateProfiles(msgs: Message[]) {
    const missing = Array.from(
      new Set(msgs.map((m) => m.user_id).filter((id) => !profiles[id])),
    );
    if (!missing.length) return;
    const { data } = await supabase
      .from("profiles")
      .select("id,username,wallet_address")
      .in("id", missing);
    if (data) {
      setProfiles((prev) => {
        const next = { ...prev };
        for (const p of data as Profile[]) next[p.id] = p;
        return next;
      });
    }
  }

  async function send() {
    if (!user || !input.trim()) return;
    setPosting(true);
    const body = input.trim().slice(0, 2000);
    const { error } = await supabase.from(table).insert({ user_id: user.id, body });
    setPosting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setInput("");
  }

  if (denied) {
    return (
      <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">
        You don't have access to this thread.
      </div>
    );
  }

  return (
    <div className="glass flex h-[70vh] flex-col rounded-2xl shadow-card">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-6">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/20" />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          messages.map((m) => {
            const profile = profiles[m.user_id];
            const mine = m.user_id === user?.id;
            const name =
              profile?.username ??
              (profile?.wallet_address
                ? `${profile.wallet_address.slice(0, 6)}…${profile.wallet_address.slice(-4)}`
                : "anon");
            return (
              <div
                key={m.id}
                className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
              >
                <div className="mb-0.5 flex items-baseline gap-2 text-[11px] text-muted-foreground">
                  <span className={mine ? "text-gold" : ""}>{name}</span>
                  <span>{new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                    mine
                      ? `${accentClassName} shadow-gold`
                      : "border border-border bg-background/40"
                  }`}
                >
                  {m.body}
                </div>
              </div>
            );
          })
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex gap-2 border-t border-border/60 p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={2000}
          placeholder={placeholder}
          className="flex-1 rounded-md border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={!user || posting}
        />
        <button
          type="submit"
          disabled={!user || posting || !input.trim()}
          className={`rounded-md px-4 py-2 text-sm font-semibold shadow-gold disabled:opacity-50 ${accentClassName}`}
        >
          Send
        </button>
      </form>
    </div>
  );
}
