import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Sparkles, Send, Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChatScroll } from "@/hooks/use-chat-scroll";
import { cn } from "@/lib/utils";

/**
 * Floating BAYCmc Assistant — customer-facing help for BAYCmc and
 * Bored Ape Yacht Club / Yuga Labs questions, answered from official
 * sources (see /api/chat).
 */
export function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
    }),
  });

  const isLoading = status === "submitted" || status === "streaming";
  const { scrollRef, contentRef, handleScroll } = useChatScroll("assistant", open, messages);

  async function handleSend() {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    await sendMessage({ text });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          size="icon"
          className="fixed bottom-[calc(env(safe-area-inset-bottom)+7.75rem)] right-3 z-40 h-9 w-9 rounded-full shadow-lg"
          aria-label="Open AI assistant"
        >
          <Sparkles className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-3 sm:max-w-md">
        <SheetHeader className="items-center text-center sm:text-center">
          <SheetTitle className="flex items-center justify-center gap-2">
            <Sparkles className="h-4 w-4" /> BAYCmc Assistant
          </SheetTitle>
          <SheetDescription className="sr-only">
            Help with BAYCmc and Bored Ape Yacht Club questions.
          </SheetDescription>
          <span className="mx-auto inline-flex items-center gap-1 rounded-md bg-muted px-4 py-1.5 text-sm font-medium text-foreground">
            <Sparkles className="h-3.5 w-3.5" /> Assistant
          </span>
        </SheetHeader>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          aria-label="Assistant messages"
          className="min-h-0 flex-1 overflow-y-auto rounded-md border p-3"
        >
          <div ref={contentRef}>
            {messages.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground">
                Ask about BAYCmc (sign-in, rooms, karaoke, verification) or about Bored Ape Yacht
                Club and Yuga Labs.
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
                        {m.role === "user" ? "You" : "Assistant"}
                      </div>
                      {text}
                    </div>
                  );
                })}
                {isLoading && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about BAYCmc or BAYC…"
            rows={2}
            className="resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
          />
          <Button
            size="icon"
            onClick={() => void handleSend()}
            disabled={isLoading || !input.trim()}
            aria-label="Send message"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
