import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ShieldCheck, Send, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChatScroll } from "@/hooks/use-chat-scroll";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/contract-auditor")({
  head: () => ({ meta: [{ title: "Contract Auditor — BAYCMC" }] }),
  component: ContractAuditorPage,
});

type AuditRow = { id: string; role: "user" | "assistant"; parts: unknown; created_at: string };

function ContractAuditorPage() {
  const { user, loading: authLoading } = useAuth();
  const [input, setInput] = useState("");
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { messages, sendMessage, status, setMessages, stop } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/contract-audit",
      headers: async (): Promise<Record<string, string>> => {
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token
          ? { Authorization: `Bearer ${data.session.access_token}` }
          : {};
      },
    }),
    onError: (err) => {
      toast.error(err.message || "Audit request failed. Please try again.");
    },
  });

  // Load the single persisted conversation once.
  useEffect(() => {
    if (historyLoaded || authLoading) return;
    if (!user) {
      setHistoryLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("contract_audit_messages")
        .select("id, role, parts, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      if (error) {
        console.error("[contract-auditor] history load failed", error);
      } else if (data) {
        setMessages(
          (data as AuditRow[]).reverse().map((row) => ({
            id: row.id,
            role: row.role,
            parts: row.parts as UIMessage["parts"],
          })),
        );
      }
      setHistoryLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, historyLoaded, setMessages]);

  // Keep the composer focused during normal use.
  useEffect(() => {
    if (historyLoaded && status !== "streaming" && status !== "submitted") {
      textareaRef.current?.focus();
    }
  }, [historyLoaded, status]);

  const isLoading = status === "submitted" || status === "streaming";
  const { scrollRef, contentRef, handleScroll } = useChatScroll(
    `audit-${user?.id ?? ""}`,
    historyLoaded && !authLoading,
    messages,
  );

  async function handleSend() {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    await sendMessage({ text });
  }

  async function handleClear() {
    if (!user) return;
    const { error } = await supabase
      .from("contract_audit_messages")
      .delete()
      .eq("user_id", user.id);
    if (error) {
      toast.error("Couldn't clear history.");
      return;
    }
    setMessages([]);
  }

  return (
    <main className="mx-auto flex h-[calc(100dvh-4rem)] max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-gold text-gold-foreground shadow-gold">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[10px] uppercase tracking-[0.4em] text-gold">Claude</p>
            <h1 className="font-display text-2xl font-bold">Contract Auditor</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Paste Solidity or describe a contract — get a severity-graded security audit.
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => void handleClear()}>
            <Trash2 className="mr-1 h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        aria-label="Audit messages"
        className="min-h-0 flex-1 overflow-y-auto rounded-md border p-3"
      >
        <div ref={contentRef}>
          {!historyLoaded || authLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading your audit history…
            </div>
          ) : !user ? (
            <p className="text-sm text-muted-foreground">Sign in to use the contract auditor.</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No audits yet. Paste a contract below to start — findings come back grouped by
              Critical / High / Medium / Low / Informational.
            </p>
          ) : (
            <div className="space-y-3">
              {messages.map((m) => {
                const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "rounded-md px-3 py-2 text-sm whitespace-pre-wrap",
                      m.role === "user"
                        ? "bg-primary/10 text-foreground"
                        : "bg-muted text-foreground",
                    )}
                  >
                    <div className="mb-1 text-xs font-medium opacity-70">
                      {m.role === "user" ? "You" : "Auditor"}
                    </div>
                    {text}
                  </div>
                );
              })}
              {isLoading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Auditing…
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste contract code or ask a question…"
          rows={3}
          className="resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        {isLoading ? (
          <Button size="icon" variant="outline" onClick={() => void stop()} aria-label="Stop">
            <Loader2 className="h-4 w-4 animate-spin" />
          </Button>
        ) : (
          <Button
            size="icon"
            onClick={() => void handleSend()}
            disabled={!input.trim()}
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
    </main>
  );
}
