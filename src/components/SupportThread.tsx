import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Check, Pencil, ShieldCheck, Trash2, X } from "lucide-react";
import { supabase as typedSupabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { toast } from "sonner";

// support_messages is too new to be in the generated Database type — cast
// through an untyped client so this file compiles before regen.
const supabase = typedSupabase as unknown as SupabaseClient;

interface SupportMessage {
  id: string;
  thread_user_id: string;
  sender_id: string;
  is_admin: boolean;
  body: string;
  created_at: string;
}

interface ProfileMini {
  id: string;
  username: string | null;
  avatar_url: string | null;
  wallet_address: string | null;
}

interface SupportThreadProps {
  /** The thread to render — the user the conversation is about. */
  threadUserId: string;
  /** True when the viewer is an admin replying to someone else's thread. */
  viewerIsAdmin: boolean;
  /** Header shown above the message stream. */
  title?: string;
  /** Optional subtitle (e.g. the user's wallet). */
  subtitle?: string;
}

/**
 * Realtime support DM thread. The user owns one thread; admins respond on
 * it. Anyone can edit / delete their own messages — RLS on
 * `support_messages` enforces the rest server-side.
 */
export function SupportThread({
  threadUserId,
  viewerIsAdmin,
  title = "Support",
  subtitle,
}: SupportThreadProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileMini>>({});
  const [input, setInput] = useState("");
  const [posting, setPosting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Initial load — scoped to this thread.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("support_messages")
        .select("id,thread_user_id,sender_id,is_admin,body,created_at")
        .eq("thread_user_id", threadUserId)
        .order("created_at", { ascending: true })
        .limit(500);
      if (cancelled) return;
      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }
      const rows = (data ?? []) as SupportMessage[];
      setMessages(rows);
      setLoading(false);
      await hydrateProfiles(rows);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadUserId]);

  // Realtime — filter the channel server-side so admins viewing one thread
  // don't get update bursts from every other thread.
  useEffect(() => {
    const channel = supabase
      .channel(`support-${threadUserId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "support_messages",
          filter: `thread_user_id=eq.${threadUserId}`,
        },
        async (payload) => {
          const m = payload.new as SupportMessage;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
          await hydrateProfiles([m]);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "support_messages",
          filter: `thread_user_id=eq.${threadUserId}`,
        },
        (payload) => {
          const m = payload.new as SupportMessage;
          setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...m } : x)));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "support_messages",
          filter: `thread_user_id=eq.${threadUserId}`,
        },
        (payload) => {
          const id = (payload.old as { id?: string })?.id;
          if (!id) return;
          setMessages((prev) => prev.filter((x) => x.id !== id));
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [threadUserId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  async function hydrateProfiles(msgs: SupportMessage[]) {
    const missing = Array.from(
      new Set(
        msgs
          .flatMap((m) => [m.sender_id, m.thread_user_id])
          .filter((id) => id && !profiles[id]),
      ),
    );
    if (!missing.length) return;
    const { data } = await supabase
      .from("profiles")
      .select("id,username,avatar_url,wallet_address")
      .in("id", missing);
    if (data) {
      setProfiles((prev) => {
        const next = { ...prev };
        for (const p of data as ProfileMini[]) next[p.id] = p;
        return next;
      });
    }
  }

  async function send() {
    if (!user || !input.trim()) return;
    const body = input.trim().slice(0, 4000);
    setPosting(true);

    if (editingId) {
      const { error } = await supabase
        .from("support_messages")
        .update({ body })
        .eq("id", editingId)
        .eq("sender_id", user.id);
      setPosting(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      setMessages((prev) => prev.map((m) => (m.id === editingId ? { ...m, body } : m)));
      setEditingId(null);
      setInput("");
      return;
    }

    const { error } = await supabase.from("support_messages").insert({
      thread_user_id: threadUserId,
      sender_id: user.id,
      is_admin: viewerIsAdmin,
      body,
    });
    setPosting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setInput("");
  }

  function beginEdit(m: SupportMessage) {
    setEditingId(m.id);
    setInput(m.body);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function cancelEdit() {
    setEditingId(null);
    setInput("");
  }

  async function deleteMessage(m: SupportMessage) {
    if (!user) return;
    if (!window.confirm("Delete this message?")) return;
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    if (editingId === m.id) cancelEdit();
    const { error } = await supabase.from("support_messages").delete().eq("id", m.id);
    if (error) toast.error(error.message);
  }

  return (
    <div className="glass flex h-[70vh] flex-col overflow-hidden rounded-2xl shadow-card">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-widest text-gold">{title}</p>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {viewerIsAdmin && (
          <span className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold">
            <ShieldCheck className="h-3 w-3" /> Admin
          </span>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-6">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/20" />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {viewerIsAdmin
              ? "No messages in this thread yet."
              : "No messages yet — say hi to the admins."}
          </p>
        ) : (
          messages.map((m) => {
            const senderProfile = profiles[m.sender_id];
            const mine = m.sender_id === user?.id;
            const name =
              senderProfile?.username ??
              (senderProfile?.wallet_address
                ? `${senderProfile.wallet_address.slice(0, 6)}…${senderProfile.wallet_address.slice(-4)}`
                : m.is_admin
                  ? "Admin"
                  : "anon");
            return (
              <div
                key={m.id}
                className={`group flex flex-col ${mine ? "items-end" : "items-start"}`}
              >
                <div className="mb-0.5 flex items-baseline gap-2 text-[11px] text-muted-foreground">
                  <span className={mine ? "text-gold" : ""}>{name}</span>
                  {m.is_admin && !mine && (
                    <span className="inline-flex items-center gap-0.5 rounded-full border border-gold/40 bg-gold/10 px-1.5 text-[9px] font-semibold uppercase tracking-wider text-gold">
                      <ShieldCheck className="h-2.5 w-2.5" /> Admin
                    </span>
                  )}
                  <span>
                    {new Date(m.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className={`flex items-center gap-1.5 ${mine ? "flex-row-reverse" : ""}`}>
                  <div
                    className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                      mine
                        ? "bg-gradient-gold text-gold-foreground shadow-gold"
                        : m.is_admin
                          ? "border border-gold/30 bg-gold/5"
                          : "border border-border bg-background/40"
                    }`}
                  >
                    {m.body}
                  </div>
                  {mine && (
                    <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => beginEdit(m)}
                        aria-label="Edit message"
                        className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteMessage(m)}
                        aria-label="Delete message"
                        className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {editingId && (
        <div className="flex items-center justify-between gap-2 border-t border-gold/30 bg-gold/5 px-3 py-2 text-xs">
          <span className="flex items-center gap-1.5 text-gold">
            <Pencil className="h-3.5 w-3.5" />
            <span className="font-semibold">Editing message</span>
          </span>
          <button
            type="button"
            onClick={cancelEdit}
            aria-label="Cancel edit"
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex gap-2 border-t border-border/60 p-3"
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && editingId) {
              e.preventDefault();
              cancelEdit();
            }
          }}
          maxLength={4000}
          placeholder={viewerIsAdmin ? "Reply as admin…" : "Type your message to support…"}
          className="flex-1 rounded-md border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={!user || posting}
        />
        <button
          type="submit"
          disabled={!user || posting || !input.trim()}
          aria-label={editingId ? "Save edit" : "Send"}
          className="inline-flex items-center gap-1.5 rounded-md bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground shadow-gold disabled:opacity-50"
        >
          {editingId ? <Check className="h-4 w-4" /> : null}
          {editingId ? "Save" : "Send"}
        </button>
      </form>
    </div>
  );
}
