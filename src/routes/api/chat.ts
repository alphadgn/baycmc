import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";
import {
  createLovableAiGatewayProvider,
  getLovableAiGatewayRunId,
} from "@/lib/ai-gateway.server";

/**
 * BAYCmc Assistant — customer-facing help ONLY:
 *   1. questions about using BAYCmc (this app), and
 *   2. Bored Ape Yacht Club / Yuga Labs.
 * Anything else is politely declined. Facts about BAYC / Yuga Labs come from
 * genuine sources scraped live with Firecrawl (FIRECRAWL_API_KEY), limited to
 * the allow-listed official domains below.
 */

const OFFICIAL_DOMAINS = [
  "boredapeyachtclub.com",
  "yuga.com",
  "yugalabs.io",
  "otherside.xyz",
  "apecoin.com",
  "apechain.com",
  "docs.apechain.com",
  "apefoundation.org",
  "baycmc.app",
] as const;

function isOfficialUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    return OFFICIAL_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

const SYSTEM_ASSISTANT = `You are the BAYCmc Assistant, the customer-facing helper for BAYCmc (baycmc.app), a mobile clubhouse app for the Bored Ape Yacht Club community. Always write the brand exactly as "BAYCmc".

SCOPE — you ONLY help with:
1. BAYCmc itself: signing in (email & password, or the VIP button for Glyph / a wallet), linking wallets, holder verification, the public lobby and chat, karaoke rooms (queue, music machine, recordings, $APE tip jar), conference rooms and bookings, Ape Rides, profiles, support.
2. Bored Ape Yacht Club and Yuga Labs (the company behind BAYC): the collections, history, official announcements, ApeCoin / ApeChain as they relate to BAYC.
For anything else (other projects, coding help, smart-contract audits, price predictions, financial or legal advice, general chit-chat) reply briefly that you can only help with BAYCmc and Bored Ape Yacht Club questions.

SOURCES — for any factual question about BAYC or Yuga Labs, call searchOfficialSources (and scrapeOfficialPage for detail) BEFORE answering, and base the answer only on what those genuine sources say. Cite the source URLs at the end. If the tools return nothing useful, say you couldn't confirm it from official sources rather than guessing. Never present unverified rumours as fact. BAYCmc is a fan clubhouse and is not affiliated with Yuga Labs — say so if asked.

STYLE — concise, friendly, markdown. Never ask for or accept seed phrases, private keys or passwords.`;

async function firecrawl<T>(path: string, body: unknown): Promise<T> {
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if (!key) throw new Error("FIRECRAWL_API_KEY is not configured");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(`https://api.firecrawl.dev/v1/${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Firecrawl ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

const clip = (s: string | undefined, n: number) => (s ?? "").slice(0, n);

const tools = {
  searchOfficialSources: tool({
    description:
      "Search genuine Bored Ape Yacht Club / Yuga Labs / ApeCoin / BAYCmc sources. Returns titles, URLs and page text from official domains only.",
    inputSchema: z.object({ query: z.string().min(2).max(200) }),
    execute: async ({ query }) => {
      try {
        const sites = OFFICIAL_DOMAINS.map((d) => `site:${d}`).join(" OR ");
        const out = await firecrawl<{
          data?: Array<{ url?: string; title?: string; description?: string; markdown?: string }>;
        }>("search", {
          query: `${query} (${sites})`,
          limit: 6,
          scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
        });
        const results = (out.data ?? [])
          .filter((r) => r.url && isOfficialUrl(r.url))
          .slice(0, 4)
          .map((r) => ({
            url: r.url,
            title: r.title ?? null,
            text: clip(r.markdown || r.description, 3_000),
          }));
        return results.length ? { results } : { results: [], note: "No official sources found." };
      } catch (e) {
        return { results: [], error: e instanceof Error ? e.message : "search failed" };
      }
    },
  }),
  scrapeOfficialPage: tool({
    description: "Read one page from an official BAYC / Yuga Labs / ApeCoin / BAYCmc domain.",
    inputSchema: z.object({ url: z.string().url() }),
    execute: async ({ url }) => {
      if (!isOfficialUrl(url)) return { error: "Only official domains can be read." };
      try {
        const out = await firecrawl<{ data?: { markdown?: string; metadata?: { title?: string } } }>(
          "scrape",
          { url, formats: ["markdown"], onlyMainContent: true },
        );
        return { url, title: out.data?.metadata?.title ?? null, text: clip(out.data?.markdown, 8_000) };
      } catch (e) {
        return { url, error: e instanceof Error ? e.message : "scrape failed" };
      }
    },
  }),
};

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as { messages?: unknown } | null;
        const messages = body?.messages;
        if (!Array.isArray(messages) || messages.length === 0) {
          return new Response("Messages are required", { status: 400 });
        }
        // Keep the conversation bounded (cost / abuse guard).
        const recent = (messages as UIMessage[]).slice(-12);
        if (JSON.stringify(recent).length > 40_000) {
          return new Response("Conversation too long — start a new chat.", { status: 413 });
        }
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const gateway = createLovableAiGatewayProvider(key, getLovableAiGatewayRunId(request));
        const result = streamText({
          model: gateway("openai/gpt-5.5"),
          system: SYSTEM_ASSISTANT,
          messages: await convertToModelMessages(recent),
          tools,
          stopWhen: stepCountIs(4),
        });
        return result.toUIMessageStreamResponse({ originalMessages: recent });
      },
    },
  },
});
