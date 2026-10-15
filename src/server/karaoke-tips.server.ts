/**
 * Karaoke tip eligibility + on-chain verification. Server-only.
 *
 * A performer can RECEIVE tips only when BOTH are true:
 *   1. they are the current performer in the room (server session), and
 *   2. their account's wallets (primary + verified linked wallets) hold at
 *      least one TIP_COLLECTIONS NFT: BAYC, MAYC, CryptoPunks, Ugly Duck
 *      Labs, Orca Business or Temp Agency — each checked on its own chain.
 */
import { getAddress, isAddress } from "viem";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { TIP_COLLECTIONS, TIP_CHAIN_ID, collectionByContract } from "@/lib/web3/constants";
import { publicClientFor } from "@/server/ownership/chains";
import { scanAllCollections } from "@/server/ownership/collectionScanner";

export interface TipTarget {
  eligible: boolean;
  reason?: "no-performer" | "self" | "no-wallet" | "not-holder";
  performerId: string | null;
  performerName: string | null;
  wallet: string | null;
  collection: string | null;
  generation: number | null;
}

// Short memo so every listener polling the same performer doesn't re-scan.
const memo = new Map<string, { at: number; holder: string | null }>();
const MEMO_MS = 5 * 60_000;

async function accountWallets(userId: string) {
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
  for (const r of linked ?? [])
    if (r.address && isAddress(r.address)) all.add(getAddress(r.address));
  return {
    primary,
    wallets: [...all] as `0x${string}`[],
    username: (profile?.username as string | null) ?? null,
  };
}

/** Collection label the user holds (first match), or null. */
async function heldTipCollection(userId: string, wallets: `0x${string}`[]) {
  const hit = memo.get(userId);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.holder;
  let holder: string | null = null;
  if (wallets.length > 0) {
    const rows = await scanAllCollections(publicClientFor(1), wallets, 0n, TIP_COLLECTIONS);
    const first = rows[0];
    holder = first ? (collectionByContract(first.contract)?.name ?? null) : null;
  }
  memo.set(userId, { at: Date.now(), holder });
  return holder;
}

export async function resolveTipTarget(roomId: string, callerId: string): Promise<TipTarget> {
  const { data: session } = await supabaseAdmin
    .from("karaoke_sessions")
    .select("performer_user_id,generation")
    .eq("room_id", roomId)
    .maybeSingle();
  const performerId = (session?.performer_user_id as string | null) ?? null;
  const generation = (session?.generation as number | null) ?? null;
  const base = { performerId, performerName: null, wallet: null, collection: null, generation };
  if (!performerId) return { ...base, eligible: false, reason: "no-performer" };

  const acct = await accountWallets(performerId);
  const named = { ...base, performerName: acct.username };
  if (performerId === callerId) return { ...named, eligible: false, reason: "self" };
  if (acct.wallets.length === 0) return { ...named, eligible: false, reason: "no-wallet" };

  const collection = await heldTipCollection(performerId, acct.wallets);
  if (!collection) return { ...named, eligible: false, reason: "not-holder" };

  // Tips go to the performer's connected (primary) wallet; an email account
  // with only linked wallets receives on its first verified wallet.
  const wallet = acct.primary ?? acct.wallets[0] ?? null;
  return { ...named, eligible: !!wallet, wallet, collection };
}

export class TipError extends Error {}

/**
 * Verify a tip transaction on ApeChain and record it. Idempotent per tx.
 * The recipient must be eligible right now OR have been the performer when
 * the tip was sent (song can end while the transaction confirms) — we
 * re-check holder status and require the tx to pay one of their wallets.
 */
export async function verifyAndRecordTip(input: {
  roomId: string;
  tipperId: string;
  recipientId: string;
  txHash: `0x${string}`;
  generation: number | null;
}) {
  if (input.tipperId === input.recipientId) throw new TipError("You can't tip yourself.");

  const acct = await accountWallets(input.recipientId);
  const collection = await heldTipCollection(input.recipientId, acct.wallets);
  if (!collection) throw new TipError("This performer isn't eligible for tips.");

  const client = publicClientFor(TIP_CHAIN_ID);
  const receipt = await client.waitForTransactionReceipt({
    hash: input.txHash,
    timeout: 60_000,
    confirmations: 1,
  });
  if (receipt.status !== "success") throw new TipError("The tip transaction failed on-chain.");
  const tx = await client.getTransaction({ hash: input.txHash });
  if (!tx.to || tx.value <= 0n) throw new TipError("That transaction isn't an APE transfer.");
  const to = getAddress(tx.to);
  if (!acct.wallets.some((w) => getAddress(w) === to)) {
    throw new TipError("That transaction didn't pay this performer.");
  }

  const { error } = await supabaseAdmin.from("karaoke_tips").insert({
    room_id: input.roomId,
    tipper_id: input.tipperId,
    recipient_id: input.recipientId,
    chain_id: TIP_CHAIN_ID,
    tx_hash: input.txHash.toLowerCase(),
    from_address: getAddress(tx.from),
    to_address: to,
    amount_wei: tx.value.toString(),
    session_generation: input.generation,
  });
  if (error && !/duplicate key|karaoke_tips_tx_unique/i.test(error.message)) {
    throw new TipError(error.message);
  }
  return { amountWei: tx.value.toString(), duplicate: !!error };
}
