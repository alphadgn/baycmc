import { createClient } from "@supabase/supabase-js";

/**
 * Shared helpers for raw server routes (`/api/*`) that are not server functions and so
 * can't use `requireSupabaseAuth`: bearer-token auth, a user-scoped (RLS) client, and a
 * durable per-user rate limit backed by `public.consume_rate_limit` (migration
 * 20261118000001). Server-only.
 */

export interface ApiAuth {
  userId: string;
  token: string;
}

/** Validates `Authorization: Bearer <supabase access token>` against Supabase Auth. */
export async function authenticateRequest(request: Request): Promise<ApiAuth | null> {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match?.[1]?.trim();
  if (!token) return null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { userId: data.user.id, token };
}

/** Supabase client that acts as the signed-in user (RLS applies). */
export function userScopedClient(token: string) {
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

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  /** "db" when enforced by the shared table; "memory" when the DB limiter was unavailable. */
  source: "db" | "memory";
}

type RateRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{
  data: { allowed: boolean; remaining: number; reset_at: string }[] | null;
  error: { message: string } | null;
}>;

const memoryBuckets = new Map<string, { count: number; reset: number }>();

/** Per-instance fallback, used only if the rate-limit migration isn't applied yet. */
export function consumeMemoryLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  const entry = memoryBuckets.get(key);
  if (!entry || entry.reset < now) {
    memoryBuckets.set(key, { count: 1, reset: now + windowMs });
    if (memoryBuckets.size > 5000) {
      for (const [k, v] of memoryBuckets) if (v.reset < now) memoryBuckets.delete(k);
    }
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs, source: "memory" };
  }
  entry.count += 1;
  return {
    allowed: entry.count <= limit,
    remaining: Math.max(limit - entry.count, 0),
    resetAt: entry.reset,
    source: "memory",
  };
}

let warnedFallback = false;

/**
 * Durable fixed-window rate limit shared by every worker instance.
 * Falls back to a per-instance in-memory window (with a one-time warning) when the
 * database limiter is unreachable, so a missing migration never locks users out.
 */
export async function consumeRateLimit(
  bucket: string,
  subject: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin.rpc as unknown as RateRpc)("consume_rate_limit", {
      _bucket: bucket,
      _subject: subject,
      _limit: limit,
      _window_seconds: windowSeconds,
    });
    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row) throw new Error(error?.message ?? "no result");
    return {
      allowed: !!row.allowed,
      remaining: Number(row.remaining) || 0,
      resetAt: Date.parse(row.reset_at),
      source: "db",
    };
  } catch (e) {
    if (!warnedFallback) {
      warnedFallback = true;
      console.warn(
        "[rate-limit] durable limiter unavailable, using per-instance memory:",
        e instanceof Error ? e.message : e,
      );
    }
    return consumeMemoryLimit(`${bucket}:${subject}`, limit, windowSeconds * 1000);
  }
}

/** Standard 429 response for a refused rate-limit check. */
export function tooManyRequests(result: RateLimitResult, message = "Too many requests") {
  const retry = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  return new Response(message, { status: 429, headers: { "Retry-After": String(retry) } });
}
