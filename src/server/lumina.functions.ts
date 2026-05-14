import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAddress, isAddress } from "viem";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertSafeHttpsUrl } from "@/server/url-guard";

/**
 * Lumina ownership verification — public REST.
 *
 * The Lumina REST endpoint is admin-configurable via app_settings key
 * `lumina_gate` so the URL can be updated without a redeploy. Expected shape:
 *   { url: "https://api.lumina.example/holders/{wallet}", contract?: string }
 *
 * The endpoint is queried server-side with the user's verified wallet address
 * (taken from the user's profile) and we treat any positive ownership signal
 * (`owns: true`, non-empty `tokens`, or numeric `balance > 0`) as verified.
 *
 * On success we update `user_verifications.lumina_verified` so existing gates
 * (rooms, feeds, etc.) can layer Lumina checks on top of Token Proof.
 */
export const verifyLuminaOwnership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { wallet?: string }) =>
    z.object({ wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    let wallet = data.wallet ?? null;
    if (!wallet) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("wallet_address")
        .eq("id", userId)
        .maybeSingle();
      wallet = profile?.wallet_address ?? null;
    }
    if (!wallet || !isAddress(wallet)) {
      return { ok: false as const, verified: false, error: "No wallet on file" };
    }
    const checksummed = getAddress(wallet);

    const { data: gate } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "lumina_gate")
      .maybeSingle();
    const cfg = (gate?.value as { url?: string; contract?: string } | null) ?? null;
    if (!cfg?.url) {
      return { ok: false as const, verified: false, error: "Lumina gate not configured" };
    }

    const url = cfg.url
      .replace("{wallet}", encodeURIComponent(checksummed))
      .replace("{contract}", encodeURIComponent(cfg.contract ?? ""));

    try {
      assertSafeHttpsUrl(url);
    } catch (e) {
      console.error("Lumina URL rejected by SSRF guard", e);
      return { ok: false as const, verified: false, error: "Configured Lumina URL is not allowed." };
    }

    let verified = false;
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) {
        return { ok: false as const, verified: false, error: `Lumina ${res.status}` };
      }
      const body = (await res.json()) as
        | { owns?: boolean; balance?: number | string; tokens?: unknown[] }
        | unknown[];
      if (Array.isArray(body)) {
        verified = body.length > 0;
      } else {
        verified =
          body.owns === true ||
          (Array.isArray(body.tokens) && body.tokens.length > 0) ||
          (typeof body.balance === "number" && body.balance > 0) ||
          (typeof body.balance === "string" && Number(body.balance) > 0);
      }
    } catch (e) {
      console.error("Lumina REST error", e);
      return { ok: false as const, verified: false, error: "Lumina unreachable" };
    }

    await supabase
      .from("user_verifications")
      .upsert(
        { user_id: userId, lumina_verified: verified },
        { onConflict: "user_id" },
      );

    return { ok: true as const, verified };
  });
