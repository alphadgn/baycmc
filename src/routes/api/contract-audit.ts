import { createFileRoute } from "@tanstack/react-router";
import { createAnthropic } from "@ai-sdk/anthropic";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { createLovableAiGatewayRunIdFetch } from "@/lib/ai-gateway.server";
import {
  authenticateRequest,
  consumeRateLimit,
  tooManyRequests,
  userScopedClient,
} from "@/server/api-auth.server";

const SYSTEM_CONTRACT = `You are a senior smart-contract auditor for BAYCmc (RWA provenance, phygital NFTs, marketplace). Analyze Solidity/EVM code with a security-first mindset: check auth, reentrancy, access control, oracle risk, upgrade patterns, storage layout, event emission, and gas. Return findings as markdown grouped by severity (Critical / High / Medium / Low / Informational) with code references and recommended fixes.`;

type AuditRequestBody = { messages?: unknown };

/** Per-user audit budget (durable): audits are long, expensive model calls. */
export const AUDIT_RATE_LIMIT = { limit: 10, windowSeconds: 3600 } as const;
/** Largest single submission (characters of text) accepted for an audit. */
export const AUDIT_MAX_INPUT_CHARS = 120_000;
/** Server-side history window replayed to the model. */
const HISTORY_ROWS = 20;
const HISTORY_MAX_CHARS = 200_000;

type StoredRow = { id: string; role: string; parts: unknown };

/** Text-only user message: drops any client-supplied tool/file parts. */
export function sanitizeUserMessage(m: unknown): UIMessage | null {
  if (!m || typeof m !== "object") return null;
  const msg = m as { id?: unknown; role?: unknown; parts?: unknown };
  if (msg.role !== "user" || !Array.isArray(msg.parts)) return null;
  const parts = msg.parts
    .filter(
      (p): p is { type: "text"; text: string } =>
        !!p && typeof p === "object" && p.type === "text" && typeof p.text === "string",
    )
    .map((p) => ({ type: "text" as const, text: p.text }));
  if (parts.length === 0) return null;
  return { id: typeof msg.id === "string" ? msg.id : crypto.randomUUID(), role: "user", parts };
}

export function textLength(m: UIMessage): number {
  return m.parts.reduce((n, p) => n + (p.type === "text" ? p.text.length : 0), 0);
}

export const Route = createFileRoute("/api/contract-audit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateRequest(request);
        if (!auth) return new Response("Unauthorized", { status: 401 });

        const body = (await request.json().catch(() => null)) as AuditRequestBody | null;
        const messages = body?.messages;
        if (!Array.isArray(messages) || messages.length === 0) {
          return new Response("Messages are required", { status: 400 });
        }
        // Only the newest user turn is taken from the client; history comes from the
        // database so a client can't inject fabricated assistant turns.
        const lastUser = sanitizeUserMessage(
          [...messages].reverse().find((m) => (m as { role?: unknown })?.role === "user"),
        );
        if (!lastUser) return new Response("A text message is required", { status: 400 });
        if (textLength(lastUser) > AUDIT_MAX_INPUT_CHARS) {
          return new Response(
            `Submission too large (max ${AUDIT_MAX_INPUT_CHARS.toLocaleString()} characters). Split the contract into parts.`,
            { status: 413 },
          );
        }
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const rate = await consumeRateLimit(
          "api_contract_audit",
          auth.userId,
          AUDIT_RATE_LIMIT.limit,
          AUDIT_RATE_LIMIT.windowSeconds,
        );
        if (!rate.allowed) return tooManyRequests(rate, "Audit limit reached. Try again later.");

        const runIdFetch = createLovableAiGatewayRunIdFetch();
        const anthropic = createAnthropic({
          baseURL: "https://ai.gateway.lovable.dev/v1",
          apiKey: key,
          headers: { "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
          fetch: runIdFetch.fetch,
        });

        const db = userScopedClient(auth.token);
        const { data: rows, error: histErr } = await db
          .from("contract_audit_messages")
          .select("id, role, parts")
          .order("created_at", { ascending: false })
          .limit(HISTORY_ROWS);
        if (histErr) console.error("[contract-audit] history load failed", histErr);
        const history: UIMessage[] = [];
        let budget = HISTORY_MAX_CHARS - textLength(lastUser);
        for (const row of (rows ?? []) as StoredRow[]) {
          if ((row.role !== "user" && row.role !== "assistant") || !Array.isArray(row.parts))
            continue;
          const m = { id: row.id, role: row.role, parts: row.parts } as UIMessage;
          budget -= textLength(m);
          if (budget < 0) break;
          history.unshift(m);
        }
        const uiMessages = [...history, lastUser];

        const { error } = await db.from("contract_audit_messages").insert({
          user_id: auth.userId,
          role: "user",
          parts: lastUser.parts,
        });
        if (error) console.error("[contract-audit] user msg persist failed", error);

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
