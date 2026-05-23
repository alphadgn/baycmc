import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { format, isSameDay } from "date-fns";
import {
  Check,
  ChevronDown,
  Copy,
  CornerDownLeft,
  Hash,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Reply,
  Smile,
  Sticker,
  Trash2,
  Users,
  X,
} from "lucide-react";

import { toast } from "sonner";
import { supabase as typedSupabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { GifPicker } from "@/components/GifPicker";
import type { GifResult } from "@/server/giphy.functions";

// New tables aren't in the generated Database type yet — see profile-side
// notes. Cast through an untyped client so this file compiles before regen.
const supabase = typedSupabase as unknown as SupabaseClient;

interface LobbyMessage {
  id: string;
  user_id: string;
  body: string | null;
  image_url: string | null;
  gif_url: string | null;
  reply_to_id: string | null;
  created_at: string;
}

interface ProfileMini {
  id: string;
  username: string | null;
  avatar_url: string | null;
  wallet_address: string | null;
}

interface ReactionRow {
  message_id: string;
  user_id: string;
  emoji: string;
}

const QUICK_EMOJI = ["🔥", "🐵", "🍌", "🙌", "❤️", "👀", "💎", "🤝", "😂", "🎉", "🚀"];
const INSERT_EMOJI = [
  "😀",
  "😂",
  "🤣",
  "😅",
  "😎",
  "🤔",
  "😇",
  "😉",
  "🙃",
  "😘",
  "🥰",
  "🤩",
  "🤗",
  "🤭",
  "😴",
  "🤤",
  "🥳",
  "😡",
  "😱",
  "😭",
  "🙏",
  "👍",
  "👎",
  "👏",
  "💪",
  "🙌",
  "👀",
  "🐵",
  "🐒",
  "🦍",
  "🍌",
  "🥃",
  "🚀",
  "🔥",
  "💎",
  "🌊",
  "🌈",
  "⭐",
  "✨",
  "💯",
  "❤️",
  "🧡",
  "💛",
  "💚",
  "💙",
  "💜",
  "🖤",
  "💔",
  "💢",
  "💯",
];

interface LobbyChatProps {
  channelName?: string;
}

export function LobbyChat({ channelName = "lobby" }: LobbyChatProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<LobbyMessage[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileMini>>({});
  const [reactions, setReactions] = useState<Record<string, ReactionRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [replyTo, setReplyTo] = useState<LobbyMessage | null>(null);
  const [editing, setEditing] = useState<LobbyMessage | null>(null);
  const [posting, setPosting] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  // Long-press / right-click on a message opens this bottom action sheet.
  // Stored as the full message object so the sheet can render context.
  const [actionTarget, setActionTarget] = useState<LobbyMessage | null>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);


  const hydrateProfiles = useCallback(
    async (msgs: LobbyMessage[]) => {
      const missing = Array.from(new Set(msgs.map((m) => m.user_id).filter((id) => !profiles[id])));
      if (!missing.length) return;
      const { data } = await supabase
        .from("profiles")
        .select("id,username,avatar_url,wallet_address")
        .in("id", missing);
      if (!data) return;
      setProfiles((prev) => {
        const next = { ...prev };
        for (const p of data as ProfileMini[]) next[p.id] = p;
        return next;
      });
    },
    [profiles],
  );

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("lobby_messages")
        .select("id,user_id,body,image_url,gif_url,reply_to_id,created_at")
        .order("created_at", { ascending: true })
        .limit(300);
      if (cancelled) return;
      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }
      const msgs = (data ?? []) as LobbyMessage[];
      setMessages(msgs);
      setLoading(false);
      void hydrateProfiles(msgs);
      if (msgs.length > 0) {
        const ids = msgs.map((m) => m.id);
        const { data: rxs } = await supabase
          .from("lobby_message_reactions")
          .select("message_id,user_id,emoji")
          .in("message_id", ids);
        if (!cancelled && rxs) {
          const grouped: Record<string, ReactionRow[]> = {};
          for (const r of rxs as ReactionRow[]) {
            (grouped[r.message_id] ??= []).push(r);
          }
          setReactions(grouped);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime
  useEffect(() => {
    const ch = supabase
      .channel("lobby-chat")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "lobby_messages" },
        async (payload) => {
          const m = payload.new as LobbyMessage;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
          await hydrateProfiles([m]);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "lobby_messages" },
        (payload) => {
          const m = payload.new as LobbyMessage;
          setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...m } : x)));
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "lobby_messages" },
        (payload) => {
          const id = (payload.old as { id?: string })?.id;
          if (!id) return;
          setMessages((prev) => prev.filter((m) => m.id !== id));
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "lobby_message_reactions" },
        (payload) => {
          const r = payload.new as ReactionRow;
          setReactions((prev) => {
            const list = prev[r.message_id] ?? [];
            if (list.some((x) => x.user_id === r.user_id && x.emoji === r.emoji)) {
              return prev;
            }
            return { ...prev, [r.message_id]: [...list, r] };
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "lobby_message_reactions" },
        (payload) => {
          const old = payload.old as Partial<ReactionRow>;
          if (!old.message_id || !old.user_id || !old.emoji) return;
          setReactions((prev) => {
            const list = prev[old.message_id!] ?? [];
            const next = list.filter((r) => !(r.user_id === old.user_id && r.emoji === old.emoji));
            return { ...prev, [old.message_id!]: next };
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [hydrateProfiles]);

  // Auto-scroll only when the user is already near the bottom, so users
  // landing in the lobby stay at the top of the thread and can scroll
  // down on their own. Track scroll position to toggle the jump button.
  const nearBottomRef = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (nearBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages.length]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distance < 80;
    nearBottomRef.current = near;
    setShowJumpToBottom(!near && el.scrollHeight > el.clientHeight + 40);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);


  const messageById = useMemo(() => {
    const m = new Map<string, LobbyMessage>();
    for (const x of messages) m.set(x.id, x);
    return m;
  }, [messages]);

  // Unique recent posters → "members in this lobby" list.
  const memberList = useMemo(() => {
    const seen = new Map<string, ProfileMini>();
    for (const m of messages) {
      const p = profiles[m.user_id];
      if (p && !seen.has(p.id)) seen.set(p.id, p);
    }
    return [...seen.values()];
  }, [messages, profiles]);

  async function uploadPendingImage(): Promise<string | null> {
    if (!pendingImage || !user) return null;
    const ext = pendingImage.name.split(".").pop()?.toLowerCase() || "png";
    const path = `${user.id}/chat-${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("chat-attachments")
      .upload(path, pendingImage, { upsert: false, contentType: pendingImage.type });
    if (error) throw error;
    const { data } = supabase.storage.from("chat-attachments").getPublicUrl(path);
    return data.publicUrl;
  }

  async function send(opts: { gifUrl?: string } = {}) {
    if (!user) return;
    const text = body.trim();

    // Edit branch: only the body changes. Attachments / gifs / reply target
    // are immutable on an existing message — discord matches this exactly.
    if (editing) {
      if (!text) {
        toast.error("Message can't be empty.");
        return;
      }
      setPosting(true);
      try {
        const { error } = await supabase
          .from("lobby_messages")
          .update({ body: text })
          .eq("id", editing.id)
          .eq("user_id", user.id);
        if (error) throw error;
        setBody("");
        setEditing(null);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't edit message");
      } finally {
        setPosting(false);
      }
      return;
    }

    const hasContent = !!text || !!pendingImage || !!opts.gifUrl;
    if (!hasContent) return;
    setPosting(true);
    try {
      let imageUrl: string | null = null;
      if (pendingImage) {
        imageUrl = await uploadPendingImage();
      }
      const { error } = await supabase.from("lobby_messages").insert({
        user_id: user.id,
        body: text || null,
        image_url: imageUrl,
        gif_url: opts.gifUrl ?? null,
        reply_to_id: replyTo?.id ?? null,
      });
      if (error) throw error;
      setBody("");
      setPendingImage(null);
      setReplyTo(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send message");
    } finally {
      setPosting(false);
    }
  }

  async function deleteMessage(id: string) {
    const { error } = await supabase.from("lobby_messages").delete().eq("id", id);
    if (error) toast.error(error.message);
  }

  function beginEdit(msg: LobbyMessage) {
    setEditing(msg);
    setReplyTo(null);
    setBody(msg.body ?? "");
    // Focus + caret-to-end on the next tick so the user can edit immediately.
    setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const v = el.value;
      el.setSelectionRange(v.length, v.length);
    }, 0);
  }

  function cancelEdit() {
    setEditing(null);
    setBody("");
  }

  async function copyMessage(msg: LobbyMessage) {
    const text = msg.body ?? msg.image_url ?? msg.gif_url ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy");
    }
  }

  async function toggleReaction(messageId: string, emoji: string) {
    if (!user) return;
    const list = reactions[messageId] ?? [];
    const mine = list.find((r) => r.user_id === user.id && r.emoji === emoji);
    if (mine) {
      const { error } = await supabase
        .from("lobby_message_reactions")
        .delete()
        .eq("message_id", messageId)
        .eq("user_id", user.id)
        .eq("emoji", emoji);
      if (error) toast.error(error.message);
    } else {
      const { error } = await supabase
        .from("lobby_message_reactions")
        .insert({ message_id: messageId, user_id: user.id, emoji });
      if (error && !error.message.toLowerCase().includes("duplicate")) {
        toast.error(error.message);
      }
    }
  }

  function insertEmoji(e: string) {
    setBody((prev) => prev + e);
    setEmojiOpen(false);
    // Restore focus so users can keep typing right after.
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  // Pre-compute date-divider positions: each message gets a `showDate`
  // flag when its calendar day differs from the previous message's.
  const enriched = useMemo(() => {
    let prev: Date | null = null;
    return messages.map((m) => {
      const cur = new Date(m.created_at);
      const showDate = !prev || !isSameDay(prev, cur);
      prev = cur;
      return { msg: m, showDate, date: cur };
    });
  }, [messages]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {/* Channel header (Discord-style) */}
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Hash className="h-4 w-4 text-muted-foreground" />
          <span className="truncate text-sm font-semibold">{channelName}</span>
        </div>
        <Sheet open={membersOpen} onOpenChange={setMembersOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              aria-label="Show members"
            >
              <Users className="h-3.5 w-3.5" />
              <span className="tabular-nums">{memberList.length}</span>
            </button>
          </SheetTrigger>
          <SheetContent
            side="right"
            className="w-[88vw] max-w-sm border-l border-gold/20 bg-popover p-0"
          >
            <SheetHeader className="border-b border-border/60 p-5">
              <SheetTitle className="font-display text-base">Members in lobby</SheetTitle>
            </SheetHeader>
            {memberList.length === 0 ? (
              <p className="p-5 text-xs italic text-muted-foreground">No members posting yet.</p>
            ) : (
              <ul className="p-2">
                {memberList.map((p) => {
                  const name =
                    p.username ??
                    (p.wallet_address
                      ? `${p.wallet_address.slice(0, 6)}…${p.wallet_address.slice(-4)}`
                      : "anon");
                  return (
                    <li
                      key={p.id}
                      className="flex items-center gap-3 rounded-lg p-2 transition hover:bg-secondary/60"
                    >
                      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full border border-border bg-gradient-gold">
                        {p.avatar_url ? (
                          <img
                            src={p.avatar_url}
                            alt={name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-gold-foreground">
                            {(name ?? "??").slice(0, 2).toUpperCase()}
                          </div>
                        )}
                      </div>
                      <span className="truncate text-sm font-medium">{name}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </SheetContent>
        </Sheet>
      </div>

      {/* Message stream */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 space-y-2 overflow-x-hidden overflow-y-auto p-2 sm:p-4"
        >
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-muted/20" />
              ))}
            </div>
          ) : messages.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Welcome to the lobby. Say hi 👋
            </p>
          ) : (
            enriched.map(({ msg, showDate, date }) => (
              <div key={msg.id}>
                {showDate && (
                  <div className="my-3 flex items-center gap-3 px-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span className="h-px flex-1 bg-border/60" />
                    <span>{format(date, "EEE, MMM d, yyyy")}</span>
                    <span className="h-px flex-1 bg-border/60" />
                  </div>
                )}
                <MessageRow
                  message={msg}
                  author={profiles[msg.user_id]}
                  replyTarget={msg.reply_to_id ? (messageById.get(msg.reply_to_id) ?? null) : null}
                  replyTargetAuthor={
                    msg.reply_to_id
                      ? (profiles[messageById.get(msg.reply_to_id)?.user_id ?? ""] ?? null)
                      : null
                  }
                  reactions={reactions[msg.id] ?? []}
                  currentUserId={user?.id ?? null}
                  onReply={() => {
                    setReplyTo(msg);
                    setEditing(null);
                  }}
                  onReact={(emoji) => toggleReaction(msg.id, emoji)}
                  onLongPress={() => setActionTarget(msg)}
                />
              </div>
            ))
          )}
        </div>
        {showJumpToBottom && (
          <button
            type="button"
            onClick={scrollToBottom}
            aria-label="Jump to latest message"
            className="absolute bottom-3 right-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-gold/40 bg-background/90 text-gold shadow-gold backdrop-blur transition hover:bg-background"
          >
            <ChevronDown className="h-5 w-5" />
          </button>
        )}
      </div>


      {replyTo && !editing && (
        <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/10 px-3 py-2 text-xs sm:px-4">
          <div className="min-w-0">
            <span className="text-muted-foreground">Replying to </span>
            <span className="font-semibold text-gold">
              {profiles[replyTo.user_id]?.username ?? "anon"}
            </span>
            <span className="ml-2 truncate text-muted-foreground">
              {replyTo.body ? replyTo.body.slice(0, 80) : replyTo.image_url ? "[image]" : "[gif]"}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setReplyTo(null)}
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Cancel reply"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {editing && (
        <div className="flex items-center justify-between gap-2 border-t border-gold/30 bg-gold/5 px-3 py-2 text-xs sm:px-4">
          <div className="flex min-w-0 items-center gap-1.5 text-gold">
            <Pencil className="h-3.5 w-3.5" />
            <span className="font-semibold">Editing message</span>
            <span className="truncate text-muted-foreground">· esc to cancel</span>
          </div>
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

      {pendingImage && (
        <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/10 px-3 py-2 text-xs sm:px-4">
          <span className="truncate text-muted-foreground">
            <ImageIcon className="mr-1 inline h-3.5 w-3.5" />
            {pendingImage.name}
          </span>
          <button
            type="button"
            onClick={() => {
              setPendingImage(null);
              if (fileRef.current) fileRef.current.value = "";
            }}
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Remove attachment"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Composer — pinned to the bottom. The textarea is intentionally
          larger and pill-shaped; the icon buttons fire input.blur() on
          pointerdown so the soft keyboard dismisses BEFORE the popover
          opens (otherwise iOS keeps the keyboard up over the GIF picker). */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-end gap-1.5 border-t border-border/60 bg-card/40 px-2 py-2 sm:gap-2 sm:px-3"
        // Keep the composer above the iOS home-indicator safe area.
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}
      >
        <button
          type="button"
          onPointerDown={() => inputRef.current?.blur()}
          onClick={() => fileRef.current?.click()}
          disabled={posting || !!editing}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
          aria-label="Attach image"
          title="Attach image"
        >
          <ImageIcon className="h-5 w-5" />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 5 * 1024 * 1024) {
              toast.error("Image is too large — max 5 MB.");
              e.target.value = "";
              return;
            }
            setPendingImage(f);
          }}
        />
        <Popover open={gifOpen} onOpenChange={setGifOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              // Dismiss the soft keyboard BEFORE the popover opens.
              onPointerDown={() => inputRef.current?.blur()}
              disabled={posting || !!editing}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
              aria-label="Insert GIF"
              title="Insert GIF"
            >
              <Sticker className="h-5 w-5" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={8}
            // onOpenAutoFocus default would re-focus the trigger and on iOS
            // the previously-focused textarea sometimes regains focus —
            // prevent that so the keyboard stays down.
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="w-[min(20rem,calc(100vw-1rem))] border-gold/20 bg-popover p-0"
          >
            <GifPicker
              onPick={(g: GifResult) => {
                setGifOpen(false);
                void send({ gifUrl: g.url });
              }}
            />
          </PopoverContent>
        </Popover>
        <textarea
          ref={inputRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            } else if (e.key === "Escape" && editing) {
              e.preventDefault();
              cancelEdit();
            }
          }}
          placeholder={user ? "Message" : "Sign in to chat"}
          rows={1}
          maxLength={2000}
          disabled={!user || posting}
          // text-base = 16px prevents iOS Safari auto-zoom on focus.
          className="min-h-[44px] max-h-32 flex-1 resize-none rounded-2xl border border-border bg-input px-4 py-3 text-base leading-tight focus:outline-none focus:ring-2 focus:ring-ring sm:text-sm"
          style={{ fontSize: 16 }}
        />
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              onPointerDown={() => inputRef.current?.blur()}
              disabled={!user || posting}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
              aria-label="Insert emoji"
              title="Insert emoji"
            >
              <Smile className="h-5 w-5" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="w-[min(20rem,calc(100vw-1rem))] border-gold/20 bg-popover p-2"
          >
            <div className="grid grid-cols-10 gap-1">
              {INSERT_EMOJI.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => insertEmoji(e)}
                  className="rounded p-1 text-lg leading-none transition hover:bg-secondary"
                >
                  {e}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <button
          type="submit"
          disabled={!user || posting || (!body.trim() && !pendingImage && !editing)}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-gold text-gold-foreground shadow-gold disabled:opacity-50"
          aria-label={editing ? "Save edit" : "Send"}
        >
          {posting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : editing ? (
            <Check className="h-5 w-5" />
          ) : (
            <CornerDownLeft className="h-5 w-5" />
          )}
        </button>
      </form>

      {/* Action sheet — opens on long-press / right-click of a message.
          Mobile slides up from the bottom; the emoji row is the same shape
          as discord's quick-reaction strip. */}
      <Sheet open={!!actionTarget} onOpenChange={(o) => !o && setActionTarget(null)}>
        <SheetContent
          side="bottom"
          className="border-t border-gold/20 bg-popover p-0"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {actionTarget && (
            <MessageActions
              message={actionTarget}
              isMine={actionTarget.user_id === user?.id}
              onClose={() => setActionTarget(null)}
              onReply={() => {
                setReplyTo(actionTarget);
                setEditing(null);
                setActionTarget(null);
              }}
              onReact={(emoji) => {
                void toggleReaction(actionTarget.id, emoji);
                setActionTarget(null);
              }}
              onCopy={() => {
                void copyMessage(actionTarget);
                setActionTarget(null);
              }}
              onEdit={() => {
                beginEdit(actionTarget);
                setActionTarget(null);
              }}
              onDelete={() => {
                void deleteMessage(actionTarget.id);
                setActionTarget(null);
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function MessageActions({
  message,
  isMine,
  onClose,
  onReply,
  onReact,
  onCopy,
  onEdit,
  onDelete,
}: {
  message: LobbyMessage;
  isMine: boolean;
  onClose: () => void;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const canEdit = isMine && !!message.body;
  return (
    <div>
      <SheetHeader className="border-b border-border/60 px-4 py-3">
        <SheetTitle className="text-left text-xs uppercase tracking-wider text-muted-foreground">
          Message
        </SheetTitle>
      </SheetHeader>
      <div className="flex justify-between gap-1 border-b border-border/60 px-3 py-2">
        {QUICK_EMOJI.slice(0, 7).map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onReact(e)}
            className="flex-1 rounded-md py-2 text-2xl leading-none transition hover:bg-secondary"
          >
            {e}
          </button>
        ))}
      </div>
      <div className="flex flex-col py-1">
        <ActionItem icon={<Reply className="h-4 w-4" />} label="Reply" onClick={onReply} />
        <ActionItem icon={<Copy className="h-4 w-4" />} label="Copy text" onClick={onCopy} />
        {canEdit && (
          <ActionItem icon={<Pencil className="h-4 w-4" />} label="Edit" onClick={onEdit} />
        )}
        {isMine && (
          <ActionItem
            icon={<Trash2 className="h-4 w-4" />}
            label="Delete"
            onClick={onDelete}
            tone="destructive"
          />
        )}
        <ActionItem icon={<X className="h-4 w-4" />} label="Cancel" onClick={onClose} muted />
      </div>
    </div>
  );
}

function ActionItem({
  icon,
  label,
  onClick,
  tone,
  muted,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: "destructive";
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-3 text-sm transition active:bg-secondary/80 ${
        tone === "destructive"
          ? "text-destructive hover:bg-destructive/10"
          : muted
            ? "text-muted-foreground hover:bg-secondary"
            : "text-foreground hover:bg-secondary"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

const LONG_PRESS_MS = 380;

function MessageRow({
  message,
  author,
  replyTarget,
  replyTargetAuthor,
  reactions,
  currentUserId,
  onReply,
  onReact,
  onLongPress,
}: {
  message: LobbyMessage;
  author?: ProfileMini;
  replyTarget: LobbyMessage | null;
  replyTargetAuthor: ProfileMini | null;
  reactions: ReactionRow[];
  currentUserId: string | null;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onLongPress: () => void;
}) {
  const mine = message.user_id === currentUserId;
  const name =
    author?.username ??
    (author?.wallet_address
      ? `${author.wallet_address.slice(0, 6)}…${author.wallet_address.slice(-4)}`
      : "anon");
  const initials = (name ?? "??").slice(0, 2).toUpperCase();

  const grouped = reactions.reduce<Record<string, ReactionRow[]>>((acc, r) => {
    (acc[r.emoji] ??= []).push(r);
    return acc;
  }, {});

  // Gesture state. We keep the translate value in React (so the icon can
  // fade in proportionally), but pointer bookkeeping lives in refs so we
  // don't re-render on every move event.
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startedAt: number;
    decided: "swipe" | "scroll" | null;
    longPressTimer: number | null;
  } | null>(null);

  function clearLongPress() {
    const d = dragRef.current;
    if (d?.longPressTimer != null) {
      window.clearTimeout(d.longPressTimer);
      d.longPressTimer = null;
    }
  }

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    dragRef.current = {
      startX: t.clientX,
      startY: t.clientY,
      startedAt: Date.now(),
      decided: null,
      longPressTimer: window.setTimeout(() => {
        // Long-press confirmed; suppress the click-style swipe path too.
        if (dragRef.current) dragRef.current.decided = "scroll";
        onLongPress();
      }, LONG_PRESS_MS),
    };
  }

  function onTouchMove(e: React.TouchEvent) {
    const d = dragRef.current;
    if (!d) return;
    const t = e.touches[0];
    const dx = t.clientX - d.startX;
    const dy = t.clientY - d.startY;
    if (d.decided == null) {
      // Wait until the user has moved at least 8px to decide direction.
      // Vertical wins → let native scroll happen and bail on the gesture.
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        d.decided = "scroll";
        clearLongPress();
        return;
      }
      d.decided = "swipe";
      clearLongPress();
    }
    if (d.decided === "scroll") return;
    e.preventDefault();
    return;
  }

  function onTouchEnd() {
    const d = dragRef.current;
    if (!d) return;
    clearLongPress();
    dragRef.current = null;
  }

  function onTouchCancel() {
    clearLongPress();
    dragRef.current = null;
  }

  // Right-click → action sheet (desktop parity with mobile long-press).
  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    onLongPress();
  }

  return (
    <div
      className="relative max-w-full overflow-x-hidden touch-pan-y"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      onContextMenu={onContextMenu}
    >
      <div
        className="group flex max-w-full items-start gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-secondary/30 sm:gap-3"
      >
        <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full border border-border bg-gradient-gold">
          {author?.avatar_url ? (
            <img src={author.avatar_url} alt={name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[11px] font-semibold text-gold-foreground">
              {initials}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
            <span className={mine ? "font-semibold text-gold" : "font-semibold"}>{name}</span>
            <span className="text-[10px] text-muted-foreground">
              {format(new Date(message.created_at), "HH:mm")}
            </span>
          </div>
          {replyTarget && (
            <div className="mt-1 flex items-start gap-1.5 rounded-md border-l-2 border-gold/50 bg-muted/20 px-2 py-1 text-[11px]">
              <Reply className="mt-0.5 h-3 w-3 text-gold/70" />
              <div className="min-w-0">
                <span className="font-semibold text-gold/90">
                  {replyTargetAuthor?.username ?? "anon"}
                </span>
                <span className="ml-1 truncate text-muted-foreground">
                  {replyTarget.body
                    ? replyTarget.body.slice(0, 100)
                    : replyTarget.image_url
                      ? "[image]"
                      : "[gif]"}
                </span>
              </div>
            </div>
          )}
          {message.body && (
            <p className="mt-0.5 max-w-full whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">
              {message.body}
            </p>
          )}
          {message.image_url && (
            <a
              href={message.image_url}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-block max-w-full overflow-hidden rounded-lg border border-border sm:max-w-[260px]"
            >
              <img
                src={message.image_url}
                alt="attachment"
                loading="lazy"
                // No object-cover here — keep the natural aspect ratio.
                // max-h caps absurdly tall images; everything else flows.
                className="block h-auto max-h-72 w-full object-contain"
              />
            </a>
          )}
          {message.gif_url && (
            <div className="mt-1.5 inline-block max-w-full overflow-hidden rounded-lg border border-border sm:max-w-[260px]">
              <img
                src={message.gif_url}
                alt="gif"
                loading="lazy"
                // GIFs must keep their native aspect ratio — Giphy returns
                // wide square and tall variants, and object-cover was
                // cropping any frame that didn't match the container.
                className="block h-auto max-h-72 w-full object-contain"
              />
            </div>
          )}
          {Object.keys(grouped).length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {Object.entries(grouped).map(([emoji, list]) => {
                const mineToo = currentUserId
                  ? list.some((r) => r.user_id === currentUserId)
                  : false;
                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => onReact(emoji)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
                      mineToo
                        ? "border-gold/60 bg-gold/15 text-foreground"
                        : "border-border bg-secondary/40 text-muted-foreground hover:border-gold/40"
                    }`}
                  >
                    <span>{emoji}</span>
                    <span className="text-[10px] tabular-nums">{list.length}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {/* Desktop hover affordance: click for reply, right-click for the
          full action sheet. On touch we use long-press + swipe instead. */}
        <div className="hidden shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100 sm:flex">
          <button
            type="button"
            onClick={onReply}
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Reply"
            title="Reply"
          >
            <Reply className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
