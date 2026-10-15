import { createFileRoute } from "@tanstack/react-router";
import { createAnthropic } from "@ai-sdk/anthropic";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { createClient } from "@supabase/supabase-js";
import { createLovableAiGatewayRunIdFetch } from "@/lib/ai-gateway.server";

const SYSTEM_CONTRACT = `You are a senior smart-contract auditor for BAYCmc (RWA provenance, phygital NFTs, marketplace). Analyze Solidity/EVM code with a security-first mindset: check auth, reentrancy, access control, oracle risk, upgrade patterns, storage layout, event emission, and gas. Return findings as markdown grouped by severity (Critical / High / Medium / Low / Informational) with code references and recommended fixes.`;

type AuditRequestBody = { messages?: unknown };

async function authenticate(request: Request) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer /i, "");
  if (!token) return null;
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { userId: data.user.id, token };
}

function userScopedClient(token: string) {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, key, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) {
          h.set("Authorization", `Bearer ${token}`);
        }
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const Route = createFileRoute("/api/contract-audit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticate(request);
        if (!auth) return new Response("Unauthorized", { status: 401 });

        const { messages } = (await request.json()) as AuditRequestBody;
        if (!Array.isArray(messages) || messages.length === 0) {
          return new Response("Messages are required", { status: 400 });
        }
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const uiMessages = messages as UIMessage[];
        const runIdFetch = createLovableAiGatewayRunIdFetch();
        const anthropic = createAnthropic({
          baseURL: "https://ai.gateway.lovable.dev/v1",
          apiKey: key,
          headers: { "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
          fetch: runIdFetch.fetch,
        });

        const db = userScopedClient(auth.token);
        const lastUser = [...uiMessages].reverse().find((m) => m.role === "user");
        if (lastUser) {
          const { error } = await db.from("contract_audit_messages").insert({
            user_id: auth.userId,
            role: "user",
            parts: lastUser.parts,
          });
          if (error) console.error("[contract-audit] user msg persist failed", error);
        }

        const result = streamText({
          model: anthropic("anthropic/claude-sonnet-5"),
          system: SYSTEM_CONTRACT,
          maxOutputTokens: 16000,
          maxRetries: 0,
          messages: await convertToModelMessages(uiMessages),
          abortSignal: request.signal,
        });

        return result.toUIMessageStreamResponse({
          originalMessages: uiMessages,
          onFinish: async ({ responseMessage }) => {
            const { error } = await db.from("contract_audit_messages").insert({
              user_id: auth.userId,
              role: "assistant",
              parts: responseMessage.parts,
            });
            if (error) console.error("[contract-audit] assistant msg persist failed", error);
          },
        });
      },
    },
  },
});
