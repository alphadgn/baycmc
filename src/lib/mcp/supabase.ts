import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext } from "@lovable.dev/mcp-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Per-request Supabase client that forwards the MCP caller's OAuth bearer
 * token so RLS runs as that user. Never leak `ctx.getToken()` anywhere else.
 */
export function supabaseForUser(ctx: ToolContext): SupabaseClient<Database> {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient<Database>(url, key, {
    global: {
      headers: { Authorization: `Bearer ${ctx.getToken()}` },
      // Opaque sb_ publishable keys aren't JWTs — strip the default apikey
      // bearer that supabase-js appends, keep only the caller's token.
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) {
          h.set("Authorization", `Bearer ${ctx.getToken()}`);
        }
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function unauthenticated() {
  return {
    content: [{ type: "text" as const, text: "Not authenticated." }],
    isError: true,
  };
}

export function dbError(message: string) {
  return {
    content: [{ type: "text" as const, text: `Database error: ${message}` }],
    isError: true,
  };
}

export function jsonResult<T>(data: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: { data } as unknown as Record<string, unknown>,
  };
}
