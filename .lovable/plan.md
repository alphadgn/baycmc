# BAYCMC MCP + In-App AI Plan

Three shippable pieces. I'll build them in the order below and stop after each for you to try.

## Phase 1 — MCP tools (Claude/ChatGPT connect to BAYCMC)

Secure `/mcp` behind Supabase OAuth 2.1 so each connecting assistant acts **as the signed-in user** under RLS. Tools call your existing tables — no schema changes.

New tools in `src/lib/mcp/tools/`:

| Tool | What it does | Reads/Writes |
|---|---|---|
| `list_conference_rooms` | Active/upcoming Zoom-style rooms | `conference_rooms` (or equivalent) |
| `get_conference_room` | Details + participants for one room | same |
| `create_conference_room` | Schedule a new room (title, time, capacity) | insert |
| `end_conference_room` | Host ends a room | update `ended_at` |
| `list_karaoke_rooms` | Active karaoke rooms + queue | karaoke tables |
| `get_karaoke_queue` | Current song queue for a room | karaoke queue |
| `list_ape_rides_streams` | Live/scheduled Ape Rides streams | ape_rides tables |
| `get_ape_rides_stream` | Stream detail + viewer count | same |
| `get_my_verification_status` | Caller's KYC/verification state | verification |
| `list_linked_wallets` | Caller's linked wallets | wallets |

Auth: OAuth issuer set to `https://<project-ref>.supabase.co/auth/v1`, consent route at `src/routes/[.]lovable.oauth.consent.tsx`. Every tool derives `user_id` from the verified token (`ctx.getUserId()`), never from input. Tools that mutate carry `destructiveHint: true`.

**Discovery step:** I'll first read the schema (`rg` your table names) and only expose tools that map to real tables. If a domain (e.g. Ape Rides) doesn't have tables yet, I'll skip it and note it back to you rather than invent schema.

## Phase 2 — In-app AI assistant (Claude for contracts, GPT-5.5 for logic)

Both routed through **Lovable AI Gateway** — no separate Anthropic/OpenAI keys, billed to your workspace credits.

**Server side (`createServerFn`):**
- `src/lib/ai/contract-analyze.functions.ts` — `openai/gpt-5.5` (or `google/gemini-3.1-pro-preview` for long contracts); takes contract text/address + question, returns structured findings (risks, functions, suggestions). Uses `Output.object` for consistent shape.
- `src/lib/ai/logic-assist.functions.ts` — `openai/gpt-5.5` streaming for general reasoning/logic help.
- `src/routes/api/chat.ts` — streaming chat endpoint powering the user assistant, tool-enabled so it can call the contract-analyze fn.

**Client surface:**
- A floating **AI Assistant drawer** available app-wide (bottom-right, collapsed by default) for signed-in users. Two tabs: **Contracts** (Claude-style contract review) and **Assistant** (general chat). Uses AI SDK `useChat` + AI Elements for message rendering.

Note on "Claude": Anthropic's Claude models aren't currently in Lovable AI Gateway's chat catalog — the practical equivalent for contract analysis is GPT-5.5 with high reasoning or Gemini 3.1 Pro. If you specifically need Anthropic's Claude API, that requires an `ANTHROPIC_API_KEY` connector; say the word and I'll wire it as a fallback provider.

## Phase 3 — Hourly security scans

- Migration enables `pg_cron` + `pg_net`.
- New public endpoint `src/routes/api/public/security-scan.ts` that runs lightweight checks (auth attempt anomalies, RLS drift check against a known policy list, unusual `service_role`-less admin-table access counts, failed-login spikes). Writes rows to a new `security_scan_findings` table (RLS: super-admins only). Verified by `apikey` header (Supabase anon).
- Cron: `SELECT cron.schedule('baycmc-hourly-security-scan', '0 * * * *', ...)`.
- Super-admin panel view lists recent findings.

Deeper vector scans (real intrusion detection) require external tooling — this hourly job covers config drift + anomaly heuristics on your own data.

## Technical section

- MCP OAuth: `auth.oauth.issuer({ issuer, acceptedAudiences: "authenticated" })` in `src/lib/mcp/index.ts`. Consent route with `ssr: false`, redirect-preserved sign-in bounce.
- Each mutating MCP tool: `ctx.isAuthenticated()` guard → per-user Supabase client with `Authorization: Bearer ${ctx.getToken()}` → RLS enforces.
- AI Gateway provider helper: reuse `src/lib/ai-gateway.server.ts` (create if missing) per `ai-sdk-lovable-gateway` knowledge. `service_tier: "priority"` on the contract-analyze call for lower latency.
- Manifest regenerated with `app_mcp_server--extract_mcp_manifest` after each MCP change.
- Security-scan endpoint: signature-free but locked to `apikey` header + IP allow-list check against Supabase egress; findings write via service role loaded inside the handler.

## What I need from you to start Phase 1

Confirm this list matches your data — or point me at the actual table names for:
- conference/Zoom-style rooms
- karaoke rooms & queue
- Ape Rides streams

If unsure, say "go" and I'll grep the schema, expose whatever exists, and report back what's missing before writing tool code.
