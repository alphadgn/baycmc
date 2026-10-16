import { getAddress, isAddress } from "viem";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Primary + signature-verified linked wallets of an account. Server-only. */
export async function accountWallets(userId: string) {
  const [{ data: profile }, { data: linked }] = await Promise.all([
    supabaseAdmin.from("profiles").select("wallet_address,username").eq("id", userId).maybeSingle(),
    supabaseAdmin
      .from("linked_wallets")
      .select("address")
      .eq("user_id", userId)
      .not("verified_at", "is", null),
  ]);
  const primary =
    profile?.wallet_address && isAddress(profile.wallet_address)
      ? getAddress(profile.wallet_address)
      : null;
  const all = new Set<string>();
  if (primary) all.add(primary);
  for (const r of linked ?? []) if (r.address && isAddress(r.address)) all.add(getAddress(r.address));
  return {
    primary,
    wallets: [...all] as `0x${string}`[],
    username: (profile?.username as string | null) ?? null,
  };
}
