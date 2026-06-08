import { getAddress, isAddress } from "viem";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireTokenProof } from "@/server/token-proof.server";

/**
 * Otherpage Lifer-token check.
 *
 * Lifer access (is_lifer) requires both BAYC/MAYC ownership AND ownership of
 * the Otherpage Lifer token configured in app_settings("otherpage_gate").
 * Until an admin saves a contract address, every user is non-Lifer
 * (fail-closed).
 */
export async function runOtherpageCheckAndPersist(args: {
  userId: string;
  wallet: string;
}): Promise<{ verified: boolean; configured: boolean; reason?: string }> {
  if (!isAddress(args.wallet)) {
    await supabaseAdmin
      .from("user_verifications")
      .upsert({ user_id: args.userId, otherpage_verified: false }, { onConflict: "user_id" });
    return { verified: false, configured: false, reason: "invalid-wallet" };
  }
  const wallet = getAddress(args.wallet);

  const { data: row } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "otherpage_gate")
    .maybeSingle();
  const cfg =
    (row?.value as { contract?: string; min_balance?: number; chain_id?: number } | null) ?? null;

  if (!cfg?.contract) {
    await supabaseAdmin
      .from("user_verifications")
      .upsert({ user_id: args.userId, otherpage_verified: false }, { onConflict: "user_id" });
    return { verified: false, configured: false, reason: "gate-not-configured" };
  }

  const proof = await requireTokenProof({
    wallet,
    contract: cfg.contract,
    minBalance: cfg.min_balance ?? 1,
    chainId: cfg.chain_id ?? 1,
  });

  await supabaseAdmin
    .from("user_verifications")
    .upsert(
      { user_id: args.userId, otherpage_verified: proof.verified },
      { onConflict: "user_id" },
    );

  return {
    verified: proof.verified,
    configured: true,
    reason: proof.verified ? undefined : (proof.reason ?? "no-qualifying-tokens"),
  };
}
