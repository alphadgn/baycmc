import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Sparkles, Send, Loader2, ShieldCheck } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type Mode = "assistant" | "contract";

/**
 * Floating AI Assistant. Two modes over the same /api/chat endpoint:
 *  - assistant: GPT-5.5 for general app logic help
 *  - contract:  GPT-5.5 in smart-contract auditor mode (Solidity, security)
 */
export function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("assistant");
  const [input, setInput] = useState("");

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: () => ({ mode }),
    }),
  });

  const isLoading = status === "submitted" || status === "streaming";

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
          className="fixed bottom-4 right-4 z-40 h-12 w-12 rounded-full shadow-lg"
          aria-label="Open AI assistant"
        >
          <Sparkles className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-3 sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> BAYCMC Assistant
          </SheetTitle>
          <SheetDescription>
            In-app AI for logic help and smart-contract review.
          </SheetDescription>
        </SheetHeader>

        <Tabs
          value={mode}
          onValueChange={(v) => {
            setMode(v as Mode);
            setMessages([]);
          }}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="assistant">
              <Sparkles className="mr-1 h-3.5 w-3.5" /> Assistant
            </TabsTrigger>
            <TabsTrigger value="contract">
              <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Contracts
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <ScrollArea className="flex-1 rounded-md border p-3">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {mode === "contract"
                ? "Paste Solidity code or ask about a contract. You'll get a severity-graded audit."
                : "Ask about rooms, karaoke, Ape Rides, verification, or anything about the app."}
            </p>
          ) : (
            <div className="space-y-3">
              {messages.map((m) => {
                const text = m.parts
                  .map((p) => (p.type === "text" ? p.text : ""))
                  .join("");
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
        </ScrollArea>

        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              mode === "contract"
                ? "Paste contract code or ask a question…"
                : "Ask a question…"
            }
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
