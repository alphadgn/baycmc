import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import {
  createLovableAiGatewayProvider,
  getLovableAiGatewayRunId,
} from "@/lib/ai-gateway.server";

type ChatRequestBody = {
  messages?: unknown;
  mode?: "assistant" | "contract";
};

const SYSTEM_ASSISTANT = `You are the BAYCMC in-app assistant. Help members with app logic, feature usage, verification, wallets, karaoke rooms, Ape Rides streaming, and conference rooms. Be concise and use markdown. If a question requires on-chain smart-contract analysis (Solidity, security review, gas, upgradability, RWA provenance contracts), switch tone to a rigorous auditor and produce clear findings.`;

const SYSTEM_CONTRACT = `You are a senior smart-contract auditor for BAYCMC (RWA provenance, phygital NFTs, marketplace). Analyze Solidity/EVM code with a security-first mindset: check auth, reentrancy, access control, oracle risk, upgrade patterns, storage layout, event emission, and gas. Return findings as markdown grouped by severity (Critical / High / Medium / Low / Informational) with code references and recommended fixes.`;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { messages, mode } = (await request.json()) as ChatRequestBody;
        if (!Array.isArray(messages)) {
          return new Response("Messages are required", { status: 400 });
        }
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const initialRunId = getLovableAiGatewayRunId(request);
        const gateway = createLovableAiGatewayProvider(key, initialRunId);
        const model = gateway("openai/gpt-5.5");

        const system = mode === "contract" ? SYSTEM_CONTRACT : SYSTEM_ASSISTANT;
        const result = streamText({
          model,
          system,
          messages: await convertToModelMessages(messages as UIMessage[]),
        });
        return result.toUIMessageStreamResponse({
          originalMessages: messages as UIMessage[],
        });
      },
    },
  },
});
