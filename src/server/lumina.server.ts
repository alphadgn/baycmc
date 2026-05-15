import { getAddress, isAddress } from "viem";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertSafeHttpsUrl } from "@/server/url-guard";

async function fetchWithTimeout(url: string, ms: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Run a Lumina authenticity check for the given wallet and persist the
 * result onto `user_verifications.lumina_verified`. Called automatically
 * after every successful BAYC ownership verification (Tokenproof & Privy
 * SIWE) so the gating helper `is_token_proof_verified` (which requires
 * BAYC + Lumina) actually unlocks gated content.
 *
 * Behavior when the Lumina gate has not been configured yet (no app_settings
 * row, missing url): we treat the check as a pass-through and mark
 * `lumina_verified = true`. This keeps the platform usable while admins
 * configure the Lumina endpoint, without ever marking a fake ape as real.
 */
export async function runLuminaCheckAndPersist(args: {
  userId: string;
  wallet: string;
}): Promise<{ verified: boolean; configured: boolean; reason?: string }> {
  if (!isAddress(args.wallet)) {
    return { verified: false, configured: false, reason: "invalid-wallet" };
  }
  const checksummed = getAddress(args.wallet);

  const { data: gate } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "lumina_gate")
    .maybeSingle();
  const cfg = (gate?.value as { url?: string; contract?: string } | null) ?? null;

  // No gate configured → pass-through. Persist as verified so users aren't
  // locked out before admins finish setup.
  if (!cfg?.url) {
    await supabaseAdmin
      .from("user_verifications")
      .upsert({ user_id: args.userId, lumina_verified: true }, { onConflict: "user_id" });
    return { verified: true, configured: false };
  }

  const url = cfg.url
    .replace("{wallet}", encodeURIComponent(checksummed))
    .replace("{contract}", encodeURIComponent(cfg.contract ?? ""));

  // SSRF guard — admins could (intentionally or via account compromise)
  // point this at internal services. Reject anything that isn't a public
  // HTTPS endpoint before we issue the request.
  try {
    assertSafeHttpsUrl(url);
  } catch (e) {
    console.error("Lumina URL rejected by SSRF guard", e);
    await supabaseAdmin
      .from("user_verifications")
      .upsert({ user_id: args.userId, lumina_verified: false }, { onConflict: "user_id" });
    return { verified: false, configured: true, reason: "unsafe-url" };
  }

  let verified = false;
  try {
    const res = await fetchWithTimeout(url, 6_000);
    if (res.ok) {
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
    }
  } catch (e) {
    console.error("Lumina REST error", e);
  }

  await supabaseAdmin
    .from("user_verifications")
    .upsert({ user_id: args.userId, lumina_verified: verified }, { onConflict: "user_id" });

  return { verified, configured: true };
}
