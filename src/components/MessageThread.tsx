import { useEffect, useRef, useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
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
  table: "lifer_messages";
  channelName: string;
  emptyText?: string;
  placeholder?: string;
  accentClassName?: string;
  /** Optional image painted behind the thread (dimmed for legibility). */
  backgroundImage?: string | null;
}

/**
 * Realtime message thread bound to a single Supabase table. RLS on the
 * table enforces who can read or post — any member with access can respond,
 * and authors can edit or delete their own messages (the table's owner-only
 * UPDATE/DELETE policies back this up server-side).
 */
export function MessageThread({
  table,
  channelName,
  emptyText = "No messages yet.",
  placeholder = "Say something…",
  accentClassName = "bg-gradient-gold text-gold-foreground",
  backgroundImage = null,
}: MessageThreadProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [input, setInput] = useState("");
  const [posting, setPosting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  // Id of the message currently being edited (its body is loaded into the
  // composer). Null when composing a brand-new message.
  const [editingId, setEditingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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

  // Realtime — inserts, edits, and deletes all reconcile into local state.
  useEffect(() => {
    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "INSERT", schema: "public", table }, async (payload) => {
        const m = payload.new as Message;
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        await hydrateProfiles([m]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table }, (payload) => {
        const m = payload.new as Message;
        setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...m } : x)));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table }, (payload) => {
        const id = (payload.old as { id?: string })?.id;
        if (!id) return;
        setMessages((prev) => prev.filter((x) => x.id !== id));
      })
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
    const missing = Array.from(new Set(msgs.map((m) => m.user_id).filter((id) => !profiles[id])));
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
    const body = input.trim().slice(0, 2000);
    setPosting(true);

    // Edit branch — update an existing message the user owns.
    if (editingId) {
      const { error } = await supabase
        .from(table)
        .update({ body })
        .eq("id", editingId)
        .eq("user_id", user.id);
      setPosting(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      // Optimistic local update so the change shows before realtime echoes.
      setMessages((prev) => prev.map((m) => (m.id === editingId ? { ...m, body } : m)));
      setEditingId(null);
      setInput("");
      return;
    }

    const { error } = await supabase.from(table).insert({ user_id: user.id, body });
    setPosting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setInput("");
  }

  function beginEdit(m: Message) {
    setEditingId(m.id);
    setInput(m.body);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function cancelEdit() {
    setEditingId(null);
    setInput("");
  }

  async function deleteMessage(m: Message) {
    if (!user) return;
    if (!window.confirm("Delete this message?")) return;
    // Optimistic removal; realtime DELETE will confirm for other clients.
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    if (editingId === m.id) cancelEdit();
    const { error } = await supabase.from(table).delete().eq("id", m.id).eq("user_id", user.id);
    if (error) toast.error(error.message);
  }

  if (denied) {
    return (
      <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">
        You don't have access to this thread.
      </div>
    );
  }

  return (
    <div className="glass relative flex h-[70vh] flex-col overflow-hidden rounded-2xl shadow-card">
      {backgroundImage && (
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <img src={backgroundImage} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-background/85" />
        </div>
      )}
      <div ref={scrollRef} className="relative flex-1 space-y-3 overflow-x-hidden overflow-y-auto p-4 sm:p-6">
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
              <div key={m.id} className={`group flex max-w-full flex-col ${mine ? "items-end" : "items-start"}`}>
                <div className="mb-0.5 flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span className={mine ? "text-gold" : ""}>{name}</span>
                  <span>
                    {new Date(m.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className={`flex max-w-full items-center gap-1.5 ${mine ? "flex-row-reverse" : ""}`}>
                  <div
                    className={`max-w-[75%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm [overflow-wrap:anywhere] ${
                      mine ? `${accentClassName} shadow-gold` : "border border-border bg-background/40"
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
                        title="Edit"
                        className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteMessage(m)}
                        aria-label="Delete message"
                        title="Delete"
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
        <div className="relative flex items-center justify-between gap-2 border-t border-gold/30 bg-gold/5 px-3 py-2 text-xs">
          <span className="flex items-center gap-1.5 text-gold">
            <Pencil className="h-3.5 w-3.5" />
            <span className="font-semibold">Editing message</span>
          </span>
          <button
            type="button"
            onClick={cancelEdit}
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Cancel edit"
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
        className="relative flex min-w-0 gap-2 border-t border-border/60 p-3"
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
          maxLength={2000}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-md border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={!user || posting}
        />
        <button
          type="submit"
          disabled={!user || posting || !input.trim()}
          aria-label={editingId ? "Save edit" : "Send"}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold shadow-gold disabled:opacity-50 ${accentClassName}`}
        >
          {editingId ? <Check className="h-4 w-4" /> : null}
          {editingId ? "Save" : "Send"}
        </button>
      </form>
    </div>
  );
}
